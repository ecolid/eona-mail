// Preferences can change labels/defaults, never the source's authorized addresses.
async function senderPreferences(db,owner){
 const row=await db.prepare('SELECT preferences_json FROM mail_sender_preferences WHERE owner=?').bind(owner).first();
 try{return JSON.parse(row?.preferences_json||'{}')}catch{return {}}
}
export async function mailSenderChoices(db,service,owner,options){
 const senders=service?await service.list(owner,options):[];
 const prefs=await senderPreferences(db,owner);
 return projectSenderChoices(senders,prefs);
}
function projectSenderChoices(senders,prefs){
 const defaultId=senders.find(s=>s.id===prefs.default_id&&s.available!==false)?.id||senders.find(s=>s.available!==false)?.id;
 return senders.map(s=>({...s,source_name:s.name||'',custom_name:prefs.names?.[s.id]||'',default_name:prefs.default_name||'',name:prefs.names?.[s.id]||prefs.default_name||s.name||'',default:s.id===defaultId}));
}
export async function prepareMailSenderPreferences(db,service,owner,input){
 const senders=service?await service.list(owner,{fresh:true}):[];
 if(!senders.some(s=>s.id===input.default_id&&s.available!==false))throw Error('请选择当前可用的发件账号。');
 if(!input.names||typeof input.names!=='object'||Array.isArray(input.names)||Object.keys(input).some(k=>!['default_id','default_name','names'].includes(k)))throw Error('发信设置无效。');
 const prior=await senderPreferences(db,owner),defaultName=input.default_name===undefined?prior.default_name||'':input.default_name;
 if(typeof defaultName!=='string'||defaultName.length>100||/[\x00-\x1f\x7f]/.test(defaultName))throw Error('默认显示名称无效。');
 const names={};for(const [id,value] of Object.entries(input.names)){
  if(!senders.some(s=>s.id===id)||typeof value!=='string'||value.length>100||/[\x00-\x1f\x7f]/.test(value))throw Error('发件人显示名称无效。');
  if(value.trim())names[id]=value.trim();
 }
 const value={default_id:input.default_id,default_name:defaultName.trim(),names};
 return {statement:db.prepare('INSERT INTO mail_sender_preferences(owner,preferences_json,updated_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at').bind(owner,JSON.stringify(value),new Date().toISOString()),senders:projectSenderChoices(senders,value)};
}

export async function saveMailSenderPreferences(db,service,owner,input){
 const prepared=await prepareMailSenderPreferences(db,service,owner,input);await prepared.statement.run();return prepared.senders;
}
