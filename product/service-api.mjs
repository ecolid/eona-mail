// Versioned machine boundary. Credentials are never accepted as browser sessions.
import {createHash,timingSafeEqual} from 'node:crypto';
import application,{fetchWithIdentity} from '../src/index.js';
import {mailWorkspaceRequest} from '../src/mail-workspace-api.js';
import {mailSenderChoices} from '../src/mail-sender-preferences.js';
import {projectDraft,mailSendRequest} from '../src/mail-send.js';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store','x-mail-api-version':'1'}});
const digest=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
export async function initializeServiceAPI(db){
 await db.exec(`CREATE TABLE IF NOT EXISTS mail_api_requests(client TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,attempt TEXT NOT NULL,PRIMARY KEY(client,key));
 CREATE TABLE IF NOT EXISTS mail_api_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,message_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 CREATE TRIGGER IF NOT EXISTS mail_api_insert AFTER INSERT ON emails BEGIN INSERT INTO mail_api_events(kind,message_id) VALUES('message.created',NEW.id); END;
 CREATE TRIGGER IF NOT EXISTS mail_api_state AFTER UPDATE OF is_read,is_starred,folder ON emails WHEN OLD.is_read IS NOT NEW.is_read OR OLD.is_starred IS NOT NEW.is_starred OR OLD.folder IS NOT NEW.folder BEGIN INSERT INTO mail_api_events(kind,message_id) VALUES('message.changed',NEW.id); END;`);
}
export async function serviceAPI(request,store,config,{secrets}={}){
 const url=new URL(request.url),p=url.pathname,method=request.method;
 if(config.mode!=='personal'||!store)return json({error:'service_api_unavailable'},404);
 if(request.headers.has('cookie')||request.headers.get('sec-fetch-site')==='cross-site'||request.headers.has('origin'))return json({error:'service_credentials_required'},403);
 const token=/^Bearer ([^\s]{32,512})$/.exec(request.headers.get('authorization')||'')?.[1];
 if(!token)return json({error:'unauthorized'},401);
 let client;try{client=(config.service_clients||[]).find(c=>equal(token,secrets(c.token_env)));}catch{return json({error:'credentials_unavailable'},503);}
 if(!client)return json({error:'unauthorized'},401);
 const permitted=scope=>client.scopes.includes(scope),owner=config.owner.id,env=store.env;
 const scope=method==='GET'&&p==='/v1/status'?'mail.status':method==='GET'&&p==='/v1/events'?'mail.events':p.startsWith('/v1/drafts')?'mail.drafts':p==='/v1/senders'||p==='/v1/send'||/^\/v1\/send\/[a-f0-9]{64}$/.test(p)?'mail.send':method==='GET'&&(p==='/v1/messages'||/^\/v1\/messages\/\d+(?:\/(?:raw|translation))?$/.test(p)||['/v1/routes','/v1/forward-health','/v1/backup-health','/v1/export','/v1/file'].includes(p))?'mail.read':method==='POST'&&/^\/v1\/messages\/\d+\/(?:read|unread|star|unstar|trash|restore)$/.test(p)?'mail.write':null;
 if(!scope)return json({error:'not_found'},404);
 if(!permitted(scope))return json({error:'insufficient_scope',scope},403);
 const proxy=(path,body)=>new Request(url.origin+path+url.search,{method,headers:{'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const allowedSender=id=>!client.allowed_from_ids||client.allowed_from_ids.includes(id);
 if(p==='/v1/status'&&method==='GET'){
  try{return json({api:1,owner:owner,source_sync:config.sync?.enabled?'bidirectional':'import-only',...(await env.MAIL_SOURCE_HEALTH())});}catch{return json({error:'source_status_unavailable'},503);}
 }
 if(p==='/v1/events'&&method==='GET'){
  const cursor=url.searchParams.get('after')||'0',limit=url.searchParams.get('limit')||'100';
  if(!/^\d{1,15}$/.test(cursor)||!/^\d{1,3}$/.test(limit)||Number(limit)<1||Number(limit)>200)return json({error:'invalid_cursor_or_limit'},400);
  const events=(await store.db.prepare('SELECT * FROM mail_api_events WHERE cursor>? ORDER BY cursor LIMIT ?').bind(Number(cursor),Number(limit)).all()).results;
  const high=(await store.db.prepare('SELECT COALESCE(MAX(cursor),0) n FROM mail_api_events').first()).n;
  if(Number(cursor)>high)return json({error:'cursor_ahead_of_store'},409);
  return json({events,next:events.at(-1)?.cursor||Number(cursor),has_more:events.length===Number(limit)});
 }
 if(p==='/v1/senders'&&method==='GET'){
  try{return json({senders:env.MAIL_SENDER?(await mailSenderChoices(store.db,env.MAIL_SENDER,owner)).filter(s=>allowedSender(s.id)):[]});}catch{return json({error:'senders_unavailable'},503);}
 }
 if(p.startsWith('/v1/drafts')){
  const match=/^\/v1\/drafts(?:\/([a-zA-Z0-9-]{1,80}))?$/.exec(p);if(!match)return json({error:'not_found'},404);
  const id=match[1];
  if(method==='GET'){
   const rows=id?[await store.db.prepare('SELECT * FROM mail_drafts WHERE owner=? AND id=?').bind(owner,id).first()]:(await store.db.prepare('SELECT * FROM mail_drafts WHERE owner=? ORDER BY updated_at DESC,id').bind(owner).all()).results;
   if(id&&!rows[0])return json({error:'not_found'},404);return json(id?{draft:projectDraft(rows[0])}:{drafts:rows.map(projectDraft)});
  }
  if(!id||!['PUT','DELETE'].includes(method))return json({error:'method_not_allowed'},405);
  let input;try{if(Number(request.headers.get('content-length')||0)>260000)throw Error();const raw=await request.text();if(Buffer.byteLength(raw)>260000)throw Error();input=JSON.parse(raw);}catch{return json({error:'invalid_json'},400);}
  if(method==='PUT'&&!allowedSender(input.from_id))return json({error:'sender_forbidden'},403);
  return store.serialize(()=>mailWorkspaceRequest(proxy('/api/mail-workspace/drafts/'+id,input),env,owner));
 }
 if(p==='/v1/send'&&method==='POST'){
  let input;try{const text=await request.text();if(text.length>4096)throw Error();input=JSON.parse(text);}catch{return json({error:'invalid_json'},400);}
  const key=request.headers.get('idempotency-key');
  if(!key||key.length>128||!/^[\x21-\x7e]+$/.test(key)||!/^[a-zA-Z0-9-]{1,80}$/.test(input?.draft_id||'')||!Number.isSafeInteger(input.rev)||input.rev<1||Object.keys(input).some(k=>!['draft_id','rev'].includes(k)))return json({error:'invalid_send_intent'},400);
  return store.serialize(async()=>{
   const hash=digest(canonical(input)),attempt=digest(client.id+'\0'+key);
   const old=await store.db.prepare('SELECT * FROM mail_api_requests WHERE client=? AND key=?').bind(client.id,key).first();
   if(old&&old.hash!==hash)return json({error:'idempotency_conflict'},409);
   const existing=await store.db.prepare('SELECT payload_json FROM mail_outbox WHERE owner=? AND id=?').bind(owner,attempt).first();
   const draft=await store.db.prepare('SELECT * FROM mail_drafts WHERE owner=? AND id=?').bind(owner,input.draft_id).first();
   if(!allowedSender(existing?JSON.parse(existing.payload_json).from_id:projectDraft(draft)?.from_id))return json({error:'sender_forbidden'},403);
   if(!old)await store.db.prepare('INSERT INTO mail_api_requests VALUES(?,?,?,?)').bind(client.id,key,hash,attempt).run();
   return mailSendRequest(new Request(url.origin+'/api/mail-workspace/send',{method:'POST'}),env,owner,{...input,attempt_id:attempt});
  });
 }
 const sent=/^\/v1\/send\/([a-f0-9]{64})$/.exec(p);
 if(sent&&method==='GET'){
  if(!await store.db.prepare('SELECT attempt FROM mail_api_requests WHERE client=? AND attempt=?').bind(client.id,sent[1]).first())return json({error:'not_found'},404);
  return mailSendRequest(new Request(url.origin+'/api/mail-workspace/send/'+sent[1]),env,owner);
 }
 const mapped=p==='/v1/messages'?'/api/emails':p.startsWith('/v1/messages/')?p.replace('/v1/messages/','/api/email/'):'/api/'+p.slice('/v1/'.length);
 if(method==='GET'){
  // The existing machine read path suppresses read-state side effects.
  const secret='internal-'+crypto.randomUUID();return application.fetch(new Request(url.origin+mapped+url.search,{headers:{authorization:'Bearer '+secret}}),{...env,READONLY_TOKENS:secret});
 }
 return store.serialize(()=>fetchWithIdentity(proxy(mapped),env,{authenticated:true,subject:owner,email:config.owner.email}));
}
