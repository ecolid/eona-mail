import {createMailSender} from '../sv/mail-sender.mjs';
import {accountSyncEnabled} from './config.mjs';
export function productSender(config,secrets,{createTransport}={}){
  const accounts=config.accounts.filter(a=>a.smtp);
  if(!accounts.length)return null;
  const metadata=()=>accounts.map(a=>({id:a.id,address:a.address,name:a.name||'',sync:accountSyncEnabled(config,a),available:available(a)}));
  function available(a){try{secrets(a.smtp.password_env);return true;}catch{return false;}}
  const inner=createMailSender({authorized_owners:[config.owner.id],loadAccounts:async()=>accounts.filter(available).map(a=>({id:a.id,address:a.address,name:a.name||'',...a.smtp,password:secrets(a.smtp.password_env)}))},createTransport);
  return {...inner,list:async owner=>owner===config.owner.id?metadata():[]};
}
export function productAI(config,secrets,{fetcher=fetch}={}){
  if(!config.ai)return null;
  return {async run(_model,input){
    const response=await fetcher(config.ai.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secrets(config.ai.token_env)},body:JSON.stringify({model:config.ai.model,messages:input.messages,max_tokens:input.max_tokens,temperature:input.temperature}),redirect:'error',signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw Error('model_request_failed');
    const result=await response.json();const content=result.choices?.[0]?.message?.content;
    if(typeof content!=='string'||content.length>500000)throw Error('model_response_invalid');
    return {response:content,usage:result.usage};
  }};
}
export function productNotifier(config,secrets,{fetcher=fetch}={}){
  if(!config.notifications)return null;
  return async message=>{
    const response=await fetcher(config.notifications.endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secrets(config.notifications.token_env),'idempotency-key':'mail:'+message.id},body:JSON.stringify({...message,url:config.origin+'/?mail='+message.id}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('notification_request_failed');
  };
}
