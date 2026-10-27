import {mailSelectReaderRow} from './src/mail-reader-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{fetchWithIdentity,testHooks} from './src/index.js';
import {SQLiteD1} from './sv/storage.mjs';
import {mailItemActions} from './src/mail-list-actions.js';
import {mailDirectoryFilter,mailFilterCaption,mailFilterQuery,mailListFilterFields,mailToggleFilter} from './src/mail-list-filters.js';
import {mailSearchTerms} from './src/mail-search.js';

test('read state writes are explicit, reversible, and independent from star/folder state',async()=>{
 const db=new SQLiteD1(':memory:');db.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 db.db.prepare('INSERT INTO emails(id,alias,from_addr,is_read,is_starred,folder,received_at) VALUES(1,?,?,0,0,?,?)').run('owner@example.test','from@example.test','inbox','2026-10-24 00:00:00');
 const token='fixture-read-token-'.padEnd(40,'x'),env={MAILDB:db,INBOX_PASSWORD:'fixture',READONLY_TOKENS:token};
 const call=op=>fetchWithIdentity(new Request('https://mail.eona.top/api/email/1/'+op,{method:'POST'}),env,{authenticated:true,subject:'owner',email:'owner@example.test'});
 try{
  for(const [op,read,star] of [['read',1,0],['read',1,0],['unread',0,0],['star',0,1],['unstar',0,0]]){assert.equal((await call(op)).status,200);const row=db.db.prepare('SELECT is_read,is_starred,folder FROM emails WHERE id=1').get();assert.deepEqual({...row},{is_read:read,is_starred:star,folder:'inbox'})}
  const denied=await worker.fetch(new Request('https://mail.eona.top/api/email/1/read',{method:'POST',headers:{authorization:'Bearer '+token}}),env,{});assert.equal(denied.status,403);assert.equal(db.db.prepare('SELECT is_read FROM emails WHERE id=1').get().is_read,0);
 }finally{db.close()}
});
test('the received operation catalog covers both row and reader presentations, including state reversals',()=>{
 const received={kind:'received'},keys=value=>mailItemActions(received,value).map(a=>a.key);
 assert.deepEqual(keys({folder:'inbox',is_read:0,is_starred:0}),['open','reply','forward','read','star','select','download','block','trash']);
 assert.deepEqual(keys({folder:'trash',is_read:1,is_starred:1}),['open','reply','forward','unread','unstar','select','download','block','restore']);
 assert(!mailItemActions({kind:'draft'},{id:'draft'}).some(a=>a.key==='read'));
});
test('quick filters preserve search phrases, replace only owned terms, and use the complete directory',()=>{
 assert.equal(mailFilterQuery('subject:"alpha beta" is:unread has:attachment -from:spam',{is:'read',has:'no'},mailSearchTerms),'subject:"alpha beta" -from:spam is:read -has:attachment');
 const rows=[{address:'a',group:'other',important:true,list_id:'list',detected:true},{address:'b',group:'other',important:false,list_id:'',detected:false},{address:'c',group:'automatic',important:true,list_id:'',detected:true}];
 assert.deepEqual(mailDirectoryFilter(rows,{group:'other',important:'yes'}).map(x=>x.address),['a']);assert.deepEqual(mailDirectoryFilter(rows,{source:'manual'}).map(x=>x.address),['b']);assert.deepEqual(mailDirectoryFilter(rows,{source:'sender'}).map(x=>x.address),['b','c']);assert.equal(mailDirectoryFilter(rows,{}).length,3);
});
test('a quick choice applies immediately and the same choice restores its own dimension only',()=>{
 let values={read:'',has:'yes'};values=mailToggleFilter(values,'read','unread');assert.deepEqual(values,{read:'unread',has:'yes'});
 values=mailToggleFilter(values,'read','unread');assert.deepEqual(values,{read:'',has:'yes'});
 assert.equal(mailFilterQuery('subject:"alpha beta" is:starred is:unread has:attachment',values,mailSearchTerms),'subject:"alpha beta" is:starred has:attachment');
 assert.deepEqual(mailToggleFilter({group:'other'},'group','other'),{group:''});assert.deepEqual(mailToggleFilter({order:'relevance',has:'no'},'order','relevance'),{order:'recent',has:'no'});
});

test('reopening the same previously unread reader persists read state again without rebuilding it',async()=>{
 const page=testHooks().PAGE,start=page.indexOf('async function openMail('),end=page.indexOf('  const readerTicket=++mailReaderIntent;',start),calls=[];
 const c={mailSelectReaderRow,$:()=>({querySelectorAll:()=>[]}),state:{cur:'1',curMail:{is_read:0}},pushMailReaderHistory(){},mailDrawer:{close(){}},document:{body:{classList:{add(){}}}},syncMailReader(){},mailToast(){},act:async(id,op)=>{calls.push([id,op]);c.state.curMail.is_read=1;return true}};vm.createContext(c);vm.runInContext(page.slice(start,end)+'}',c);await c.openMail('1');await c.openMail('1');assert.deepEqual(calls,[['1','read']]);
});

