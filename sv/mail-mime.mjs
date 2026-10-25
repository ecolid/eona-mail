import MailComposer from 'nodemailer/lib/mail-composer';
import {normalizeMailDocument,renderMailDocument,mailDocumentAssets} from '../src/mail-rich-document.js';

// One MIME builder for SMTP and IMAP. No file paths or remote URLs are accepted.
export async function compileMailMime(message,{syncId,operationId,kind='sent'}={}){
 const headers={};
 for(const [name,value] of [['X-Eona-Sync-ID',syncId],['X-Eona-Sync-Operation',operationId]]){
  if(value!==undefined){if(!/^[a-zA-Z0-9_-]{1,180}$/.test(value))throw Error('invalid_sync_identity');headers[name]=value;}
 }
 if(!['sent','draft'].includes(kind))throw Error('invalid_sync_kind');
 headers['X-Eona-Sync-Kind']=kind;
 const compiled=new MailComposer({
  from:message.from,to:message.to,cc:message.cc,bcc:message.bcc,subject:message.subject,text:message.body||'',html:message.html||undefined,
  attachments:message.files||[],messageId:message.messageId,date:message.date?new Date(message.date):undefined,headers,
  // Drafts must retain their Bcc field; an SMTP envelope already carries Bcc.
  keepBcc:kind==='draft',disableFileAccess:true,disableUrlAccess:true,
 }).compile();
 // Stream transport deliberately enables Bcc retention. Use the MIME composer
 // directly so the bytes archived before SMTP never expose hidden recipients.
 compiled.keepBcc=kind==='draft';
 const envelope=compiled.getEnvelope(),raw=await new Promise((resolve,reject)=>compiled.build((error,value)=>error?reject(error):resolve(value)));
 return {raw,envelope};
}

// Private stdin/stdout bridge used by the standard-library IMAP worker.
export async function compileWorkspaceMime(value){
 const document=normalizeMailDocument(value.document),ids=mailDocumentAssets(document),media=value.assets||[];
 const rendered=renderMailDocument(document,{imageSource:id=>'cid:'+id+'@eona.mail'});
 const compiled=await compileMailMime({...value,body:rendered?.text??value.body,html:rendered?.html||value.html,files:media.map(a=>({filename:a.name,content:a.data_base64,encoding:'base64',contentType:a.mime,...ids.includes(a.id)?{cid:a.id+'@eona.mail',contentDisposition:'inline'}:{contentDisposition:'attachment'}}))},value.sync);
 return compiled.raw;
}
