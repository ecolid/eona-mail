import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{fetchWithIdentity} from './src/index.js';
import {SQLiteD1} from './sv/storage.mjs';
function fixture(){
 const db=new SQLiteD1(':memory:');db.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const env={MAILDB:db,INBOX_PASSWORD:'fixture',PUBLIC_HOST:'mail.eona.top',READONLY_TOKENS:'fixture-readonly-'.padEnd(40,'x'),IMPORT_TOKENS:'fixture-import-'.padEnd(40,'x')};
 const call=(owner,path='',method='GET',value,origin)=>fetchWithIdentity(new Request('https://mail.eona.top/api/mail-workspace'+path,{method,headers:{'content-type':'application/json',...(origin?{origin}:{})},body:value===undefined?undefined:JSON.stringify(value)}),env,{authenticated:true,subject:owner,email:owner+'@example.test'});
 return {db,env,call};
}
const draft={to:'recipient@example.test',subject:'草稿',body:'正文',rev:0};
test('drafts persist per trusted account; revisions prevent silent overwrites and deletion races',async()=>{
 const s=fixture();try{
  let r=await s.call('a','/drafts/one','PUT',draft);assert.equal(r.status,200);assert.equal((await r.json()).draft.rev,1);
  assert.equal((await(await s.call('a')).json()).drafts[0].body,'正文');assert.deepEqual((await(await s.call('b')).json()).drafts,[]);
  r=await s.call('a','/drafts/one','PUT',{...draft,rev:1,body:'已修改'});assert.equal((await r.json()).draft.rev,2);
  assert.equal((await s.call('a','/drafts/one','PUT',{...draft,rev:1,body:'旧页面'})).status,409);
  assert.equal((await s.call('a','/drafts/one','DELETE',{rev:1})).status,409);
  assert.equal((await s.call('b','/drafts/one','DELETE',{rev:0})).status,200);assert.equal((await(await s.call('a')).json()).drafts.length,1);
  assert.equal((await s.call('a','/drafts/one','DELETE',{rev:2})).status,200);assert.deepEqual((await(await s.call('a')).json()).drafts,[]);
 }finally{s.db.close()}
});
test('important contacts are explicit preferences and folder counts derive from archive records',async()=>{
 const s=fixture();try{
  const contact={address:'Person@Example.test',name:'联系人'};
  assert.equal((await s.call('a','/contacts','PUT',contact)).status,200);await s.call('a','/contacts','PUT',{...contact,name:'新显示名'});
  let r=await(await s.call('a')).json();assert.equal(r.contacts.length,1);assert.equal(r.contacts[0].address,'person@example.test');assert.deepEqual(r.folders,[]);
  assert.deepEqual((await(await s.call('b')).json()).contacts,[]);
  s.db.db.prepare('INSERT INTO emails(alias,from_addr,folder,received_at) VALUES(?,?,?,?)').run('me@example.test','me@example.test','sent','2026-10-18 00:00:00');
  r=await(await s.call('a')).json();assert.equal(r.folders.find(f=>f.folder==='sent').count,1);
  await s.call('a','/contacts','DELETE',contact);assert.deepEqual((await(await s.call('a')).json()).contacts,[]);
 }finally{s.db.close()}
});
test('workspace rejects machine roles, cross-site writes, invalid fields and excessive bodies',async()=>{
 const s=fixture();try{
  for(const token of [s.env.READONLY_TOKENS,s.env.IMPORT_TOKENS])assert.equal((await worker.fetch(new Request('https://mail.eona.top/api/mail-workspace',{headers:{Authorization:'Bearer '+token}}),s.env)).status,403);
  assert.equal((await s.call('a','/drafts/one','PUT',draft,'https://other.example.test')).status,403);
  assert.equal((await s.call('a','/drafts/one','PUT',{...draft,to:'bad\r\nBcc:other@example.test'})).status,400);
  assert.equal((await s.call('a','/drafts/one','PUT',{...draft,body:'x'.repeat(50001)})).status,400);
  assert.equal((await s.call('a','/drafts/one','PUT',{...draft,body:'x'.repeat(260001)})).status,413);
  assert.deepEqual((await(await s.call('a')).json()).drafts,[]);
 }finally{s.db.close()}
});

test('sender labels and defaults persist per owner and follow authorized source changes',async()=>{
 const s=fixture();let accounts=[{id:'own',address:'me@example.test',name:'Source',available:true},{id:'other',address:'two@example.test',name:'',available:true}];s.env.MAIL_SENDER={list:async()=>accounts};
 try{
  assert.equal((await s.call('a','/sender-preferences','PUT',{default_id:'other',names:{own:'示例用户',other:'工作'}})).status,200);
  let choices=(await(await s.call('a')).json()).senders;assert.equal(choices.find(x=>x.default).id,'other');assert.equal(choices[0].name,'示例用户');assert.equal(choices[0].address,'me@example.test');
  choices=(await(await s.call('b')).json()).senders;assert.equal(choices[0].name,'Source');assert.equal(choices.find(x=>x.default).id,'own');
  for(const input of [{default_id:'forged',names:{}},{default_id:'own',names:{forged:'Name'}},{default_id:'own',names:{own:'X\r\nBcc:other@example.test'}},{default_id:'own',names:{},address:'forged@example.test'}])assert.equal((await s.call('a','/sender-preferences','PUT',input)).status,400);
  accounts=[accounts[0]];choices=(await(await s.call('a')).json()).senders;assert.equal(choices.length,1);assert.equal(choices[0].default,true);assert.equal(choices[0].name,'示例用户');
  await s.call('a','/sender-preferences','PUT',{default_id:'own',names:{own:''}});assert.equal((await(await s.call('a')).json()).senders[0].name,'Source');
 }finally{s.db.close()}
});

