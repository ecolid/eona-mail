import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {buildMailSearch,mailSearchTerms} from './src/mail-search.js';
import {workflowMailSummary} from './src/mail-workflow-summary.js';
import {mailSearchMatches} from './src/mail-search.js';
import {advancedMailQuery,submittedMailSearch} from './src/mail-search-view.js';
test('advanced submit requires a real condition and compiles the whole draft',()=>{
 for(const draft of [{},{words:'  '},{where:'subject'}])assert.throws(()=>advancedMailQuery(draft,mailSearchTerms),/至少一项/);
 assert.equal(advancedMailQuery({words:'"fixed phrase" -news',where:'subject',from:'Support Team',after:'2026-10-21',attachment:'no'},mailSearchTerms),'subject:"fixed phrase" -subject:news from:"Support Team" after:2026-10-21 -has:attachment');
 assert.equal(advancedMailQuery({is:'unread'},mailSearchTerms),'is:unread');
 assert.throws(()=>advancedMailQuery({words:'x'.repeat(501)},mailSearchTerms),/500/);
});
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE emails(id INTEGER,subject TEXT,from_addr TEXT,from_name TEXT,alias TEXT,origin_to TEXT,ai_summary TEXT,text_body TEXT,received_at TEXT,is_read INT,is_starred INT,has_attachments INT);
INSERT INTO emails VALUES(1,'CloudCone invoice','billing@cloudcone.com','CloudCone','me@example.test','me@example.test','September renewal','Invoice for SV 100%','2026-10-15 08:00:00',0,1,1),(2,'CloudCone news','news@cloudcone.com','CloudCone','me@example.test','me@example.test','New release','SV new products','2026-10-14 08:00:00',1,0,0),(3,'安全提醒','security@example.test','账户安全','me@example.test','me@example.test','登录已保护','北京 邮箱 验证','2026-10-13 08:00:00',0,0,0);`);
db.exec(`ALTER TABLE emails ADD COLUMN to_addr TEXT;ALTER TABLE emails ADD COLUMN attachment_keys TEXT DEFAULT '[]';ALTER TABLE emails ADD COLUMN folder TEXT DEFAULT 'inbox';`);
db.prepare('UPDATE emails SET to_addr=?,attachment_keys=? WHERE id=1').run('收件人专名 <receiver.unique@example.test>',JSON.stringify([{name:'独立附件-审计清单.xlsx',key:'att/internal/onlyOpaquePath'}]));
db.prepare('UPDATE emails SET attachment_keys=? WHERE id=3').run('{malformed');
function find(q){const s=buildMailSearch(q);return db.prepare('SELECT id FROM emails WHERE 1=1'+s.sql+' ORDER BY ('+s.rank+') DESC,id').all(...s.args,...s.rankArgs).map(x=>x.id);}
test('all words match across subject, body and saved summary, with stable relevance',()=>{assert.deepEqual(find('cloudcone SV invoice'),[1]);assert.deepEqual(find('北京 邮箱'),[3]);assert.deepEqual(find('cloudcone absent'),[])});
test('phrases, exclusion, Unicode width and literal wildcard are respected',()=>{assert.deepEqual(find('"New release"'),[2]);assert.deepEqual(find('cloudcone -news'),[1]);assert.deepEqual(find('１００％'),[1]);assert.deepEqual(find('_'),[]);assert.deepEqual(find('%'),[1]);assert.deepEqual(find("' OR 1=1 --"),[])});
test('field, date, unread/starred and attachment filters compose',()=>{assert.deepEqual(find('from:billing to:me@example.test subject:invoice after:2026-10-15 before:2026-10-16 is:unread is:starred has:attachment'),[1]);assert.deepEqual(find('summary:renewal -body:absent'),[1]);assert.throws(()=>find('after:2026-02-30'),/日期/);assert.throws(()=>find('is:invalid'),/支持/)});
test('empty clear restores scope and matching never removes ownership predicates',()=>{assert.deepEqual(find(''),[1,2,3]);const s=buildMailSearch('cloudcone');assert.equal(db.prepare('SELECT COUNT(*) n FROM emails WHERE alias=?'+s.sql).get('other@example.test',...s.args).n,0);assert.equal(mailSearchTerms('"CloudCone invoice" -news').length,2)});
test('workflow descriptions preserve run identity and never invent log errors',()=>{const s=workflowMailSummary({from_addr:'notifications@github.com',subject:'[ecolid/accompany] Run failed: Eona component checks – codex/ui (4bc76cb)',text_body:'component: Failed\nhttps://github.com/ecolid/accompany/actions/runs/38910009665'});assert.equal(s.runId,'38910009665');assert.match(s.summary,/ecolid\/accompany/);assert.match(s.summary,/codex\/ui/);assert.match(s.summary,/component/);assert.doesNotMatch(s.summary,/postal-mime/);assert.equal(workflowMailSummary({from_addr:'fake@example.test',subject:'[ecolid/accompany] Run failed: checks – main (4bc76cb)'}),null)});
test('long queries keep every term and use bounded bindings',()=>{const prefix=Array(20).fill('cloudcone').join(' ');assert.deepEqual(find(prefix+' missing'),[]);assert.deepEqual(find(prefix+' -invoice'),[2]);const s=buildMailSearch(prefix+' -invoice');assert.equal(s.terms.length,21);assert.equal(s.args.length+s.rankArgs.length,2);});
test('default search includes actual recipients and attachment names but excludes storage metadata',()=>{
 for(const q of ['收件人专名','receiver.unique','独立附件','filename:审计清单','attachment:审计清单','to:收件人专名','receiver.unique 审计清单'])assert.deepEqual(find(q),[1],q);
 assert.deepEqual(find('onlyOpaquePath'),[]);assert.deepEqual(find('filename:missing'),[]);assert.deepEqual(find('-filename:审计清单'),[2,3]);
});
test('explicit folder search composes with all other fields',()=>{assert.deepEqual(find('in:any filename:清单'),[1]);assert.deepEqual(find('in:trash'),[])});
test('matching field feedback only includes visible matching names',()=>{
 const row={subject:'invoice',to_addr:'Receiver Unique',attachment_keys:JSON.stringify([{name:'audit.xlsx',key:'secret-internal'}])};
 assert.deepEqual(mailSearchMatches(row,mailSearchTerms('unique audit')), {match_fields:['to','filename'],attachment_names:['audit.xlsx']});
 assert.deepEqual(mailSearchMatches(row,mailSearchTerms('secret-internal')), {match_fields:[],attachment_names:[]});
});

test('the shared mobile search submit clears an applied query and keeps local scopes literal',()=>{
 assert.equal(submittedMailSearch({words:'',where:'',from:''},mailSearchTerms,{previous:'from:billing'}),'');
 assert.throws(()=>submittedMailSearch({words:'',from:''},mailSearchTerms),/至少一项/);
 assert.equal(submittedMailSearch({words:'设计',from:'news@example.test'},mailSearchTerms,{previous:''}),'设计 from:news@example.test');
 assert.equal(submittedMailSearch({words:'from:a',from:'old@example.test'},mailSearchTerms,{filters:false}),'from:a');
 assert.equal(submittedMailSearch({words:''},mailSearchTerms,{filters:false,previous:'old'}),'');
});
