import {normalizeMailLayout} from './mail-layout-model.js';
import {prepareMailSenderPreferences} from './mail-sender-preferences.js';

// A visible Save commits all edited groups in one database transaction.
export async function saveMailSettings(db,service,owner,input){
 const invalid=message=>{const error=Error(message);error.mailSettingsValidation=true;return error};
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['layout','sending','routes'].includes(k))||!input.layout||typeof input.layout!=='object')throw invalid('邮件设置无效。');
 if(Array.isArray(input.layout)||Object.keys(input.layout).some(k=>!['density','limit','visibility'].includes(k))||!['compact','comfortable'].includes(input.layout.density)||!Number.isInteger(input.layout.limit)||input.layout.limit<3||input.layout.limit>12)throw invalid('显示设置无效。');
 const preferences=normalizeMailLayout(input.layout),statements=[];
 let sending;
 if(input.sending!==undefined){
  if(!input.sending||typeof input.sending!=='object'||Array.isArray(input.sending))throw invalid('发信设置无效。');
  // Service discovery failures remain failures, never an empty account list.
  try{sending=await prepareMailSenderPreferences(db,service,owner,input.sending)}catch(error){if(/请选择|无效/.test(error.message))error.mailSettingsValidation=true;throw error}
 }
 if(input.routes!==undefined&&(!Array.isArray(input.routes)||input.routes.length>100))throw invalid('收信路径数量无效。');
 const routes=[],seen=new Set(),email=/^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$/i;
 for(const row of input.routes||[]){
  if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['mailbox','hop','alias','role','eona_reads','note','remove'].includes(k)))throw invalid('收信路径字段无效。');
  const mailbox=typeof row.mailbox==='string'?row.mailbox.trim().toLowerCase():'';
  if(!email.test(mailbox)||mailbox.length>254||seen.has(mailbox))throw invalid('请填写有效且不重复的邮箱地址。');seen.add(mailbox);
  if(row.remove===true){routes.push({mailbox,remove:true});continue}
  const value={mailbox};
  for(const [key,limit] of [['hop',254],['alias',254],['role',40],['note',500]]){
   if(row[key]!==undefined&&(typeof row[key]!=='string'||row[key].length>limit||/[\x00-\x1f\x7f]/.test(row[key])))throw invalid('收信路径字段无效。');
   value[key]=String(row[key]||'').trim();
  }
  if((value.hop&&!email.test(value.hop))||(value.alias&&!email.test(value.alias)))throw invalid('转发邮箱和归档地址须为有效邮箱地址。');
  if(![true,false,0,1].includes(row.eona_reads))throw invalid('请选择是否参与归档。');
  value.eona_reads=row.eona_reads?1:0;routes.push(value);
 }
 await db.prepare('CREATE TABLE IF NOT EXISTS mail_ui_preferences(owner TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)').run();
 statements.push(db.prepare('INSERT INTO mail_ui_preferences(owner,value,updated_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(owner,JSON.stringify(preferences),new Date().toISOString()));
 if(sending)statements.push(sending.statement);
 for(const row of routes){
  if(row.remove){statements.push(db.prepare('DELETE FROM mailbox_routes WHERE mailbox=?').bind(row.mailbox));continue}
  statements.push(db.prepare('INSERT INTO mailbox_routes(mailbox,hop,alias,role,eona_reads,note) VALUES(?,?,?,?,?,?) ON CONFLICT(mailbox) DO UPDATE SET hop=excluded.hop,alias=excluded.alias,role=excluded.role,eona_reads=excluded.eona_reads,note=excluded.note,updated_at=datetime(\'now\')').bind(row.mailbox,row.hop||null,row.alias||null,row.role||null,row.eona_reads,row.note||null));
 }
 await db.batch(statements);
 return {preferences,...(sending?{senders:sending.senders}:{}),routes};
}