test('owner default display name covers future accounts and preserves explicit account overrides',async()=>{
 const s=fixture();let accounts=[{id:'own',address:'me@example.test',name:'Source',available:true},{id:'other',address:'two@example.test',name:'Source Two',available:true}];s.env.MAIL_SENDER={list:async()=>accounts};
 try{
  assert.equal((await s.call('a','/sender-preferences','PUT',{default_id:'own',default_name:'示例用户',names:{other:'工作'}})).status,200);
  let choices=(await(await s.call('a')).json()).senders;assert.equal(choices[0].name,'示例用户');assert.equal(choices[0].default_name,'示例用户');assert.equal(choices[1].name,'工作');assert.equal(choices[1].custom_name,'工作');
  accounts.push({id:'new',address:'new@example.test',name:'New Source',available:true});choices=(await(await s.call('a')).json()).senders;assert.equal(choices[2].name,'示例用户');assert.equal(choices[2].address,'new@example.test');
  assert.equal((await(await s.call('b')).json()).senders[0].name,'Source');
  await s.call('a','/sender-preferences','PUT',{default_id:'own',names:{other:'工作'}});assert.equal((await(await s.call('a')).json()).senders[0].name,'示例用户');
  for(const default_name of ['Bad\r\nBcc:other@example.test','x'.repeat(101),null])assert.equal((await s.call('a','/sender-preferences','PUT',{default_id:'own',default_name,names:{}})).status,400);
 }finally{s.db.close()}
});

test('compact workspace validates unchanged state with 304, observes writes, and omits sent bodies until detail is opened',async()=>{
 const s=fixture();try{
  await s.call('a');const payload={from:{address:'a@example.test'},to:[{address:'b@example.test'}],cc:[],bcc:[],subject:'Large HTML',body:'private body'.repeat(1000),html:'<p>'+ 'content'.repeat(30000)+'</p>'};
  s.db.db.prepare("INSERT INTO mail_outbox(owner,id,draft_id,draft_rev,payload_json,state,message_id,created_at,updated_at) VALUES(?,?,?,?,?,'sent',?,?,?)").run('a','sent-one','draft-one',1,JSON.stringify(payload),'<one@example.test>','2026-10-19T00:00:00Z','2026-10-19T00:00:00Z');
  const call=(path,etag)=>fetchWithIdentity(new Request('https://mail.eona.top/api/mail-workspace'+path,{headers:etag?{'if-none-match':etag}:{}}),s.env,{authenticated:true,subject:'a',email:'a@example.test'});
  const initial=await call('?view=compact'),etag=initial.headers.get('etag'),summary=await initial.json();assert.equal(summary.sent_total,1);assert.equal(summary.sent[0].body,undefined);assert.equal((await call('?view=compact',etag)).status,304);
  const page=await(await call('/sent?view=compact')).json();assert(page.messages[0].body.length<=160);assert.equal(page.messages[0].view_html,undefined);assert.equal(page.messages[0].html,undefined);
  const detail=await(await call('/sent/sent-one')).json();assert.equal(detail.message.view_html,payload.html);assert.equal(detail.message.body,payload.body);
  await s.call('a','/drafts/one','PUT',draft);const changed=await call('?view=compact',etag);assert.equal(changed.status,200);assert.notEqual(changed.headers.get('etag'),etag);assert.equal((await changed.json()).drafts.length,1);
 }finally{s.db.close()}
});

test('blocking reports existing rules; undo only removes the exact newly created rule',async()=>{
 const s=fixture();const send=async(method,value)=>fetchWithIdentity(new Request('https://mail.eona.top/api/block',{method,headers:{'content-type':'application/json'},body:JSON.stringify(value)}),s.env,{authenticated:true,subject:'a',email:'a@example.test'});
 try{
  const first=await(await send('POST',{pattern:'Sender@Example.test'})).json();assert.equal(first.added,true);assert.equal(first.block.pattern,'sender@example.test');
  const existing=await(await send('POST',{pattern:'sender@example.test'})).json();assert.equal(existing.added,false);assert.equal(existing.block.id,first.block.id);
  assert.equal((await send('DELETE',{...first.block,pattern:'different@example.test'})).status,409);assert.equal(s.db.db.prepare('SELECT count(*) n FROM blocked_senders').get().n,1);
  assert.equal((await send('DELETE',first.block)).status,200);const replaced=await(await send('POST',{pattern:'sender@example.test'})).json();assert.notEqual(replaced.block.id,first.block.id);
  assert.equal((await send('DELETE',first.block)).status,409);assert.equal(s.db.db.prepare('SELECT count(*) n FROM blocked_senders').get().n,1);
 }finally{s.db.close()}
});
