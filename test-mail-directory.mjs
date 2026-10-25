import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SQLiteD1} from './sv/storage.mjs';
import {initializeMailWorkspace} from './src/mail-send.js';
import {mailSourceHeaders,recordMailSourceHeaders,mailDirectory,mailDirectoryMessages,cleanMailName,backfillMailSourceHeaders} from './src/mail-directory.js';
import PostalMime from 'postal-mime';
import {listOriginFromRoutes} from './src/mail-origin-evidence.js';
async function fixture(){const db=new SQLiteD1(':memory:');db.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));await initializeMailWorkspace(db);return db}
const parsed=(id,name='',extra={})=>({headers:[...(id?[{key:'list-id',value:(name?name+' ':'')+'<'+id+'>'}]:[]),...Object.entries(extra).map(([key,value])=>({key,value}))]});
test('lists use MIME List-ID; shared names/domains and distinct people never merge',async()=>{
 const db=await fixture();try{
  const add=db.db.prepare("INSERT INTO emails(id,alias,from_addr,from_name,subject,folder,received_at) VALUES(?,'owner@example.test',?,?,'Subject','inbox','2026-10-21 10:00:00')");
  for(const [id,address,name,list] of [[1,'one@letters.test','Same','alpha.letters.test'],[2,'two@letters.test','Same','alpha.letters.test'],[3,'one@letters.test','Same','beta.letters.test'],[4,'person1@work.test','Person',''],[5,'person2@work.test','Person','']]){add.run(id,address,name);await recordMailSourceHeaders(db,id,parsed(list,list==='alpha.letters.test'?'Letter':''))}
  let d=await mailDirectory(db,'a');assert.equal(d.directory.length,4);assert.equal(d.sources.length,2);assert.equal(d.sources.find(s=>s.list_id==='beta.letters.test').name,'Same');assert.equal(d.sources[0].addresses.length,2);assert.equal(d.sources[0].received_count,2);assert.equal(d.source_coverage.indexed_count,5);
  db.db.prepare("INSERT INTO mail_source_preferences VALUES('a','list:alpha.letters.test',0)").run();d=await mailDirectory(db,'a');assert.equal(d.sources.find(s=>s.key==='list:alpha.letters.test').included,false);assert.equal((await mailDirectory(db,'b')).sources.every(s=>s.included),true);
  db.db.prepare("INSERT INTO mail_important_contacts VALUES('a','two@letters.test','Chosen','now')").run();d=await mailDirectory(db,'a');assert.equal(d.directory.find(c=>c.address==='two@letters.test').important,true);assert.equal(d.directory.find(c=>c.address==='one@letters.test').important,undefined);
 }finally{db.close()}
});
test('correspondence pagination includes exact-address sent To/Cc/Bcc once and isolates owners',async()=>{
 const db=await fixture();try{
  for(let i=0;i<33;i++)db.db.prepare("INSERT INTO emails(id,alias,from_addr,subject,folder,received_at) VALUES(?,'owner@work.test','person@work.test',?,'inbox','2026-10-21 00:00:00')").run(i+1,'Received '+i);
  const payload={from:{address:'owner@work.test'},to:[{address:'person@work.test'}],cc:[{address:'person@work.test'}],bcc:[],subject:'Sent',body:'private'};
  for(const owner of ['a','b'])db.db.prepare("INSERT INTO mail_outbox(owner,id,draft_id,draft_rev,payload_json,state,message_id,created_at,updated_at) VALUES(?,?,'draft',1,?,'sent','<test@example.test>','2026-10-21T12:00:00Z','now')").run(owner,owner,JSON.stringify(payload));
  const a=await mailDirectoryMessages(db,'a',{address:'person@work.test'}),b=await mailDirectoryMessages(db,'a',{address:'person@work.test',offset:a.next});assert.equal(a.total,34);assert.equal(a.messages.length,30);assert.equal(b.messages.length,4);assert.equal(a.messages.filter(m=>m.kind==='sent').length,1);assert.equal(a.messages[0].id,'a');assert.equal(new Set([...a.messages,...b.messages].map(m=>m.kind+':'+m.id)).size,34);
  for(const message of [...a.messages,...b.messages]){assert.equal(message.reader_preview.id,message.id);assert.equal(message.reader_preview.subject,message.subject);assert.equal('translation_preview'in message.reader_preview,false);if(message.kind==='received')assert.equal(message.reader_preview.from_addr,'person@work.test');else assert.equal(message.reader_preview.from.address,'owner@work.test')}
  assert.equal(a.messages.some(m=>m.kind==='sent'&&m.reader_preview.id==='b'),false);
  assert.equal((await mailDirectoryMessages(db,'a',{address:'person@work.test.evil'})).total,0);
 }finally{db.close()}
});
test('subscription and automation require explicit header evidence; corrupted names fall back to addresses',()=>{
 assert.equal(mailSourceHeaders(parsed('')).unsubscribe,false);assert.equal(mailSourceHeaders(parsed('','',{'list-unsubscribe':'<https://example.test/remove>'})).unsubscribe,true);assert.equal(mailSourceHeaders(parsed('','',{'auto-submitted':'no'})).automatic,false);assert.equal(mailSourceHeaders(parsed('','',{'precedence':'bulk'})).automatic,true);assert.equal(cleanMailName('坏\ufffd姓名'),'');assert.equal(mailSourceHeaders(parsed('unsafe <script>')).list_id,'');
});
test('list origin uses registered ingress and preserves explicit sub-mailbox evidence or ambiguity',()=>{
 const routes=[{mailbox:'parent@work.test',alias:'parent@eona.top',hop:''},{mailbox:'child@work.test',alias:'parent@eona.top',hop:'parent@work.test'}];
 const headers={'list-id':'repo.example.test','x-forwarded-for':'parent@eona.top destination@icloud.com','x-forwarded-to':'destination@icloud.com'},get=k=>headers[k]||'';
 assert.equal(listOriginFromRoutes(get,{to:[{address:'repo@noreply.example.test'}]},routes),'parent@work.test');headers['x-original-to']='child@work.test';assert.equal(listOriginFromRoutes(get,{to:[]},routes),null);delete headers['x-original-to'];assert.equal(listOriginFromRoutes(get,{to:[{address:'child@work.test'}]},routes),null);assert.equal(listOriginFromRoutes(get,{to:[]},[...routes,{mailbox:'second@work.test',alias:'parent@eona.top',hop:''}]),null);
});
test('a missed source index retries from the stored original in bounded batches and keeps unavailable originals pending',async()=>{
 const db=await fixture();try{
  for(let id=1;id<=6;id++)db.db.prepare("INSERT INTO emails(id,alias,from_addr,raw_key,received_at) VALUES(?,'owner@example.test','letters@example.test',?,'2026-10-21 00:00:00')").run(id,'raw/'+id);
  let available=false;const objects={get:async()=>available?{arrayBuffer:async()=>Buffer.from('From: letters@example.test\r\nList-ID: News <news.example.test>\r\n\r\nBody')}:null};
  await assert.rejects(backfillMailSourceHeaders(db,objects,PostalMime,4),/source_raw_missing/);assert.equal(db.db.prepare('SELECT count(*) n FROM mail_source_headers').get().n,0);
  available=true;assert.equal(await backfillMailSourceHeaders(db,objects,PostalMime,4),4);assert.equal(await backfillMailSourceHeaders(db,objects,PostalMime,4),2);assert.equal(await backfillMailSourceHeaders(db,objects,PostalMime,4),0);assert.equal(db.db.prepare('SELECT count(*) n FROM mail_source_headers').get().n,6);
 }finally{db.close()}
});
