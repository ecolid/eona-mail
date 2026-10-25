import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fetchWithIdentity} from './src/index.js';
import {SQLiteD1} from './sv/storage.mjs';
import {createMailSender} from './sv/mail-sender.mjs';
const sender={id:'own',address:'owner@example.test',name:'Owner',available:true};
const draft={to:'Recipient <to@example.test>',cc:'cc@example.test',bcc:'bcc@example.test',from_id:'own',subject:'站内发送',body:'完整正文',rev:0};
function fixture(send=async()=>({accepted:['to@example.test','cc@example.test','bcc@example.test'],rejected:[]})){
 const db=new SQLiteD1(':memory:');db.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));let calls=0;
 const env={MAILDB:db,MAIL_SENDER:{list:async owner=>owner==='owner'?[sender]:[],send:async(...args)=>{calls++;return send(...args)}}};
 const call=(path='',method='GET',data,owner='owner')=>fetchWithIdentity(new Request('https://mail.eona.top/api/mail-workspace'+path,{method,headers:{origin:'https://mail.eona.top','content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),env,{authenticated:true,subject:owner,email:owner+'@example.test'});
 return {db,env,call,get calls(){return calls},save:async(d=draft)=>{const response=await call('/drafts/draft','PUT',d);assert.equal(response.status,200);return (await response.json()).draft},submit:async(rev=1,id='attempt')=>(await call('/send','POST',{draft_id:'draft',rev,attempt_id:id})).json()};
}
test('successful send persists an account-owned receipt and removes exactly the submitted draft revision',async()=>{
 const s=fixture();try{const saved=await s.save();assert.equal(saved.bcc,'bcc@example.test');const result=await s.submit();assert.equal(result.message.state,'sent');assert.match(result.message.message_id,/@example.test>/);assert.equal(s.calls,1);
 const state=await(await s.call()).json();assert.equal(state.drafts.length,0);assert.equal(state.sent.length,1);assert.equal(state.sent[0].bcc[0].address,'bcc@example.test');assert.equal(state.directory.find(c=>c.address==='to@example.test').name,'Recipient');
 assert.equal((await(await s.call('/send/attempt','GET',undefined,'other')).json()).message,undefined);assert.equal((await(await s.call('','GET',undefined,'other')).json()).sent.length,0);
 assert.equal((await s.submit()).message.id,'attempt');assert.equal(s.calls,1);
 }finally{s.db.close()}
});
test('concurrent double submissions, even with different attempt IDs, invoke the transport once',async()=>{
 let finish;const s=fixture(()=>new Promise(resolve=>finish=resolve));try{await s.save();const first=s.submit();while(!finish)await new Promise(resolve=>setImmediate(resolve));const second=await s.submit(1,'second');assert.equal(second.message.state,'sending');assert.equal(second.message.id,'attempt');assert.equal(s.calls,1);finish({accepted:['to@example.test'],rejected:[]});assert.equal((await first).message.state,'sent')}finally{s.db.close()}
});
test('ambiguous transport outcome preserves the draft and never replays on repeated or changed send intents',async()=>{
 const s=fixture(async()=>{throw Error('socket closed after DATA')});try{await s.save();assert.equal((await s.submit()).message.state,'unknown');assert.equal((await s.submit(1,'second')).message.id,'attempt');await s.save({...draft,rev:1,body:'后来编辑'});const response=await s.call('/send','POST',{draft_id:'draft',rev:2,attempt_id:'third'});assert.equal(response.status,409);assert.equal(s.calls,1);assert.equal((await(await s.call()).json()).drafts[0].body,'后来编辑');assert.equal((await(await s.call()).json()).sent.length,0)}finally{s.db.close()}
});
test('explicit SMTP rejection retains the draft; a new user submission after saving can retry',async()=>{
 let fail=true;const s=fixture(async()=>{if(fail){const e=Error();e.definitelyNotSent=true;throw e}return {accepted:['to@example.test'],rejected:[]}});try{await s.save();assert.equal((await s.submit()).message.state,'failed');assert.equal((await(await s.call()).json()).drafts.length,1);assert.equal((await s.submit()).message.state,'failed');assert.equal(s.calls,1);fail=false;await s.save({...draft,rev:1});assert.equal((await s.submit(2,'retry')).message.state,'sent');assert.equal(s.calls,2)}finally{s.db.close()}
});
test('newer draft edits survive an earlier successful send; partial acceptance is distinct',async()=>{
 let finish;const s=fixture(()=>new Promise(resolve=>finish=resolve));try{await s.save();const sent=s.submit();while(!finish)await new Promise(resolve=>setImmediate(resolve));await s.save({...draft,rev:1,body:'下一封尚未发送'});finish({accepted:['to@example.test'],rejected:['cc@example.test']});assert.equal((await sent).message.state,'partial');const state=await(await s.call()).json();assert.equal(state.drafts[0].body,'下一封尚未发送');assert.equal(state.sent[0].rejected[0],'cc@example.test')}finally{s.db.close()}
});
test('send rejects stale revisions, forged sender identities and malformed recipients before transport',async()=>{
 const s=fixture();try{await s.save({...draft,to:'bad address'});assert.equal((await s.call('/send','POST',{draft_id:'draft',rev:1,attempt_id:'bad'})).status,400);await s.save({...draft,rev:1,from_id:'forged'});assert.equal((await s.call('/send','POST',{draft_id:'draft',rev:2,attempt_id:'forged'})).status,409);assert.equal((await s.call('/send','POST',{draft_id:'draft',rev:1,attempt_id:'stale'})).status,409);assert.equal(s.calls,0)}finally{s.db.close()}
});
test('sender reloads current sources, enforces account scope, hides credentials and uses authenticated TLS',async()=>{
 let rows=[{...sender,user:sender.address,host:'smtp.example.test',port:465,password:'private-test-secret'}],options,captured;
 const service=createMailSender({authorized_owners:['owner'],loadAccounts:async()=>rows},config=>{options=config;return {sendMail:async mail=>{captured=mail;return {accepted:['to@example.test'],rejected:[]}}}});
 assert.deepEqual(await service.list('other'),[]);assert.doesNotMatch(JSON.stringify(await service.list('owner')),/private-test-secret/);
 await service.send('owner',{from_id:'own',from:sender,to:[{address:'to@example.test'}],cc:[],bcc:[],subject:'Title',body:'Text',messageId:'<fixed@example.test>'});
 assert.equal(options.secure,true);assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.debug,false);assert.equal(captured.messageId,'<fixed@example.test>');assert.equal(captured.text,'Text');assert.equal(captured.disableUrlAccess,true);
 rows=[];await assert.rejects(()=>service.send('owner',{from_id:'own',from:sender}),e=>e.definitelyNotSent===true);
});
test('sent search covers the complete account archive with matching counts, pages and off-page selection',async()=>{
 const s=fixture();try{await s.call();for(let i=0;i<80;i++){
 const p={from_id:'own',from:sender,to:[{address:'recipient@example.test',name:'Recipient'}],cc:[],bcc:[],subject:i===0?'唯一%标识':'Record '+i,body:i===0?'archive-wide needle':'Body'};
 s.db.db.prepare("INSERT INTO mail_outbox(owner,id,draft_id,draft_rev,payload_json,state,message_id,created_at,updated_at) VALUES(?,?,?,?,?,'sent',?,?,?)").run('owner','record-'+i,'d-'+i,1,JSON.stringify(p),'<'+i+'@example.test>',new Date(Date.UTC(2026,9,1,0,i)).toISOString(),new Date().toISOString());
 }
 let page=await(await s.call('/sent?selected_id=record-0')).json();assert.equal(page.total,80);assert.equal(page.messages.length,50);assert.equal(page.next,50);assert.equal(page.selected_matches,true);assert.equal(page.selected_message.id,'record-0');assert(!page.messages.some(m=>m.id==='record-0'));
 page=await(await s.call('/sent?offset=50')).json();assert.equal(page.messages.length,30);assert.equal(page.next,null);
 const params=new URLSearchParams({q:'from:owner@example.test to:recipient@example.test body:needle',selected_id:'record-0'});page=await(await s.call('/sent?'+params)).json();assert.equal(page.total,1);assert.equal(page.messages[0].id,'record-0');assert.equal(page.selected_matches,true);
 page=await(await s.call('/sent?q=missing&selected_id=record-0')).json();assert.equal(page.total,0);assert.equal(page.selected_matches,false);
 assert.equal((await(await s.call('/sent','GET',undefined,'other')).json()).total,0);
 assert.equal((await(await s.call()).json()).sent_total,80);assert.equal((await(await s.call()).json()).sent.length,50);
 }finally{s.db.close()}
});

test('empty recipient, subject and body are rejected before any physical sending intent',async()=>{
 for(const invalid of [{to:''},{subject:''},{body:''}]){
  const s=fixture();try{await s.save({...draft,...invalid});const response=await s.call('/send','POST',{draft_id:'draft',rev:1,attempt_id:'empty'});assert.equal(response.status,400);assert.equal(s.calls,0);assert.equal(s.db.db.prepare('SELECT COUNT(*) AS n FROM mail_outbox').get().n,0);assert.equal((await(await s.call()).json()).drafts.length,1)}finally{s.db.close()}
 }
});

test('stored owner display name reaches the transport without changing authorized sender address',async()=>{
 let message;const s=fixture(async(owner,value)=>{message=value;return {accepted:['to@example.test'],rejected:[]}});
 try{await s.call('/sender-preferences','PUT',{default_id:'own',names:{own:'示例用户'}});await s.save();const sent=await s.submit();assert.equal(sent.message.from.name,'示例用户');assert.equal(message.from.name,'示例用户');assert.equal(message.from.address,sender.address)}finally{s.db.close()}
 let physical;const service=createMailSender({authorized_owners:['owner'],loadAccounts:async()=>[{...sender,user:sender.address,host:'smtp.example.test',port:465,password:'fixture'}]},()=>({sendMail:async mail=>{physical=mail;return {accepted:['to@example.test']}}}));
 await service.send('owner',{from_id:'own',from:{address:sender.address,name:'示例用户'},to:[{address:'to@example.test'}],body:'Body'});assert.equal(physical.from.name,'示例用户');assert.equal(physical.from.address,sender.address);
});

test('owner default display name reaches the transport without a per-account replica',async()=>{
 const s=fixture();let message;s.env.MAIL_SENDER={list:async()=>[sender],send:async(_owner,value)=>{message=value;return {accepted:[draft.to],rejected:[]}}};
 try{await s.call('/sender-preferences','PUT',{default_id:'own',default_name:'示例用户',names:{}});await s.save();const sent=await s.submit();assert.equal(sent.message.from.name,'示例用户');assert.equal(message.from.name,'示例用户');assert.equal(message.from.address,sender.address)}finally{s.db.close()}
});
