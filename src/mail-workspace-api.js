import {mailDirectory,mailDirectoryMessages,initializeMailDirectory} from './mail-directory.js';
import {mailConditionalRead} from './mail-conditional-read.js';
import {saveMailSettings} from './mail-settings.js';
import {mailSenderChoices,saveMailSenderPreferences} from './mail-sender-preferences.js';
import {normalizeMailDocument,renderMailDocument,mailDocumentAssets} from './mail-rich-document.js';
import {mailAssetRequest,readMailAssets,assetMeta} from './mail-workspace-assets.js';
import {initializeMailWorkspace,projectDraft,projectSent,mailSendRequest} from './mail-send.js';
import {mailSentSearch} from './mail-sent-search.js';
import {mailAddressParts} from './mail-reader-view.js';
const readProjections=new WeakMap();
// Account-owned drafts, contact preferences and explicit send intents.
export async function mailWorkspaceRequest(request,env,owner) {
 const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
 const path=new URL(request.url).pathname;
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'forbidden'},403);
 if(request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'forbidden'},403);
 if(request.method!=='GET'&&!request.headers.get('content-type')?.startsWith('application/json'))return reply({error:'请使用JSON请求。'},415);
 if(!['GET','PUT','DELETE','POST'].includes(request.method))return reply({error:'method_not_allowed'},405);
 await initializeMailWorkspace(env.MAILDB);
 const project=projectDraft;
 if(path==='/api/mail-workspace/source-health'&&request.method==='GET'){try{return reply(env.MAIL_SOURCE_HEALTH?await env.MAIL_SOURCE_HEALTH():{accounts:[]})}catch{return reply({error:'source_status_unavailable'},503)}}
 if(request.method==='GET'){const asset=await mailAssetRequest(request,env.MAILDB,owner);if(asset)return asset}
 if(request.method==='GET'){const sendRead=await mailSendRequest(request,env,owner);if(sendRead)return sendRead;}
 if(path==='/api/mail-workspace/sent'&&request.method==='GET'){try{return await mailConditionalRead(request,env.MAILDB,async()=>reply(await mailSentSearch(new URL(request.url),env.MAILDB,owner)),owner)}catch(error){return reply({error:error.mailQuery?error.message:'已发送查询暂时无法读取，请重试。'},error.mailQuery?400:503)}}
 if(path==='/api/mail-workspace/correspondence'&&request.method==='GET'){try{return reply(await mailDirectoryMessages(env.MAILDB,owner,Object.fromEntries(new URL(request.url).searchParams)))}catch{return reply({error:'往来邮件暂时无法读取，请重试。'},503)}}
 if(path==='/api/mail-workspace'&&request.method==='GET'){
  const compact=new URL(request.url).searchParams.get('view')==='compact',token=env.MAILDB.changeToken?.();
  let projections=readProjections.get(env.MAILDB);if(!projections){projections=new Map();readProjections.set(env.MAILDB,projections)}const cacheKey=owner+':'+compact,cached=projections.get(cacheKey);
  const respond=entry=>request.headers.get('if-none-match')===entry.etag?new Response(null,{status:304,headers:{etag:entry.etag,'cache-control':'private,no-cache'}}):new Response(entry.body,{headers:{'content-type':'application/json',etag:entry.etag,'cache-control':'private,no-cache'}});
  if(compact&&request.headers.get('cache-control')!=='no-cache'&&token&&cached?.token===token&&Date.now()-cached.at<30000)return respond(cached);
  const drafts=await env.MAILDB.prepare('SELECT * FROM mail_drafts WHERE owner=? ORDER BY updated_at DESC,id').bind(owner).all();
  const syncDrafts=await env.MAILDB.prepare('SELECT id,base_rev,state,conflict_of FROM mail_sync_drafts WHERE owner=?').bind(owner).all();
  const syncByID=new Map(syncDrafts.results.map(r=>[r.id,r]));
  const syncAccounts=await env.MAILDB.prepare('SELECT account,state,checked_at,last_success,error FROM mail_sync_status WHERE owner=?').bind(owner).all();
  const contacts=await env.MAILDB.prepare('SELECT address,name,updated_at FROM mail_important_contacts WHERE owner=? ORDER BY name,address').bind(owner).all();
  const folders=await env.MAILDB.prepare('SELECT folder,COUNT(*) AS count FROM emails GROUP BY folder').all();
  const outbox=await env.MAILDB.prepare("SELECT * FROM mail_outbox WHERE owner=? AND (state IN ('sending','unknown') OR (state='failed' AND EXISTS(SELECT 1 FROM mail_drafts WHERE mail_drafts.owner=mail_outbox.owner AND mail_drafts.id=mail_outbox.draft_id AND mail_drafts.rev=mail_outbox.draft_rev))) ORDER BY created_at DESC,id DESC").bind(owner).all();
  const sentPage=compact?{messages:(await env.MAILDB.prepare("SELECT id,draft_id,draft_rev FROM mail_outbox WHERE owner=? AND state IN ('sent','partial')").bind(owner).all()).results}:await mailSentSearch(new URL('https://mail.invalid/api/mail-workspace/sent'),env.MAILDB,owner);if(compact)sentPage.total=sentPage.messages.length;
  const sent=sentPage.messages;
  const sourceDirectory=await mailDirectory(env.MAILDB,owner);
  let senders=[],sending_error=null;try{if(env.MAIL_SENDER)senders=await mailSenderChoices(env.MAILDB,env.MAIL_SENDER,owner,{fresh:new URL(request.url).searchParams.get('fresh')==='1'})}catch{sending_error='发件账号暂时无法读取，请刷新重试。'}
  const synchronizedSenders=senders.filter(s=>s.sync!==false);
  const value={drafts:drafts.results.map(r=>({...project(r),sync:syncByID.get(r.id)||null})),sync:{configured:!!env.MAIL_SYNC_ENABLED&&(!!sending_error||synchronizedSenders.length>0),source_error:sending_error,accounts:synchronizedSenders.map(s=>syncAccounts.results.find(r=>r.account===s.id)||{account:s.id,state:'starting',checked_at:'',last_success:'',error:''}).map(r=>({...r,state:r.checked_at&&Date.now()-Date.parse(r.checked_at)>180000?'stale':r.state}))},...sourceDirectory,folders:folders.results,sent,sent_total:sentPage.total,outbox:outbox.results.filter(r=>!['sent','partial'].includes(r.state)).map(projectSent),senders,sending_error,send_mode:env.MAIL_SENDER?'smtp':'unavailable'};
  const body=JSON.stringify(value),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body)),etag='"'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')+'"',entry={body,etag,at:Date.now(),token};if(compact&&token){projections.set(cacheKey,entry);while(projections.size>8)projections.delete(projections.keys().next().value)}return respond(entry);
 }
 if(request.method==='GET')return reply({error:'not_found'},404);
 let input;
 try{
  const reader=request.body?.getReader();if(!reader)return reply({error:'请填写内容。'},400);
  const chunks=[];let length=0;for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>(path==='/api/mail-workspace/assets'?7100000:260000)){await reader.cancel();return reply({error:'内容过长，请缩短后重试。'},413)}chunks.push(value)}
  const data=new Uint8Array(length);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.byteLength}input=JSON.parse(new TextDecoder().decode(data));
  if(!input||typeof input!=='object')throw Error();
 }catch{return reply({error:'内容无法读取。'},400)}
 if(path==='/api/mail-workspace/settings'&&request.method==='PUT'){try{return reply(await saveMailSettings(env.MAILDB,env.MAIL_SENDER,owner,input))}catch(error){return reply({error:error.mailSettingsValidation?error.message:'邮件设置未保存，请重试。'},error.mailSettingsValidation?400:503)}}
 if(path==='/api/mail-workspace/sender-preferences'&&request.method==='PUT'){try{return reply({senders:await saveMailSenderPreferences(env.MAILDB,env.MAIL_SENDER,owner,input)})}catch(error){return reply({error:error.message},400)}}
 const asset=await mailAssetRequest(request,env.MAILDB,owner,input);if(asset)return asset;
 if(path==='/api/mail-workspace/send'){const sent=await mailSendRequest(request,env,owner,input);if(sent)return sent;}
 if(request.method==='POST')return reply({error:'not_found'},404);
 const editingPath=/^\/api\/mail-workspace\/drafts\/([a-zA-Z0-9-]{1,80})\/editing$/.exec(path);
 if(editingPath&&request.method==='PUT'){
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(input.editor_id||'')||typeof input.active!=='boolean')return reply({error:'编辑标识无效。'},400);
  if(input.active)await env.MAILDB.prepare('INSERT INTO mail_draft_editors(owner,draft_id,editor_id,expires_at) VALUES(?,?,?,?) ON CONFLICT(owner,draft_id,editor_id) DO UPDATE SET expires_at=excluded.expires_at').bind(owner,editingPath[1],input.editor_id,Math.floor(Date.now()/1000)+120).run();
  else await env.MAILDB.prepare('DELETE FROM mail_draft_editors WHERE owner=? AND draft_id=? AND editor_id=?').bind(owner,editingPath[1],input.editor_id).run();
  return reply({ok:true,draft:project(await env.MAILDB.prepare('SELECT * FROM mail_drafts WHERE owner=? AND id=?').bind(owner,editingPath[1]).first())});
 }
 const draftPath=/^\/api\/mail-workspace\/drafts\/([a-zA-Z0-9-]{1,80})$/.exec(path);
 if(draftPath){
  const id=draftPath[1],rev=input.rev;if(!Number.isInteger(rev)||rev<0)return reply({error:'草稿版本无效。'},400);
  const current=await env.MAILDB.prepare('SELECT * FROM mail_drafts WHERE owner=? AND id=?').bind(owner,id).first();
  if((current?.rev||0)!==rev)return reply({error:'草稿已在其他页面修改，当前输入已保留。',conflict:true,draft:project(current)},409);
  if(request.method==='DELETE'){
   const result=await env.MAILDB.batch([
    env.MAILDB.prepare("INSERT OR REPLACE INTO mail_sync_tombstones(owner,kind,id,payload_json,reason,created_at) SELECT owner,'draft',id,?,'discarded',? FROM mail_drafts WHERE owner=? AND id=? AND rev=?").bind(JSON.stringify(project(current)),new Date().toISOString(),owner,id,rev),
    env.MAILDB.prepare('DELETE FROM mail_drafts WHERE owner=? AND id=? AND rev=?').bind(owner,id,rev),
   ]);if(current&&!result[1].meta.changes)return reply({error:'草稿已在其他页面修改，请刷新后核对。'},409);
   // Synced drafts retain recoverable assets and original MIME after discard.
   await env.MAILDB.prepare("DELETE FROM mail_assets WHERE owner=? AND draft_id=? AND NOT EXISTS(SELECT 1 FROM mail_sync_drafts WHERE owner=mail_assets.owner AND id=mail_assets.draft_id) AND NOT EXISTS(SELECT 1 FROM mail_outbox WHERE mail_outbox.owner=mail_assets.owner AND payload_json LIKE '%'||mail_assets.id||'%') AND NOT EXISTS(SELECT 1 FROM mail_drafts WHERE mail_drafts.owner=mail_assets.owner AND envelope_json LIKE '%'||mail_assets.id||'%')").bind(owner,id).run();return reply({ok:true});
  }
  if(current&&project(current).document&&!Object.hasOwn(input,'document'))return reply({error:'编辑器已有更新，请刷新后继续，当前输入仍保留。',conflict:true},409);
  const {to,subject,body}=input;const from_id=String(input.from_id||''),cc=String(input.cc||''),bcc=String(input.bcc||'');
  if(typeof to!=='string'||to.length>4000||/[\r\n]/.test(to)||typeof subject!=='string'||subject.length>300||typeof body!=='string'||body.length>50000||from_id.length>80||cc.length>4000||bcc.length>4000||/[\r\n]/.test(cc+bcc))return reply({error:'草稿字段无效或内容过长。'},400);
  let document,attachments,bodyValue=body;try{document=normalizeMailDocument(input.document);const ids=input.attachments||[];if(!Array.isArray(ids))throw Error('附件记录无效。');const media=await readMailAssets(env.MAILDB,owner,id,[...mailDocumentAssets(document),...ids.map(a=>a.id)]);attachments=ids.map(a=>assetMeta(media.find(m=>m.id===a.id)));if(document)bodyValue=renderMailDocument(document).text}catch(error){return reply({error:error.message},400)}
  const count=await env.MAILDB.prepare('SELECT COUNT(*) AS n FROM mail_drafts WHERE owner=?').bind(owner).first();
  if(!current&&count.n>=100)return reply({error:'已有100封草稿，请先处理现有草稿。'},409);
  const now=new Date().toISOString();
  const saved=await env.MAILDB.prepare('INSERT INTO mail_drafts(owner,id,to_addr,subject,body,rev,updated_at,envelope_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET to_addr=excluded.to_addr,subject=excluded.subject,body=excluded.body,rev=excluded.rev,updated_at=excluded.updated_at,envelope_json=excluded.envelope_json WHERE mail_drafts.rev=?').bind(owner,id,to,subject,bodyValue,rev+1,now,JSON.stringify({from_id,cc,bcc,document,attachments}),rev).run();
  if(!saved.meta.changes)return reply({error:'草稿已在其他页面修改，当前输入已保留。',conflict:true},409);
  const sync=await env.MAILDB.prepare('SELECT id,base_rev,state,conflict_of FROM mail_sync_drafts WHERE owner=? AND id=?').bind(owner,id).first();
  return reply({draft:{id,to,subject,body:bodyValue,from_id,cc,bcc,document,attachments,rev:rev+1,updated_at:now,sync}});
 }
 if(path==='/api/mail-workspace/source-preferences'&&request.method==='PUT'){
  await initializeMailDirectory(env.MAILDB);const key=String(input.key||'');if(key.length>512||! /^(list|sender):[^\s<>]+$/.test(key)||typeof input.included!=='boolean')return reply({error:'订阅来源无效。'},400);
  const directory=await mailDirectory(env.MAILDB,owner);if(!directory.sources.some(s=>s.key===key)&&!directory.directory.some(c=>'sender:'+c.address===key))return reply({error:'来源已变化，请刷新后重试。'},409);
  await env.MAILDB.prepare('INSERT INTO mail_source_preferences(owner,source_key,included) VALUES(?,?,?) ON CONFLICT(owner,source_key) DO UPDATE SET included=excluded.included').bind(owner,key,Number(input.included)).run();return reply({ok:true});
 }
 if(path==='/api/mail-workspace/contacts'){
  const address=String(input.address||'').trim().toLowerCase(),name=String(input.name||'');
  if(!/^[^\s<>"@]+@[^\s<>"@]+$/.test(address)||address.length>254||name.length>200)return reply({error:'联系人地址或名称无效。'},400);
  if(request.method==='DELETE'){await env.MAILDB.prepare('DELETE FROM mail_important_contacts WHERE owner=? AND address=?').bind(owner,address).run();return reply({ok:true})}
  const now=new Date().toISOString();await env.MAILDB.prepare('INSERT INTO mail_important_contacts(owner,address,name,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner,address) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at').bind(owner,address,name,now).run();
  return reply({contact:{address,name,updated_at:now}});
 }
 return reply({error:'not_found'},404);
}
