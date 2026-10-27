import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore} from './store.mjs';
import {validateConfig,publicAccounts} from './config.mjs';
import {sourceHealthAPI,sourceHealth} from './source-health.mjs';
const folders=[{name:'INBOX',kind:'inbox'},{name:'All',kind:'archive'},{name:'Sent',kind:'sent'},{name:'Drafts',kind:'drafts'},{name:'Trash',kind:'trash'}];
const account={id:'google',address:'owner@example.test',sync:{enabled:false},imap:{provider:'gmail',host:'imap.gmail.com',port:993,user:'owner@example.test',password_env:'GOOGLE_PASSWORD',discovery:'all',folders}};
const config=root=>({schema:1,mode:'personal',auth:{mode:'local'},origin:'http://127.0.0.1:8799',data_root:root,owner:{id:'owner',email:'owner@example.test'},sync:{enabled:true},accounts:[account]});
const raw=(id,to='other@example.test')=>Buffer.from(`Message-ID: <${id}@example.test>\r\nFrom: owner@example.test\r\nTo: ${to}\r\nDate: Tue, 01 Jan 2019 10:00:00 +0000\r\nSubject: ${id}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\nOriginal body\r\n--b\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="proof.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECAw==\r\n--b--\r\n`);
const source=(folder,uid,mid,labels,more={})=>({account:'google',folder,kind:folders.find(f=>f.name===folder)?.kind||'archive',validity:'1',uid:String(uid),historical:true,gmail:{message_id:mid,labels},...more});
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'mail-gmail-')),c=validateConfig(config(root)),store=await openStore(c);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});await sourceHealthAPI('/internal/product/source-inventory',{account:'google',state:'connected',folders},store,c);return {store,c};}
test('Gmail aggregate-first intake preserves Sent, one logical mail and all original/label proofs without source writes',async t=>{
 const {store,c}=await fixture(t),original=raw('sent');let arrivals=0;store.env.MAIL_SOURCE_ARRIVAL=async()=>{arrivals++;};
 const first=await store.ingest(original,source('All',1,'18446744073709551615',['\\Sent']));
 const second=await store.ingest(original,source('Sent',7,'18446744073709551615',['\\Sent']));assert.equal(first.id,second.id);
 assert.equal((await store.db.prepare('SELECT folder FROM emails WHERE id=?').bind(first.id).first()).folder,'sent');
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM mail_outbox').first()).n,1);
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_gmail_copies').first()).n,2);
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_state_intents').first()).n,0);assert.equal(arrivals,0);
 const snapshot=JSON.parse((await store.db.prepare('SELECT payload_json FROM mail_outbox').first()).payload_json);assert.equal(snapshot.attachments.length,1);
 const attachment=await store.db.prepare('SELECT data_base64 FROM mail_assets WHERE id=?').bind(snapshot.attachments[0].id).first();assert.equal(attachment.data_base64,'AAECAw==');
 for(const copy of (await store.db.prepare('SELECT raw_key FROM product_source_copies').all()).results)assert.deepEqual(Buffer.from(await(await store.objects.get(copy.raw_key)).arrayBuffer()),original);
 for(const [folder,uids] of [['All',['1']],['Sent',['7']],['INBOX',[]],['Drafts',[]],['Trash',[]]])await sourceHealthAPI('/internal/product/source-coverage',{account:'google',folder,validity:'1',uids},store,c);
 assert.equal((await sourceHealth(store.db,c)).accounts[0].coverage,'complete');assert.equal(publicAccounts(c)[0].send,false);assert.equal(publicAccounts(c)[0].sync,false);
});
test('full Gmail sync queues local state, retains full-folder coverage and leaves draft revision ownership to the workspace',async t=>{
 const root=await mkdtemp(join(tmpdir(),'mail-gmail-full-')),input=config(root);input.accounts=[{...account,sync:{enabled:true}}];const c=validateConfig(input),store=await openStore(c);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 await sourceHealthAPI('/internal/product/source-inventory',{account:'google',state:'connected',folders},store,c);
 const mail=await store.ingest(raw('incoming'),source('INBOX',1,'100',[]));
 await store.ingest(raw('sent'),source('All',2,'101',['\\Sent']));await store.ingest(raw('sent'),source('Sent',3,'101',[]));
 await store.ingest(raw('draft'),source('Drafts',4,'102',[]));
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM mail_outbox').first()).n,1);
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM mail_drafts').first()).n,0,'the workspace owns editable draft revisions');
 await store.db.prepare('UPDATE emails SET is_read=1,is_starred=1 WHERE id=?').bind(mail.id).run();assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_state_intents').first()).n,1);
 await store.db.prepare("INSERT INTO product_source_status(account,folder,state,checked_at) VALUES('google','Sent','ok','now')").run();
 const again=await openStore(c);assert.equal((await again.db.prepare("SELECT COUNT(*) n FROM product_source_status WHERE account='google' AND folder='Sent'").first()).n,1);again.close();
 assert.equal(publicAccounts(c)[0].sync,true);
});
test('self-sent Inbox is in both Inbox and Sent; a new message alerts once across Gmail label copies',async t=>{
 const {store}=await fixture(t);let arrivals=0;store.env.MAIL_SOURCE_ARRIVAL=async()=>{arrivals++;};
 const message=raw('self','owner@example.test'),labels=['\\Inbox','\\Sent','\\Starred','Projects (2026)'];
 const one=await store.ingest(message,source('All',8,'123',labels,{historical:false}));
 await store.ingest(message,source('INBOX',9,'123',labels,{historical:false}));
 await store.ingest(message,source('Sent',10,'123',labels,{historical:false}));
 assert.equal(arrivals,1);assert.equal((await store.db.prepare('SELECT folder,is_starred FROM emails WHERE id=?').bind(one.id).first()).folder,'inbox');
 assert.equal((await store.db.prepare('SELECT is_starred FROM emails WHERE id=?').bind(one.id).first()).is_starred,1);
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM mail_outbox').first()).n,1);
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_state_intents').first()).n,0);
 const gmail=await store.db.prepare('SELECT labels_json FROM product_gmail_copies LIMIT 1').first();assert.deepEqual(JSON.parse(gmail.labels_json),labels);
 await store.db.prepare('UPDATE emails SET is_read=1,is_starred=0 WHERE id=?').bind(one.id).run();
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_state_intents').first()).n,0,'a local Gmail read cannot strand other accounts in pending state synchronization');
});
test('historical labels do not become new arrivals; missing metadata and receive-only violations fail closed',async t=>{
 const {store,c}=await fixture(t);let arrivals=0;store.env.MAIL_SOURCE_ARRIVAL=async()=>{arrivals++;};
 await store.ingest(raw('old'),source('All',1,'100',['\\Inbox']));
 await store.ingest(raw('old'),source('INBOX',2,'100',['\\Inbox'],{historical:false}));assert.equal(arrivals,0);
 await assert.rejects(()=>store.ingest(raw('missing'),{...source('All',3,'101',[]),gmail:null}),/gmail_metadata_invalid/);
 const bad=config('/tmp/gmail-invalid');assert.equal(publicAccounts(validateConfig({...bad,accounts:[{...account,sync:{enabled:true}}]}))[0].sync,true);
 assert.equal(publicAccounts(validateConfig({...bad,accounts:[{...account,smtp:{host:'smtp.gmail.com',port:465,user:'owner@example.test',password_env:'GOOGLE_PASSWORD'}}]}))[0].send,true);
 await store.db.prepare("INSERT INTO product_source_status(account,folder,state,checked_at) VALUES('google','Sent','ok','now')").run();
 const again=await openStore(c);assert.equal((await again.db.prepare("SELECT COUNT(*) n FROM product_source_status WHERE account='google' AND folder='Sent'").first()).n,1);again.close();
});