test('every delivered inline bootstrap parses with its actual combined declarations',()=>{
 const scripts=[...testHooks().PAGE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];assert(scripts.length>0);for(const [,script] of scripts)assert.doesNotThrow(()=>new Function(script));
});


test('filters narrow the page task without repeating its scope or exposing inert choices',()=>{
 const fields=(folder,data,filter={})=>mailListFilterFields(folder,{data,filter});
 assert.deepEqual(fields('important',{directory:[]}),[]);
 assert.deepEqual(fields('important',{directory:[{important:true,group:'other'}]}),[]);
 assert.deepEqual(fields('contacts',{directory:[{group:'other'},{group:'other'}]}),[]);
 const directory=[...Array.from({length:100},()=>({group:'other'})),{important:true,group:'automatic'}];
 assert.deepEqual(fields('contacts',{directory})[0].options.map(x=>x[0]),['','automatic','other']);
 assert.deepEqual(fields('important',{directory})[0]?.options,undefined);
 assert.deepEqual(fields('important',{directory:[]},{group:'automatic'})[0].options,[['','全部分类'],['automatic','自动通知']]);
 assert.deepEqual(fields('subscriptions',{sources:[{included:true,list_id:'x'},{included:true,list_id:''}]}),[]);
 assert.deepEqual(fields('drafts',{drafts:[]}),[]);
 assert.deepEqual(fields('drafts',{drafts:[{attachments:[]}]}),[]);
 assert.equal(fields('drafts',{drafts:[{attachments:[]},{attachments:[{}]}]})[0].name,'attachment');
 for(const folder of ['inbox','trash']){
  const list=fields(folder,{});assert.deepEqual(list.map(f=>f.name),['read','has']);assert(!list.flatMap(f=>f.options).some(([v])=>v==='starred'));
 }
 assert.deepEqual(fields('sent',{}).map(f=>f.name),['has']);
 assert.deepEqual(mailListFilterFields('inbox',{total:0}),[]);
 assert.deepEqual(mailListFilterFields('sent',{total:0}),[]);
 assert.equal(mailListFilterFields('inbox',{total:0,terms:mailSearchTerms('is:read')}).length,2);
 const query=mailSearchTerms('is:unread has:attachment');assert(!mailListFilterFields('inbox',{terms:query}).some(f=>f.name==='order'));
 assert(mailListFilterFields('inbox',{terms:mailSearchTerms('subject:project is:unread')}).some(f=>f.name==='order'));
});
test('changing reading filter preserves starred scope and unrelated search conditions',()=>{
 assert.equal(mailFilterQuery('is:starred subject:"alpha beta" -is:read has:attachment',{read:'read',has:''},mailSearchTerms),'is:starred subject:"alpha beta" is:read');
 assert.equal(mailFilterQuery('is:starred is:unread',{read:''},mailSearchTerms),'is:starred');
});

test('filter-only result captions keep the current page scope in readable language',()=>{
 assert.equal(mailFilterCaption('is:unread has:attachment','星标',mailSearchTerms),'星标 · 未读 · 有附件');
 assert.equal(mailFilterCaption('-is:read -has:attachment','垃圾箱',mailSearchTerms),'垃圾箱 · 未读 · 无附件');
 assert.equal(mailFilterCaption('subject:project is:read','收件箱',mailSearchTerms),'“subject:project is:read”');
});

test('failed first filter results replace the loading placeholder with the real scope and an unknown count',()=>{
 const page=testHooks().PAGE,heading=page.match(/function mailResultsBar\([^\n]+/)[0],failure=page.slice(page.indexOf('function showMailListFailure('),page.indexOf('\nasync function loadRoutes('));let loading=true,retries=0,markup='';
 const head={after(){}},notice={append(){}},host={querySelector:s=>s===':scope>.mail-page-skeleton'?(loading?{}:null):s==='.mail-list-error'?null:head,set innerHTML(v){markup=v;loading=false}};
 const ctx={state:{q:'is:unread -has:attachment',folder:'inbox'},mailFilterCaption,parseMailQuery:mailSearchTerms,esc:s=>s,mailListHeading(){},$:()=>host,document:{createElement:tag=>tag==='button'?{}:{...notice,setAttribute(){}}},mailAnimateListCommit:(_host,commit)=>commit(),refresh:()=>retries++};vm.createContext(ctx);vm.runInContext(heading+'\n'+failure,ctx);ctx.showMailListFailure('failed');assert.equal(loading,false);assert(markup.includes('收件箱 · 未读 · 无附件'));assert(!markup.includes('null'));assert(!markup.includes('0 封'));assert(!markup.includes('已加载'));assert.equal(retries,0);
});
