import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {openProduct} from './runtime.mjs';
import {validateConfig} from './config.mjs';
import {openStore} from './store.mjs';
import {initialize} from './cli.mjs';

const password='internal-test-password-only';
const config=(root,more={})=>({schema:1,mode:'demo',origin:'http://127.0.0.1:18789',owner:{id:'test-owner',email:'owner@example.test'},data_root:root,accounts:[],...more});
const raw=(body='First body',id='same-id',extra='')=>Buffer.from('Message-ID: <'+id+'@example.test>\r\nFrom: Author <author@example.test>\r\nTo: owner@example.test\r\nDate: Sun, 25 Oct 2026 10:00:00 +0000\r\nSubject: Product test\r\n'+extra+'MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+body+'\r\n');
const proof=(uid,more={})=>({account:'one',folder:'INBOX',validity:'42',uid:String(uid),kind:'inbox',historical:false,...more});
const account={id:'one',address:'owner@example.test',imap:{host:'imap.example.test',port:993,user:'owner',password_env:'IMAP_PASSWORD',folders:[{name:'INBOX',kind:'inbox'},{name:'Sent',kind:'sent'},{name:'Drafts',kind:'drafts'}]},smtp:{host:'smtp.example.test',port:465,user:'owner',password_env:'SMTP_PASSWORD'}};
const noNetwork=async()=>{throw Error('unexpected_external_request')};
test('historical mail without a Date uses provider INTERNALDATE and missing provenance cannot become new mail',async t=>{
 const root=await temporary(t),store=await openStore(validateConfig(config(root,{mode:'personal',auth:{mode:'local'},accounts:[account]})));t.after(()=>store.close());
 const original=Buffer.from(raw().toString().replace(/Date:[^\r]*\r\n/,''));
 await assert.rejects(()=>store.ingest(original,proof(1,{historical:true})),/product_source_date_unavailable/);
 assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM emails').first()).n,0);
 const result=await store.ingest(original,proof(1,{historical:true,internal_date:'2014-02-07T07:30:56Z'}));
 assert.equal((await store.db.prepare('SELECT received_at FROM emails WHERE id=?').bind(result.id).first()).received_at,'2014-02-07 07:30:56');
 const copy=await store.db.prepare('SELECT raw_key FROM product_source_copies WHERE email_id=?').bind(result.id).first();assert.deepEqual(Buffer.from(await (await store.objects.get(copy.raw_key)).arrayBuffer()),original);
});
function request(app,path,{method='GET',body,cookie,headers={}}={}){return app.handle(new Request(app.config.origin+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));}
const cookie=response=>response.headers.get('set-cookie')?.split(';')[0];
async function temporary(t){const root=await mkdtemp(join(tmpdir(),'mail-product-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function personal(t,more={},options={}){const root=await temporary(t);const path=await initialize({directory:join(root,'instance'),origin:'http://127.0.0.1:18789',email:'owner@example.test',password});const c=JSON.parse(await readFile(path,'utf8'));await writeFile(path,JSON.stringify({...c,...more}));const app=await openProduct(path,{fetcher:noNetwork,...options});t.after(()=>app.close());const response=await request(app,'/api/login',{method:'POST',body:{password}});assert.equal(response.status,200);return {app,path,cookie:cookie(response),root};}

test('demo browser sessions isolate every mutation, restart seeds and never connect externally',async t=>{
  const root=await temporary(t);const app=await openProduct(config(root),{fetcher:noNetwork});t.after(()=>app.close());
  const a=cookie(await request(app,'/')),b=cookie(await request(app,'/'));assert.notEqual(a,b);
  const first=await request(app,'/api/emails',{cookie:a}),second=await request(app,'/api/emails',{cookie:b});const list=(await first.json()).emails;assert.equal(list.length,18);assert.equal((await second.json()).emails.length,18);
  const id=list[0].id;
  assert.equal((await request(app,'/api/email/'+id+'/star',{method:'POST',cookie:a})).status,200);
  assert.equal((await request(app,'/api/email/'+id+'/trash',{method:'POST',cookie:a})).status,200);
  assert.equal((await(await request(app,'/api/emails',{cookie:a})).json()).emails.length,17);
  const other=(await(await request(app,'/api/emails',{cookie:b})).json()).emails;assert.equal(other.length,18);assert.equal(other.find(x=>x.id===id).is_starred,0);
  assert.equal((await request(app,'/api/email/'+id+'/restore',{method:'POST',cookie:a})).status,200);
  assert.equal((await(await request(app,'/api/emails',{cookie:a})).json()).emails.length,18);
  const draft={rev:0,to:'recipient@example.test',subject:'Session A',body:'Synthetic body',from_id:'demo'};
  assert.equal((await request(app,'/api/mail-workspace/drafts/isolation',{method:'PUT',cookie:a,body:draft})).status,200);
  assert.ok(!(await(await request(app,'/api/mail-workspace',{cookie:b})).json()).drafts.some(x=>x.id==='isolation'));
  const sent=await request(app,'/api/mail-workspace/send',{method:'POST',cookie:a,body:{draft_id:'isolation',rev:1,attempt_id:'send-once'}});assert.equal((await sent.json()).message.state,'sent');
  assert.equal((await(await request(app,'/api/mail-workspace/sent',{cookie:b})).json()).messages.length,0);
  const page=await(await request(app,'/',{cookie:a})).text();assert.ok(page.includes('window.MailProduct='));assert.ok(page.includes('"applications":[]'));
  for(const path of ['/api/import','/api/icloud-repair/sync','/api/notifications/state','/internal/product/status'])assert.ok([403,404].includes((await request(app,path,{cookie:a})).status));
  await request(app,'/api/logout',{method:'POST',cookie:a});assert.equal((await request(app,'/api/emails')).status,401);assert.equal((await request(app,'/')).status,200);
});

test('local login, persisted session, logout, write origin and machine roles form a closed boundary',async t=>{
  const s=await personal(t,{readonly_token_env:'MAIL_READ_TOKEN'},{secrets:await secretsForLocal()});
  assert.equal((await request(s.app,'/api/emails')).status,401);
  const localPage=await(await request(s.app,'/',{cookie:s.cookie})).text();assert.ok(localPage.includes('"authMode":"local"'));assert.ok(!localPage.includes('<body data-account-auth="true"'));
  assert.equal((await request(s.app,'/api/mail-workspace',{headers:{'x-eona-owner':'forged'}})).status,401);
  assert.equal((await request(s.app,'/api/login',{method:'POST',headers:{origin:'https://evil.test'},body:{password}})).status,403);
  assert.equal((await request(s.app,'/api/mail-workspace/drafts/x',{method:'PUT',cookie:s.cookie,headers:{origin:'https://evil.test'},body:{rev:0,body:'forged'}})).status,403);
  assert.equal((await request(s.app,'/api/emails',{headers:{authorization:'Bearer read-token-with-at-least-32-characters'}})).status,200);
  assert.equal((await request(s.app,'/api/mail-workspace',{headers:{authorization:'Bearer read-token-with-at-least-32-characters'}})).status,403);
  assert.equal((await request(s.app,'/internal/product/status',{cookie:s.cookie})).status,403);
  assert.equal((await request(s.app,'/internal/product/status',{headers:{authorization:'Bearer worker-test-token'}})).status,200);
  await s.app.close();const again=await openProduct(s.path,{fetcher:noNetwork,secrets:await secretsForLocal()});t.after(()=>again.close());
  assert.equal((await request(again,'/api/emails',{cookie:s.cookie})).status,200);
  await request(again,'/api/logout',{method:'POST',cookie:s.cookie});assert.equal((await request(again,'/api/emails',{cookie:s.cookie})).status,401);
  for(let i=0;i<5;i++)assert.equal((await request(again,'/api/login',{method:'POST',body:{password:'wrong'}})).status,401);
  assert.equal((await request(again,'/api/login',{method:'POST',body:{password}})).status,429);
  assert.equal((await stat(join(s.root,'instance','credentials.json'))).mode&0o777,0o600);
});
async function secretsForLocal(){const {passwordHash}=await import('./local-auth.mjs');const values={MAIL_PASSWORD_HASH:await passwordHash(password),MAIL_WORKER_TOKEN:'worker-test-token',MAIL_READ_TOKEN:'read-token-with-at-least-32-characters',AI_TOKEN:'test',NOTICE_TOKEN:'test',SMTP_PASSWORD:'test'};return name=>{if(!values[name])throw Error('missing');return values[name]};}

test('archive identity preserves reused Message-IDs, exact source originals, crash retry and owner boundary',async t=>{
  const root=await temporary(t),c=validateConfig(config(root,{mode:'personal',auth:{mode:'local'},accounts:[account,{...account,id:'two',address:'second@example.test'}],ai:{endpoint:'https://model.example.test',token_env:'AI_TOKEN',model:'test'},notifications:{endpoint:'https://notify.example.test',token_env:'NOTICE_TOKEN'}}));
  const store=await openStore(c);t.after(()=>store.close());
  const one=await store.ingest(raw(),proof(1));const repeat=await store.ingest(raw(),proof(1));assert.equal(one.id,repeat.id);assert.equal(repeat.stored,false);
  const changed=await store.ingest(raw('Different body'),proof(2));assert.notEqual(changed.id,one.id);
  const same=await store.ingest(raw('First body','same-id','Received: by another-source\r\n'),proof(3,{account:'two'}));assert.equal(same.id,one.id);
  const {fetchWithIdentity}=await import('../src/index.js');const scoped=await fetchWithIdentity(new Request(c.origin+'/api/emails?box=second@example.test'),store.env,{authenticated:true,subject:c.owner.id,email:c.owner.email});assert.equal((await scoped.json()).emails[0].id,one.id);
  assert.equal((await store.env.MAIL_MAILBOX_STATS()).get('second@example.test').count,1);
  assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM emails').first()).n,2);
  assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_source_copies').first()).n,3);
  for(const row of (await store.db.prepare('SELECT raw_key,raw_sha FROM product_source_copies').all()).results){const object=await store.objects.get(row.raw_key);assert.ok(object);assert.ok(row.raw_sha);}
  await assert.rejects(()=>store.ingest(raw('Changed immutable copy'),proof(1)),/identity_changed/);
  await store.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON product_source_copies WHEN NEW.uid='4' BEGIN SELECT RAISE(ABORT,'injected'); END;");
  await assert.rejects(()=>store.ingest(raw('Crash body','crash'),proof(4)),/injected/);
  await store.db.exec('DROP TRIGGER fail_receipt');const retry=await store.ingest(raw('Crash body','crash'),proof(4));
  assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM product_jobs WHERE email_id=?').bind(retry.id).first()).n,2);
  assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM emails').first()).n,3);
  await assert.rejects(()=>openStore({...c,owner:{...c.owner,id:'another'}}),/identity_or_schema_mismatch/);
  const legacy=join(root,'legacy');await mkdir(legacy);const old=new DatabaseSync(join(legacy,'mail.db'));old.exec('CREATE TABLE emails(id INTEGER)');old.close();
  await assert.rejects(()=>openStore({...c,data_root:legacy}),/explicit_data_adoption/);
});

test('classification outage never blocks notification; responsibilities survive restart and reject cursor rollback',async t=>{
  let now=Date.now(),release;const blocked=new Promise(r=>release=r),notified=[];let fail=true;
  const fetcher=async(url,options)=>{if(url.startsWith('https://model.')){await blocked;if(fail)return new Response('',{status:503});return Response.json({choices:[{message:{content:JSON.stringify({category:'技术资讯',summary:'测试正文',nature:'普通',action:'无',nature_evidence:'',action_evidence:''})}}]});}notified.push(JSON.parse(options.body));return Response.json({ok:true});};
  const s=await personal(t,{accounts:[account],ai:{endpoint:'https://model.example.test',token_env:'AI_TOKEN',model:'test'},notifications:{endpoint:'https://notify.example.test',token_env:'NOTICE_TOKEN'}},{secrets:await secretsForLocal(),fetcher,clock:()=>now});
  await s.app.store.ingest(raw('Here is a long software update with several paragraphs about the project and engineering progress. '.repeat(8)),proof(1));
  const running=s.app.runJobs();await new Promise(r=>setTimeout(r,20));assert.equal(notified.length,1);release();await running;
  assert.ok((await s.app.store.jobs.inspect()).some(x=>x.kind==='classify'&&x.state==='error'));
  assert.ok((await s.app.store.jobs.inspect()).some(x=>x.kind==='notify'&&x.state==='done'));
  await s.app.close();now+=10000;fail=false;
  const again=await openProduct(s.path,{secrets:await secretsForLocal(),fetcher,clock:()=>now});t.after(()=>again.close());await again.runJobs();
  assert.ok((await again.store.jobs.inspect()).some(x=>x.kind==='classify'&&x.state==='done'));assert.equal(notified.length,1);
  const state={account:'one',folder:'INBOX',validity:'42',last_uid:10,backfill_cursor:5,backfill_until:10,state:'backfilling'},headers={authorization:'Bearer worker-test-token'};
  assert.equal((await request(again,'/internal/product/source-status',{method:'POST',headers,body:state})).status,200);
  assert.equal((await request(again,'/internal/product/source-status',{method:'POST',headers,body:{...state,last_uid:9}})).status,409);
  const query={account:'one',folder:'INBOX',validity:'42',uids:['1']};
  assert.deepEqual(await(await request(again,'/internal/product/known-copies',{method:'POST',headers,body:query})).json(),{uids:['1']});
  assert.deepEqual(await(await request(again,'/internal/product/known-copies',{method:'POST',headers,body:{...query,validity:'43'}})).json(),{uids:[]});
  assert.equal((await request(again,'/internal/product/known-copies',{method:'POST',headers,body:{...query,account:'foreign'}})).status,400);
  assert.equal((await request(again,'/internal/product/known-copies',{method:'POST',body:query})).status,403);
});

test('source gaps survive restart and cannot become healthy before the exact original commits',async t=>{
 const secrets=await secretsForLocal(),s=await personal(t,{accounts:[account]},{secrets});
 const headers={authorization:'Bearer worker-test-token'},gap={uid:'2',validity:'42',historical:true,retry_after:1300};
 const state={account:'one',folder:'INBOX',validity:'42',last_uid:10,backfill_cursor:10,backfill_until:10,state:'ok',gaps:[gap]};
 assert.equal((await request(s.app,'/internal/product/source-status',{method:'POST',headers,body:state})).status,200);
 await s.app.close();const again=await openProduct(s.path,{fetcher:noNetwork,secrets});t.after(()=>again.close());
 let status=(await(await request(again,'/internal/product/status',{headers})).json()).sources[0];
 assert.equal(status.state,'error');assert.equal(status.error,'source_original_unavailable');assert.deepEqual(JSON.parse(status.gaps_json),[gap]);
 assert.equal((await request(again,'/internal/product/source-status',{method:'POST',headers,body:{...state,gaps:[]}})).status,409);
 // A different UIDVALIDITY neither resolves nor silently drops the original.
 const reset={...state,validity:'43',last_uid:1,backfill_cursor:1,backfill_until:1};delete reset.gaps;
 assert.equal((await request(again,'/internal/product/source-status',{method:'POST',headers,body:reset})).status,200);
 status=(await(await request(again,'/internal/product/status',{headers})).json()).sources[0];assert.deepEqual(JSON.parse(status.gaps_json),[gap]);assert.equal(status.state,'error');
 await again.store.ingest(raw('Recovered exact original','recovered'),proof(2,{historical:true}));
 assert.equal((await request(again,'/internal/product/source-status',{method:'POST',headers,body:{...reset,gaps:[]}})).status,200);
 status=(await(await request(again,'/internal/product/status',{headers})).json()).sources[0];assert.equal(status.state,'ok');assert.equal(status.error,'');
 assert.equal((await request(again,'/internal/product/source-status',{method:'POST',headers,body:{...reset,gaps:[{...gap,retry_after:'later'}]}})).status,400);
});

test('imported sent and draft snapshots retain their attachment bytes and original download',async t=>{
  const s=await personal(t,{accounts:[account]});
  const original=Buffer.from('Message-ID: <attachment@example.test>\r\nFrom: owner@example.test\r\nTo: recipient@example.test\r\nSubject: Attachment snapshot\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="test-boundary"\r\n\r\n--test-boundary\r\nContent-Type: text/plain\r\n\r\nOriginal body\r\n--test-boundary\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="sample.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECAwQF\r\n--test-boundary--\r\n');
  await s.app.store.ingest(original,proof(1,{folder:'Sent',kind:'sent',historical:true,internal_date:'2014-02-07T07:30:56Z'}));
  await s.app.store.ingest(original,proof(1,{folder:'Drafts',kind:'drafts',historical:true,internal_date:'2014-02-07T07:30:56Z'}));
  const messages=(await(await request(s.app,'/api/mail-workspace/sent',{cookie:s.cookie})).json()).messages;
  assert.equal(messages.length,1);assert.equal(messages[0].attachments.length,1);
  assert.deepEqual(Buffer.from(await(await request(s.app,messages[0].raw_url,{cookie:s.cookie})).arrayBuffer()),original);
  const drafts=(await(await request(s.app,'/api/mail-workspace',{cookie:s.cookie})).json()).drafts;
  assert.equal(drafts.length,1);assert.equal(drafts[0].attachments.length,1);
  await s.app.store.db.prepare("UPDATE mail_outbox SET state='superseded' WHERE id=?").bind(messages[0].id).run();
  assert.equal((await(await request(s.app,'/api/mail-workspace/sent',{cookie:s.cookie})).json()).messages.length,0);
  assert.equal((await(await request(s.app,'/api/mail-workspace/sent/'+messages[0].id,{cookie:s.cookie})).json()).message.state,'sent');
  assert.deepEqual(Buffer.from(await(await request(s.app,messages[0].raw_url,{cookie:s.cookie})).arrayBuffer()),original);
  for(const attachment of [messages[0].attachments[0],drafts[0].attachments[0]])assert.deepEqual(Buffer.from(await(await request(s.app,attachment.url,{cookie:s.cookie})).arrayBuffer()),Buffer.from([0,1,2,3,4,5]));
});

test('generic SMTP preserves MIME and idempotent send, while an ambiguous disconnect retains draft',async t=>{
  let sends=0,disconnect=false,submitted;
  const createTransport=options=>{assert.equal(options.host,'smtp.example.test');assert.equal(options.tls.rejectUnauthorized,true);return {sendMail:async message=>{sends++;submitted=message;if(disconnect)throw Error('disconnect');return {accepted:['recipient@example.test'],rejected:[]}}};};
  const s=await personal(t,{accounts:[account]},{secrets:await secretsForLocal(),createTransport});
  const body={rev:0,to:'recipient@example.test',subject:'Synthetic send',body:'Original text',from_id:'one'};
  assert.equal((await request(s.app,'/api/mail-workspace/drafts/send-test',{method:'PUT',cookie:s.cookie,body})).status,200);
  const send={draft_id:'send-test',rev:1,attempt_id:'send-1'};
  let response=await request(s.app,'/api/mail-workspace/send',{method:'POST',cookie:s.cookie,body:send});const sent=(await response.json()).message;assert.equal(sent.state,'sent');assert.ok(submitted.raw);assert.ok(sent.raw_url);
  assert.equal((await request(s.app,sent.raw_url,{cookie:s.cookie})).status,200);
  await request(s.app,'/api/mail-workspace/send',{method:'POST',cookie:s.cookie,body:send});assert.equal(sends,1);
  disconnect=true;await request(s.app,'/api/mail-workspace/drafts/ambiguous',{method:'PUT',cookie:s.cookie,body});
  response=await request(s.app,'/api/mail-workspace/send',{method:'POST',cookie:s.cookie,body:{draft_id:'ambiguous',rev:1,attempt_id:'send-2'}});assert.equal((await response.json()).message.state,'unknown');
  assert.equal((await request(s.app,'/api/mail-workspace/send',{method:'POST',cookie:s.cookie,body:{draft_id:'ambiguous',rev:1,attempt_id:'send-3'}})).status,200);assert.equal(sends,2);
  assert.ok((await(await request(s.app,'/api/mail-workspace',{cookie:s.cookie})).json()).drafts.some(x=>x.id==='ambiguous'));
});

test('standard OIDC works without private claims and rejects a different owner',async t=>{
  const root=await temporary(t),issuer='https://identity.example.test/realm',origin='https://mail.example.test';
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'one',alg:'RS256',use:'sig'};let nonce,sub='oidc-owner';
  const fetcher=async(url,options)=>{
    url=String(url);
    assert.equal(new URL(url).origin,new URL(issuer).origin);
    if(url.endsWith('openid-configuration')){assert.equal(url,issuer+'/.well-known/openid-configuration');return Response.json({issuer,authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',userinfo_endpoint:issuer+'/userinfo',response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256']});}
    if(url.endsWith('/jwks'))return Response.json({keys:[jwk]});
    if(url.endsWith('/userinfo'))return Response.json({sub,email:'owner@example.test',email_verified:true});
    if(url.endsWith('/token'))return Response.json({access_token:'synthetic-token',token_type:'Bearer',expires_in:900,id_token:await new SignJWT({sub,email:'owner@example.test',email_verified:true,nonce}).setProtectedHeader({alg:'RS256',kid:'one'}).setIssuer(issuer).setAudience('client').setIssuedAt().setExpirationTime('15m').sign(privateKey)});
    throw Error('unexpected_oidc_request');
  };
  const app=await openProduct(config(root,{mode:'personal',origin,auth:{mode:'oidc',issuer,client_id:'client',client_secret_env:'CLIENT_SECRET',subject:'oidc-owner'}}),{fetcher,secrets:()=> 'synthetic-secret'});t.after(()=>app.close());
  const start=await request(app,'/auth/start'),url=new URL(start.headers.get('location'));nonce=url.searchParams.get('nonce');assert.equal(url.searchParams.get('scope'),'openid profile email offline_access');
  const response=await request(app,'/auth/callback?code=test&state='+url.searchParams.get('state'),{cookie:cookie(start)});assert.equal(response.status,303);
  const session=response.headers.getSetCookie().find(x=>x.startsWith('__Host-eona-mail-session=')).split(';')[0];assert.equal((await request(app,'/api/emails',{cookie:session})).status,200);
  sub='different-owner';const bad=await request(app,'/auth/start'),badURL=new URL(bad.headers.get('location'));nonce=badURL.searchParams.get('nonce');assert.equal((await request(app,'/auth/callback?code=test&state='+badURL.searchParams.get('state'),{cookie:cookie(bad)})).status,403);
});

test('demo rejects every configured external connector and unsafe origins',()=>{
  for(const more of [{accounts:[account]},{ai:{endpoint:'https://model.example.test'}},{notifications:{}},{readonly_token_env:'READ_TOKEN'},{auth:{mode:'oidc'}}])assert.throws(()=>validateConfig(config('/tmp/demo',more)),/demo_external_connections_forbidden/);
  assert.throws(()=>validateConfig(config('/tmp/demo',{origin:'http://mail.example.test'})),/loopback/);
});


test('adapter incoming handoff is durable before source proof, retries failures and excludes historical folders',async t=>{
 const store=await openStore(config(await temporary(t),{mode:'personal',accounts:[account]}));t.after(()=>store.close());
 store.env.AI={run:async()=>({response:'unused; classification is asynchronous'})};
 let attempts=0,unavailable=true;const received=new Set();
 store.env.MAIL_SOURCE_ARRIVAL=async id=>{attempts++;if(unavailable)throw Error('adapter_queue_unavailable');received.add(id);};
 await assert.rejects(()=>store.ingest(raw(),proof(8)),/adapter_queue_unavailable/);
 assert.equal((await store.db.prepare('SELECT COUNT(*) AS n FROM product_source_copies').first()).n,0);
 unavailable=false;const result=await store.ingest(raw(),proof(8));assert.equal(received.size,1);assert.ok(received.has(result.id));
 await store.ingest(raw(),proof(8));assert.equal(attempts,2);
 await store.ingest(raw('Historical','history'),proof(9,{historical:true}));
 await store.ingest(raw('Sent','sent'),proof(10,{folder:'Sent',kind:'sent'}));assert.equal(attempts,2);
 assert.equal((await store.db.prepare('SELECT ai_tries FROM emails WHERE id=?').bind(result.id).first()).ai_tries,0);
 assert.equal((await store.db.prepare("SELECT ai_tries FROM emails WHERE subject='Product test' AND id<>? ORDER BY id LIMIT 1").bind(result.id).first()).ai_tries,3);
});

test('mailbox views and counters keep forwarded originals before IMAP proof and deduplicate their later proof',async t=>{
 const root=await temporary(t),c=validateConfig(config(root,{mode:'personal',auth:{mode:'local'},accounts:[account]}));const store=await openStore(c);t.after(()=>store.close());
 const {archiveRaw,fetchWithIdentity}=await import('../src/index.js'),env={...store.env,MAIL_ALIAS_DOMAIN:'bridge.test'},identity={authenticated:true,subject:c.owner.id,email:c.owner.email};
 const direct=raw('Direct','unproven-direct');await archiveRaw(env,direct,{alias:account.address,imported:true,skipAI:true});
 const forwarded=Buffer.from(raw('Forwarded','unproven-forward').toString().replace('To: owner@example.test','To: elsewhere@example.test'));
 await archiveRaw(env,forwarded,{alias:'owner.example@bridge.test',imported:true,skipAI:true});
 await archiveRaw(env,Buffer.from(raw('Unrelated','unrelated').toString().replace('To: owner@example.test','To: elsewhere@example.test')),{alias:'elsewhere@example.test',imported:true,skipAI:true});
 await store.ingest(raw('Proven','proven-only'),proof(1,{historical:true}));
 const check=async()=>{const response=await fetchWithIdentity(new Request(c.origin+'/api/emails?box='+account.address),env,identity);assert.equal(response.status,200);assert.equal((await response.json()).emails.length,3);const routes=await fetchWithIdentity(new Request(c.origin+'/api/routes?fresh=1'),env,identity);assert.equal((await routes.json()).routes.find(r=>r.mailbox===account.address).box_count,3)};
 await check();await store.ingest(direct,proof(2,{historical:true}));await check();assert.equal((await store.db.prepare('SELECT COUNT(*) n FROM emails').first()).n,4);
});