test('Gmail SMTP unknown outcome resolves from the source Sent copy without duplicate send or Sent row',async t=>{
 const {store,c}=await fixture(t);
 c.accounts=[{...account,smtp:{host:'smtp.gmail.com',port:465,user:'owner@example.test',password_env:'GOOGLE_PASSWORD'}}];
 const {productSender}=await import('./connectors.mjs');const {fetchWithIdentity}=await import('../src/index.js');let submissions=0,captured;
 store.env.MAIL_SENDER=productSender(c,()=> 'synthetic-password',{createTransport:options=>{assert.equal(options.host,'smtp.gmail.com');assert.equal(options.secure,true);assert.equal(options.tls.rejectUnauthorized,true);return {verify:async()=>true,sendMail:async message=>{submissions++;captured=message.raw;throw Error('lost final SMTP response');}};}});
 const req=(path,body)=>fetchWithIdentity(new Request(c.origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),store.env,{authenticated:true,subject:c.owner.id,email:c.owner.email});
 const save=await fetchWithIdentity(new Request(c.origin+'/api/mail-workspace/drafts/gmail-send',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({rev:0,to:'recipient@example.test',subject:'SMTP source recovery',body:'Synthetic original',from_id:'google'})}),store.env,{authenticated:true,subject:c.owner.id,email:c.owner.email});assert.equal(save.status,200);
 const intent={draft_id:'gmail-send',rev:1,attempt_id:'gmail-once'};const response=await req('/api/mail-workspace/send',intent);assert.equal((await response.json()).message.state,'unknown');assert.equal(submissions,1);
 await store.ingest(captured,source('All',21,'999',['\\Sent']));await store.ingest(captured,source('Sent',22,'999',['\\Sent']));
 const rows=(await store.db.prepare('SELECT id,state FROM mail_outbox').all()).results;assert.deepEqual(rows.map(row=>({...row})),[{id:'gmail-once',state:'sent'}]);
 assert.equal((await(await req('/api/mail-workspace/send',intent)).json()).message.state,'sent');assert.equal(submissions,1);
 assert.equal((await store.db.prepare("SELECT COUNT(*) n FROM mail_drafts WHERE id='gmail-send'").first()).n,0);
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_source_copies').first()).n,2);
});


