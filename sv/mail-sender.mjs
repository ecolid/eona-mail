import nodemailer from 'nodemailer';
import {readFile} from 'node:fs/promises';
import {compileMailMime} from './mail-mime.mjs';

// Account metadata and credentials are reloaded for each submission. Neither is
// accepted from a browser, and secrets never enter a public projection or log.
export function createMailSender({authorized_owners=[],loadAccounts,registry_file,secrets_file},createTransport=nodemailer.createTransport){
 if(!Array.isArray(authorized_owners)||authorized_owners.some(owner=>typeof owner!=='string'||!owner))throw Error('invalid_sending_authorization');
 const allowed=owner=>authorized_owners.includes(owner);
 const accounts=loadAccounts||(async()=>{
  const registry=JSON.parse(await readFile(registry_file,'utf8'));
  const raw=await readFile(secrets_file,'utf8'),secrets={};
  for(const line of raw.split(/\r?\n/)){const match=/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);if(match)secrets[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2')}
  return registry.map(a=>({...a,password:secrets[a.password_key]})).filter(a=>a.password);
 });
 const get=async (owner,options={})=>{
  if(!allowed(owner))return [];
  const list=await accounts(options);
  if(!Array.isArray(list)||list.some(a=>!a.id||!a.address||!a.user||!a.password||!a.host||![465,587].includes(a.port)))throw Error('invalid_sending_registry');
  return list;
 };
 const options=a=>({host:a.host,port:a.port,secure:a.port===465,requireTLS:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:a.user,pass:a.password},connectionTimeout:12000,greetingTimeout:12000,socketTimeout:25000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
 return {
  async list(owner,options){return (await get(owner,options)).map(a=>({id:a.id,address:a.address,name:a.name||'',available:true}))},
  async verify(owner,id){const a=(await get(owner)).find(a=>a.id===id);if(!a)throw Error('sender_unavailable');return createTransport(options(a)).verify()},
  async prepare(owner,message){
   const a=(await get(owner)).find(a=>a.id===message.from_id&&a.address===message.from.address);
   if(!a)throw Error('sender_unavailable');
   return (await compileMailMime({...message,from:{address:a.address,name:message.from.name||a.name||''}},message.sync)).raw;
  },
  async send(owner,message){
   const a=(await get(owner)).find(a=>a.id===message.from_id&&a.address===message.from.address);
   if(!a){const e=Error('sender_unavailable');e.definitelyNotSent=true;throw e}
   try{
    const info=await createTransport(options(a)).sendMail(message.raw?{raw:message.raw,envelope:{from:a.address,to:[...message.to,...message.cc,...message.bcc].map(p=>p.address)},disableFileAccess:true,disableUrlAccess:true}:{from:{address:a.address,name:typeof message.from.name==='string'&&message.from.name.length<=100&&!/[\x00-\x1f\x7f]/.test(message.from.name)?message.from.name:a.name||''},to:message.to,cc:message.cc,bcc:message.bcc,subject:message.subject,text:message.body,html:message.html||undefined,attachments:message.files||[],messageId:message.messageId,disableFileAccess:true,disableUrlAccess:true});
    return {accepted:(info.accepted||[]).map(String),rejected:(info.rejected||[]).map(String)};
   }catch(error){
    // Authentication / pre-DATA errors and an explicit SMTP rejection are safe
    // to retry by a new user intent. A disconnect after DATA is ambiguous.
    const safe=error.code==='EAUTH'||['CONN','EHLO','HELO','STARTTLS','AUTH','MAIL FROM','RCPT TO'].includes(error.command)||Number(error.responseCode)>=400;
    const clean=Error(safe?'smtp_not_accepted':'smtp_result_unknown');clean.definitelyNotSent=safe;throw clean;
   }
  },
 };
}
