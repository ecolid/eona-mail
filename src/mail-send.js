import {mailSenderChoices} from './mail-sender-preferences.js';
import {normalizeMailDocument,renderMailDocument,mailDocumentAssets} from './mail-rich-document.js';
import {readMailAssets,assetMeta} from './mail-workspace-assets.js';
import {mailAddressParts} from './mail-reader-view.js';
import {initializeMailSync} from './mail-sync-schema.js';

const initializedWorkspaces=new WeakMap();
export async function initializeMailWorkspace(db){
 if(initializedWorkspaces.has(db))return initializedWorkspaces.get(db);
 const pending=initializeWorkspaceSchema(db).catch(error=>{initializedWorkspaces.delete(db);throw error});initializedWorkspaces.set(db,pending);return pending;
}
async function initializeWorkspaceSchema(db) {
 await initializeMailSync(db);
 await db.prepare('CREATE TABLE IF NOT EXISTS mail_drafts(owner TEXT NOT NULL,id TEXT NOT NULL,to_addr TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,rev INTEGER NOT NULL,updated_at TEXT NOT NULL,envelope_json TEXT NOT NULL DEFAULT \'{}\',PRIMARY KEY(owner,id))').run();
 const columns=await db.prepare('PRAGMA table_info(mail_drafts)').all();
 if(!columns.results.some(c=>c.name==='envelope_json')){
  try{await db.prepare("ALTER TABLE mail_drafts ADD COLUMN envelope_json TEXT NOT NULL DEFAULT '{}'").run()}catch(error){const again=await db.prepare('PRAGMA table_info(mail_drafts)').all();if(!again.results.some(c=>c.name==='envelope_json'))throw error}
 }
 await db.prepare('CREATE TABLE IF NOT EXISTS mail_sender_preferences(owner TEXT NOT NULL PRIMARY KEY,preferences_json TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS mail_assets(owner TEXT NOT NULL,id TEXT NOT NULL,draft_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,data_base64 TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,id))').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS mail_important_contacts(owner TEXT NOT NULL,address TEXT NOT NULL,name TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,address))').run();
 await db.prepare('CREATE TABLE IF NOT EXISTS mail_outbox(owner TEXT NOT NULL,id TEXT NOT NULL,draft_id TEXT NOT NULL,draft_rev INTEGER NOT NULL,payload_json TEXT NOT NULL,state TEXT NOT NULL,message_id TEXT NOT NULL,accepted_json TEXT NOT NULL DEFAULT \'[]\',rejected_json TEXT NOT NULL DEFAULT \'[]\',error TEXT NOT NULL DEFAULT \'\',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,id),UNIQUE(owner,draft_id,draft_rev))').run();
 await db.prepare('CREATE INDEX IF NOT EXISTS mail_outbox_owner_time ON mail_outbox(owner,created_at DESC)').run();
}

export function projectDraft(row){
 if(!row)return null;
 let envelope={};try{envelope=JSON.parse(row.envelope_json||'{}')}catch{}
 return {id:row.id,to:row.to_addr,subject:row.subject,body:row.body,from_id:envelope.from_id||'',cc:envelope.cc||'',bcc:envelope.bcc||'',document:envelope.document||null,view_html:envelope.document?renderMailDocument(envelope.document)?.html:'',attachments:envelope.attachments||[],rev:row.rev,updated_at:row.updated_at};
}

export function sendRecipients(value){
 if(typeof value!=='string'||value.length>4000||/[\r\n\x00-\x1f]/.test(value))throw Error('收件地址无效。');
 const result=mailAddressParts(value);
 if(result.some(p=>!p.searchable||p.address.length>254||p.name.length>200))throw Error('请检查收件人、抄送和密送地址。');
 return result.map(({name,address})=>({name,address:address.toLowerCase()}));
}

export function projectSent(row){
 if(!row)return null;
 const payload=JSON.parse(row.payload_json);const {raw_key,...safePayload}=payload;
 return {view_html:payload.document?renderMailDocument(payload.document)?.html:payload.html||'',id:row.id,draft_id:row.draft_id,draft_rev:row.draft_rev,...safePayload,raw_url:raw_key?'/api/mail-workspace/sent/'+row.id+'/raw':null,state:row.state==='superseded'?'sent':row.state,message_id:row.message_id,accepted:JSON.parse(row.accepted_json),rejected:JSON.parse(row.rejected_json),error:row.error,created_at:row.created_at,updated_at:row.updated_at};
}