test('source Sent confirmation before a late SMTP disconnect stays final and preserves newer draft edits',async t=>{
 const {store,c}=await fixture(t);c.accounts=[{...account,smtp:{host:'smtp.gmail.com',port:465,user:'owner@example.test',password_env:'GOOGLE_PASSWORD'}}];
 const {productSender}=await import('./connectors.mjs');const {fetchWithIdentity}=await import('../src/index.js');
 const trusted={authenticated:true,subject:c.owner.id,email:c.owner.email};
 const save=async(rev,body)=>fetchWithIdentity(new Request(c.origin+'/api/mail-workspace/drafts/gmail-race',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({rev,to:'recipient@example.test',subject:'SMTP race',body,from_id:'google'})}),store.env,trusted);
 store.env.MAIL_SENDER=productSender(c,()=> 'synthetic-password',{createTransport:()=>({sendMail:async message=>{
  assert.equal((await save(1,'Newer unsent edit')).status,200);
  await store.ingest(message.raw,source('All',31,'777',['\\Sent']));throw Error('late SMTP disconnect');
 }})});
 assert.equal((await save(0,'Original submitted content')).status,200);
 const response=await fetchWithIdentity(new Request(c.origin+'/api/mail-workspace/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({draft_id:'gmail-race',rev:1,attempt_id:'race-once'})}),store.env,trusted);
 assert.equal((await response.json()).message.state,'sent');
 const draft=await store.db.prepare("SELECT rev,body FROM mail_drafts WHERE id='gmail-race'").first();assert.equal(draft.rev,2);assert.equal(draft.body,'Newer unsent edit');
});


test('SMTP availability does not invent a source-writeback status for a receive-only account',async t=>{
 const {store,c}=await fixture(t);c.accounts=[{...account,smtp:{host:'smtp.gmail.com',port:465,user:'owner@example.test',password_env:'GOOGLE_PASSWORD'}}];
 const {productSender}=await import('./connectors.mjs');const {fetchWithIdentity}=await import('../src/index.js');
 store.env.MAIL_SENDER=productSender(c,()=> 'synthetic-password');store.env.MAIL_SYNC_ENABLED=true;
 const read=async()=>{const response=await fetchWithIdentity(new Request(c.origin+'/api/mail-workspace?view=compact',{headers:{'cache-control':'no-cache'}}),store.env,{authenticated:true,subject:c.owner.id,email:c.owner.email});assert.equal(response.status,200);return response.json()};
 let result=await read();assert.equal(result.senders[0].sync,false);assert.equal(result.send_mode,'smtp');assert.equal(result.sync.configured,false);assert.deepEqual(result.sync.accounts,[]);
 const gmail=result.senders[0];store.env.MAIL_SENDER={list:async()=>[gmail,{id:'writable',address:'other@example.test',available:true}]};
 result=await read();assert.equal(result.sync.configured,true);assert.deepEqual(result.sync.accounts.map(a=>a.account),['writable']);assert.equal(result.sync.accounts[0].state,'starting','unknown writable source status is retained');
});
