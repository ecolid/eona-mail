import {accountSyncEnabled} from './config.mjs';
const stamp=clock=>new Date(clock()).toISOString();
export const SOURCE_KINDS=['inbox','sent','drafts','trash','archive','junk'];
export async function initializeSourceHealth(db){await db.exec(`CREATE TABLE IF NOT EXISTS product_source_inventory(account TEXT PRIMARY KEY,folders_json TEXT NOT NULL DEFAULT '[]',state TEXT NOT NULL,checked_at TEXT NOT NULL,last_success TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS product_source_audit(account TEXT,folder TEXT,validity TEXT,remote_count INTEGER NOT NULL,proven_count INTEGER NOT NULL,missing_json TEXT NOT NULL,checked_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(account,folder));`);}
export async function sourceFolders(db,account){
 const configured=account.imap?.folders||[];if(account.imap?.discovery!=='all')return configured;
 const row=await db.prepare('SELECT folders_json FROM product_source_inventory WHERE account=?').bind(account.id).first();
 return [...new Map([...configured,...JSON.parse(row?.folders_json||'[]')].map(f=>[f.name,f])).values()];
}
export async function sourceHealth(db,config,{clock=Date.now}={}){
 const inventories=(await db.prepare('SELECT * FROM product_source_inventory').all()).results,audits=(await db.prepare('SELECT * FROM product_source_audit').all()).results,statuses=(await db.prepare('SELECT * FROM product_source_status').all()).results;
 const accounts=[];
 for(const account of config.accounts.filter(a=>a.imap)){
  const inventory=inventories.find(x=>x.account===account.id),fresh=!!inventory&&clock()-Date.parse(inventory.checked_at)<300000,folders=await sourceFolders(db,account);
  const orphaned=statuses.filter(s=>s.account===account.id&&!folders.some(f=>f.name===s.folder)&&JSON.parse(s.gaps_json||'[]').length);
  const rows=folders.map(f=>{const audit=audits.find(x=>x.account===account.id&&x.folder===f.name),source=statuses.find(x=>x.account===account.id&&x.folder===f.name),gaps=JSON.parse(source?.gaps_json||'[]'),missing=audit?[...new Set([...JSON.parse(audit.missing_json).map(uid=>audit.validity+':'+uid),...gaps.map(g=>g.validity+':'+g.uid)])]:null,stale=!audit||clock()-Date.parse(audit.checked_at)>=300000;return {name:f.name,kind:f.kind,state:stale?'stale':audit.error?'error':missing.length?'incomplete':'complete',remote_count:audit?.remote_count??null,archived_count:audit?.proven_count??null,missing_count:missing?.length??null,checked_at:audit?.checked_at||null,error:audit?.error||''};});
  rows.push(...orphaned.map(s=>({name:s.folder,kind:'archive',state:'incomplete',remote_count:null,archived_count:null,missing_count:JSON.parse(s.gaps_json).length,checked_at:s.checked_at,error:'source_directory_removed'})));
  accounts.push({id:account.id,address:account.address,discovery:account.imap.discovery||'configured',connection:!fresh?'stale':inventory.state,checked_at:inventory?.checked_at||null,last_success:inventory?.last_success||null,error:inventory?.error||'',coverage:!fresh||rows.some(f=>f.state==='stale')?'stale':inventory.state!=='connected'||rows.some(f=>f.state==='error')?'error':rows.some(f=>f.state==='incomplete')?'incomplete':'complete',folders:rows});
 }
 return {checked_at:stamp(clock),accounts};
}
export async function sourceHealthAPI(path,body,store,config,{clock=Date.now}={}){
 const account=config.accounts.find(a=>a.id===body.account);if(!account?.imap)throw Error('source_account_invalid');
 if(path==='/internal/product/source-inventory'){
  if(!['connected','error'].includes(body.state)||!Array.isArray(body.folders)||body.folders.length>1000)throw Error('source_inventory_invalid');
  if(body.folders.some(f=>!f||typeof f.name!=='string'||!f.name||f.name.length>300||/[\r\n\0]/.test(f.name)||!SOURCE_KINDS.includes(f.kind))||new Set(body.folders.map(f=>f.name)).size!==body.folders.length)throw Error('source_inventory_invalid');
  const configured=account.imap.folders;if(body.folders.some(f=>{const c=configured.find(c=>c.name===f.name);return c?c.kind!==f.kind:account.imap.discovery!=='all'||!['archive','junk'].includes(f.kind);}))throw Error('source_inventory_scope_invalid');
  const old=await store.db.prepare('SELECT * FROM product_source_inventory WHERE account=?').bind(account.id).first(),when=stamp(clock);
  // A failed LIST cannot erase the last known scope or masquerade as no folders.
  const folders=body.state==='connected'?body.folders:JSON.parse(old?.folders_json||'[]');
  await store.db.prepare('INSERT INTO product_source_inventory VALUES(?,?,?,?,?,?) ON CONFLICT(account) DO UPDATE SET folders_json=excluded.folders_json,state=excluded.state,checked_at=excluded.checked_at,last_success=excluded.last_success,error=excluded.error').bind(account.id,JSON.stringify(folders),body.state,when,body.state==='connected'?when:old?.last_success||'',body.state==='connected'?'':'source_inventory_unavailable').run();
  return {ok:true};
 }
 if(path==='/internal/product/source-coverage'){
  const folders=await sourceFolders(store.db,account),folder=folders.find(f=>f.name===body.folder);
  if(folder&&body.error==='source_folder_unavailable'){
   const old=await store.db.prepare('SELECT * FROM product_source_audit WHERE account=? AND folder=?').bind(account.id,folder.name).first();
   await store.db.prepare('INSERT INTO product_source_audit VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,folder) DO UPDATE SET checked_at=excluded.checked_at,error=excluded.error').bind(account.id,folder.name,old?.validity||'',old?.remote_count||0,old?.proven_count||0,old?.missing_json||'[]',stamp(clock),body.error).run();return {ok:true};
  }
  if(!folder||!/^\d+$/.test(body.validity)||!Array.isArray(body.uids)||body.uids.length>1000000||body.uids.some(x=>typeof x!=='string'||!/^\d+$/.test(x))||new Set(body.uids).size!==body.uids.length)throw Error('source_coverage_invalid');
  let rows=(await store.db.prepare('SELECT uid FROM product_source_copies WHERE account=? AND folder=? AND validity=?').bind(account.id,folder.name,body.validity).all()).results;
  if(accountSyncEnabled(config,account)&&['sent','drafts'].includes(folder.kind)){
   const table=folder.kind==='sent'?'mail_sent_sources':'mail_draft_sources';rows=[...rows,...(await store.db.prepare('SELECT uid FROM '+table+' WHERE owner=? AND account=? AND folder IN (?,?) AND validity=?').bind(config.owner.id,account.id,folder.name,body.wire_folder||folder.name,body.validity).all()).results];
  }
  const known=new Set(rows.map(r=>String(r.uid))),missing=body.uids.filter(uid=>!known.has(uid));
  await store.db.prepare('INSERT INTO product_source_audit VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,folder) DO UPDATE SET validity=excluded.validity,remote_count=excluded.remote_count,proven_count=excluded.proven_count,missing_json=excluded.missing_json,checked_at=excluded.checked_at,error=excluded.error').bind(account.id,folder.name,body.validity,body.uids.length,body.uids.length-missing.length,JSON.stringify(missing),stamp(clock),'').run();
  return {missing,remote_count:body.uids.length,archived_count:body.uids.length-missing.length};
 }
 throw Error('not_found');
}