export async function mailSendRequest(request,env,owner,input){
 const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
 const url=new URL(request.url),path=url.pathname;
 const rawRead=/^\/api\/mail-workspace\/sent\/([a-zA-Z0-9-]{1,80})\/raw$/.exec(path);
 if(rawRead&&request.method==='GET'){const row=await env.MAILDB.prepare('SELECT payload_json FROM mail_outbox WHERE owner=? AND id=?').bind(owner,rawRead[1]).first();const key=row&&JSON.parse(row.payload_json).raw_key;if(!key)return json({error:'此邮件尚无原始副本。'},404);const object=await env.ATTACH?.get(key);return object?new Response(object.body,{headers:{'content-type':'message/rfc822','content-disposition':'attachment; filename=sent-email.eml','cache-control':'private,no-store','x-content-type-options':'nosniff'}}):json({error:'原始副本暂时无法读取。'},503)}
 const read=/^\/api\/mail-workspace\/(?:send|sent)\/([a-zA-Z0-9-]{1,80})$/.exec(path);
 if(read&&request.method==='GET'){
  const row=await env.MAILDB.prepare('SELECT * FROM mail_outbox WHERE owner=? AND id=?').bind(owner,read[1]).first();
  return row?json({message:projectSent(row)}):json({error:'尚未找到此发送记录。'},404);
 }
 if(path!=='/api/mail-workspace/send'||request.method!=='POST')return null;
 const {draft_id,rev,attempt_id}=input||{};
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(draft_id||'')||!/^[a-zA-Z0-9-]{1,80}$/.test(attempt_id||'')||!Number.isInteger(rev)||rev<1)return json({error:'发送标识或草稿版本无效。'},400);
 const existing=await env.MAILDB.prepare('SELECT * FROM mail_outbox WHERE owner=? AND (id=? OR (draft_id=? AND draft_rev=?))').bind(owner,attempt_id,draft_id,rev).first();
 if(existing){if(existing.draft_id!==draft_id||existing.draft_rev!==rev)return json({error:'此发送标识已经用于其他内容。'},409);return json({message:projectSent(existing)})}
 const unresolved=await env.MAILDB.prepare("SELECT * FROM mail_outbox WHERE owner=? AND draft_id=? AND state IN ('sending','unknown') LIMIT 1").bind(owner,draft_id).first();
 if(unresolved)return json({error:'这封邮件的上次发送结果尚未确认，请先核对发送记录。',message:projectSent(unresolved)},409);
 const row=await env.MAILDB.prepare('SELECT * FROM mail_drafts WHERE owner=? AND id=?').bind(owner,draft_id).first();
 if(!row||row.rev!==rev)return json({error:'草稿已有更新，请重新核对后发送。'},409);
 const draft=projectDraft(row);let to,cc,bcc;
 try{to=sendRecipients(draft.to);cc=sendRecipients(draft.cc);bcc=sendRecipients(draft.bcc)}catch(error){return json({error:error.message},400)}
 if(!to.length||to.length+cc.length+bcc.length>20)return json({error:'请填写收件人，每封最多20个收件地址。'},400);
 if(/[\r\n\x00-\x1f]/.test(draft.subject)||!draft.subject.trim()||(!draft.body.trim()&&!mailDocumentAssets(draft.document).length&&!draft.attachments.length))return json({error:'请填写主题和正文。'},400);
 if(!env.MAIL_SENDER)return json({error:'发信通道尚未连接，草稿已保留。'},503);
 let sender;try{sender=(await mailSenderChoices(env.MAILDB,env.MAIL_SENDER,owner)).find(x=>x.id===draft.from_id&&x.available!==false)}catch{return json({error:'发件账号暂时无法读取，请刷新后重试。'},503)}
 if(!sender)return json({error:'所选发件账号不可用，请重新选择。'},409);
 let media,rendered,document;try{document=normalizeMailDocument(draft.document);media=await readMailAssets(env.MAILDB,owner,draft_id,[...mailDocumentAssets(document),...draft.attachments.map(a=>a.id)]);rendered=renderMailDocument(document,{imageSource:id=>'cid:'+id+'@eona.mail'})}catch(error){return json({error:error.message},400)}
 const payload={document,html:rendered?.html||'',attachments:media.map(assetMeta),from_id:sender.id,from:{address:sender.address,name:sender.name||''},to,cc,bcc,subject:draft.subject,body:draft.body};
 const now=new Date().toISOString(),messageId='<'+crypto.randomUUID()+'@'+sender.address.split('@')[1]+'>';
 const inserted=await env.MAILDB.prepare("INSERT OR IGNORE INTO mail_outbox(owner,id,draft_id,draft_rev,payload_json,state,message_id,created_at,updated_at) SELECT ?,?,?,?,?,'sending',?,?,? WHERE NOT EXISTS(SELECT 1 FROM mail_outbox WHERE owner=? AND draft_id=? AND state IN ('sending','unknown'))").bind(owner,attempt_id,draft_id,rev,JSON.stringify(payload),messageId,now,now,owner,draft_id).run();
 if(!inserted.meta.changes){const duplicate=await env.MAILDB.prepare("SELECT * FROM mail_outbox WHERE owner=? AND (id=? OR (draft_id=? AND (draft_rev=? OR state IN ('sending','unknown')))) LIMIT 1").bind(owner,attempt_id,draft_id,rev).first();return duplicate?json({message:projectSent(duplicate)}):json({error:'发送状态已变化，请先核对记录。'},409)}
 let state='unknown',accepted=[],rejected=[],error='发送结果尚未确认，请核对后再处理。';
 try{
  const message={...payload,messageId,files:media.map(a=>({filename:a.name,content:a.data_base64,encoding:'base64',contentType:a.mime,...mailDocumentAssets(document).includes(a.id)?{cid:a.id+'@eona.mail',contentDisposition:'inline'}:{contentDisposition:'attachment'}}))};
  if(env.MAIL_SENDER.prepare){
   try{
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner+'\0'+attempt_id)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    message.sync={syncId:'s-'+digest,operationId:'smtp-'+digest,kind:'sent'};
    message.raw=await env.MAIL_SENDER.prepare(owner,message);
    payload.raw_key='workspace-sent/'+crypto.randomUUID()+'.eml';
    await env.ATTACH.put(payload.raw_key,message.raw,{httpMetadata:{contentType:'message/rfc822'},customMetadata:{source:'workspace-smtp'}});
    await env.MAILDB.prepare('UPDATE mail_outbox SET payload_json=? WHERE owner=? AND id=?').bind(JSON.stringify(payload),owner,attempt_id).run();
   }catch(cause){cause.definitelyNotSent=true;throw cause;}
  }
  const receipt=await env.MAIL_SENDER.send(owner,message);
  accepted=receipt.accepted||[];rejected=receipt.rejected||[];
  state=accepted.length?(rejected.length?'partial':'sent'):'failed';
  error=state==='partial'?'部分收件地址未被接收，请查看发送详情。':state==='failed'?'发信服务器未接收邮件。':'';
 }catch(cause){state=cause.definitelyNotSent?'failed':'unknown';error=state==='failed'?'邮件未发出，草稿已保留。请检查发信账号或稍后重试。':'发送结果尚未确认，请核对发送记录，避免重复发送。'}
 // Receipt and draft removal commit together. A failed commit leaves a durable
 // sending intent, so the browser cannot accidentally send it a second time.
 // A source Sent original may resolve the intent while SMTP is still waiting
 // for its final reply. A late disconnect cannot overwrite that confirmation.
 const finish=env.MAILDB.prepare("UPDATE mail_outbox SET state=?,accepted_json=?,rejected_json=?,error=?,updated_at=? WHERE owner=? AND id=? AND state IN ('sending','unknown')").bind(state,JSON.stringify(accepted),JSON.stringify(rejected),error,new Date().toISOString(),owner,attempt_id);
 const commands=[finish,env.MAILDB.prepare("DELETE FROM mail_drafts WHERE owner=? AND id=? AND rev=? AND EXISTS(SELECT 1 FROM mail_outbox WHERE owner=? AND id=? AND state IN ('sent','partial'))").bind(owner,draft_id,rev,owner,attempt_id)];
 await env.MAILDB.batch(commands);
 return json({message:projectSent(await env.MAILDB.prepare('SELECT * FROM mail_outbox WHERE owner=? AND id=?').bind(owner,attempt_id).first())});
}
