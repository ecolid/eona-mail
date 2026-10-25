import {MAIL_READER_PREVIEW_COLUMNS,projectMailListRow} from './mail-reader-preview.js';
import {projectSentList} from './mail-sent-search.js';
// The original MIME headers own source identity. Names and domains alone never
// merge people or lists; explicit preferences remain attached to an address.
import {mailAddressParts} from './mail-reader-view.js';
const initialized=new WeakMap();
export const cleanMailName=value=>/[\ufffd\x00-\x08\x0b\x0c\x0e-\x1f]/.test(String(value||''))?'':String(value||'').trim().slice(0,200);
export function mailSourceHeaders(parsed){
 const get=key=>(parsed.headers||[]).filter(h=>String(h.key).toLowerCase()===key).map(h=>h.value).join(', ');
 const raw=get('list-id'),match=raw.match(/^(.*?)<([^<>\s]+)>/),listID=(match?.[2]||raw.trim()).toLowerCase();
 const validList=listID.length<=254&&/^[a-z0-9._+@-]+\.[a-z0-9._+-]+$/i.test(listID)?listID:'';
 return {list_id:validList,list_name:cleanMailName(match?.[1]?.replace(/^"|"$/g,'')),unsubscribe:!!get('list-unsubscribe'),automatic:!!get('auto-submitted')&&!/^no\b/i.test(get('auto-submitted'))||/\b(bulk|list)\b/i.test(get('precedence'))};
}
export async function initializeMailDirectory(db){
 if(initialized.has(db))return initialized.get(db);
 const task=(async()=>{
  await db.prepare("CREATE TABLE IF NOT EXISTS mail_source_headers(email_id INTEGER PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,list_id TEXT NOT NULL,list_name TEXT NOT NULL,unsubscribe INTEGER NOT NULL,automatic INTEGER NOT NULL)").run();
  await db.prepare('CREATE INDEX IF NOT EXISTS mail_directory_sender ON emails(lower(from_addr),folder,received_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS mail_source_list ON mail_source_headers(list_id,email_id)').run();
  await db.prepare("CREATE TABLE IF NOT EXISTS mail_source_preferences(owner TEXT NOT NULL,source_key TEXT NOT NULL,included INTEGER NOT NULL,PRIMARY KEY(owner,source_key))").run();
 })().catch(e=>{initialized.delete(db);throw e});initialized.set(db,task);return task;
}
export async function recordMailSourceHeaders(db,id,parsed){
 await initializeMailDirectory(db);const s=mailSourceHeaders(parsed);
 await db.prepare('INSERT OR REPLACE INTO mail_source_headers(email_id,list_id,list_name,unsubscribe,automatic) VALUES(?,?,?,?,?)').bind(id,s.list_id,s.list_name,Number(s.unsubscribe),Number(s.automatic)).run();
}
export async function mailDirectory(db,owner){
 await initializeMailDirectory(db);
 const contacts=(await db.prepare('SELECT address,name,updated_at FROM mail_important_contacts WHERE owner=? ORDER BY name,address').bind(owner).all()).results;
 const received=(await db.prepare("SELECT e.from_addr AS address,e.from_name AS name,COUNT(*) AS received_count,MAX(e.received_at) AS last_at,COALESCE(h.list_id,'') AS list_id,COALESCE(h.list_name,'') AS list_name,MAX(COALESCE(h.unsubscribe,0)) AS unsubscribe,MAX(COALESCE(h.automatic,0)) AS automatic FROM emails e LEFT JOIN mail_source_headers h ON h.email_id=e.id WHERE e.folder='inbox' GROUP BY lower(e.from_addr),e.from_name,h.list_id,h.list_name").all()).results;
 const sent=(await db.prepare("SELECT payload_json,created_at FROM mail_outbox WHERE owner=? AND state IN ('sent','partial') ORDER BY created_at").bind(owner).all()).results;
 const prefs=new Map((await db.prepare('SELECT source_key,included FROM mail_source_preferences WHERE owner=?').bind(owner).all()).results.map(p=>[p.source_key,!!p.included]));
 const directory=new Map(),sources=new Map();
 const add=(part)=>{const address=String(part.address||'').toLowerCase();if(!mailAddressParts(address).some(p=>p.searchable))return null;let c=directory.get(address);if(!c){c={address,name:'',received_count:0,sent_count:0,last_at:'',source_keys:[],group:'other'};directory.set(address,c)}return c};
 for(const r of received){const c=add(r);if(!c)continue;c.received_count+=r.received_count;if(r.last_at>=c.last_at){c.last_at=r.last_at;c.name=cleanMailName(r.name)||c.name}c.automatic||=!!r.automatic;
  const key=r.list_id?'list:'+r.list_id:'sender:'+c.address,detected=!!(r.list_id||r.unsubscribe),included=prefs.get(key)??detected;
  if(detected||prefs.has(key)){let s=sources.get(key);if(!s){s={key,name:cleanMailName(r.list_name)||c.name||c.address,list_id:r.list_id,addresses:[],received_count:0,last_at:'',detected,included};sources.set(key,s)}s.detected||=detected;s.received_count+=r.received_count;s.last_at=[s.last_at,r.last_at].sort().at(-1);if(!s.addresses.includes(c.address))s.addresses.push(c.address);if(!c.source_keys.includes(key))c.source_keys.push(key)}
 }
 for(const row of sent){const p=JSON.parse(row.payload_json);for(const part of [...(p.to||[]),...(p.cc||[]),...(p.bcc||[])]){const c=add(part);if(!c)continue;c.sent_count++;if(row.created_at.replace('T',' ').slice(0,19)>=c.last_at){c.last_at=row.created_at.replace('T',' ').slice(0,19);c.name=cleanMailName(part.name)||c.name}}}
 for(const p of contacts){const c=add(p);if(c){c.important=true;c.name=cleanMailName(p.name)||c.name}}
 for(const c of directory.values()){const key='sender:'+c.address;if(prefs.get(key)===true&&!sources.has(key))sources.set(key,{key,name:c.name||c.address,list_id:'',addresses:[c.address],received_count:c.received_count,last_at:c.last_at,detected:false,included:true});if(prefs.get(key)===true&&!c.source_keys.includes(key))c.source_keys.push(key);c.group=c.sent_count?'correspondence':c.source_keys.some(k=>sources.get(k)?.included)?'subscription':c.automatic?'automatic':'other'}
 const coverage=await db.prepare("SELECT COUNT(*) total,COUNT(h.email_id) indexed_count FROM emails e LEFT JOIN mail_source_headers h ON h.email_id=e.id WHERE e.folder='inbox'").first();
 return {contacts,directory:[...directory.values()].sort((a,b)=>b.last_at.localeCompare(a.last_at)||a.address.localeCompare(b.address)),sources:[...sources.values()].sort((a,b)=>b.last_at.localeCompare(a.last_at)||a.key.localeCompare(b.key)),source_coverage:coverage};
}
export async function mailDirectoryMessages(db,owner,{address,key,offset=0}){
 await initializeMailDirectory(db);offset=Math.max(0,Math.min(1000000,Math.floor(Number(offset))||0));
 let where,args;
 if(key?.startsWith('list:')){where='EXISTS(SELECT 1 FROM mail_source_headers h WHERE h.email_id=e.id AND h.list_id=?)';args=[key.slice(5)]}
 else {address=key?.startsWith('sender:')?key.slice(7):String(address||'').toLowerCase();if(!mailAddressParts(address).some(p=>p.searchable))throw Error('联系人地址无效。');where='lower(e.from_addr)=?';args=[address]}
 const sentMatch=address?" UNION ALL SELECT o.id,'sent',json_extract(o.payload_json,'$.subject'),substr(json_extract(o.payload_json,'$.body'),1,160),json_extract(o.payload_json,'$.from.name'),json_extract(o.payload_json,'$.from.address'),replace(substr(o.created_at,1,19),'T',' ') FROM mail_outbox o WHERE o.owner=? AND o.state IN ('sent','partial') AND ("+['to','cc','bcc'].map(field=>"EXISTS(SELECT 1 FROM json_each(json_extract(o.payload_json,'$."+field+"')) p WHERE lower(json_extract(p.value,'$.address'))=?)").join(' OR ')+')':'';
 const cte=`WITH correspondence AS (SELECT e.id,'received' AS kind,e.subject,substr(e.text_body,1,160) AS body,e.from_name AS name,e.from_addr AS address,e.received_at AS at FROM emails e WHERE e.folder='inbox' AND ${where}${sentMatch}) `;
 if(address)args.push(owner,address,address,address);
 const total=(await db.prepare(cte+'SELECT COUNT(*) n FROM correspondence').bind(...args).first()).n;
 const rows=(await db.prepare(cte+'SELECT * FROM correspondence ORDER BY at DESC,kind,id DESC LIMIT 30 OFFSET ?').bind(...args,offset).all()).results;
 const receivedIDs=rows.filter(r=>r.kind==='received').map(r=>r.id),sentIDs=rows.filter(r=>r.kind==='sent').map(r=>r.id),headers=new Map();
 if(receivedIDs.length)for(const row of (await db.prepare('SELECT '+MAIL_READER_PREVIEW_COLUMNS+' FROM emails WHERE id IN ('+receivedIDs.map(()=>'?').join(',')+')').bind(...receivedIDs).all()).results)headers.set('received:'+row.id,projectMailListRow(row));
 if(sentIDs.length)for(const row of (await db.prepare('SELECT * FROM mail_outbox WHERE owner=? AND id IN ('+sentIDs.map(()=>'?').join(',')+')').bind(owner,...sentIDs).all()).results)headers.set('sent:'+row.id,projectSentList(row));
 return {messages:rows.map(row=>({...row,reader_preview:headers.get(row.kind+':'+row.id)})),total,next:offset+rows.length<total?offset+rows.length:null};
}

export async function backfillMailSourceHeaders(db,objects,parser,limit=4){
 await initializeMailDirectory(db);
 const rows=(await db.prepare('SELECT id,raw_key FROM emails WHERE raw_key IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mail_source_headers h WHERE h.email_id=emails.id) ORDER BY id DESC LIMIT ?').bind(limit).all()).results;
 for(const r of rows){const raw=await objects.get(r.raw_key);if(!raw)throw Error('source_raw_missing:'+r.id);await recordMailSourceHeaders(db,r.id,await parser.parse(await raw.arrayBuffer()))}return rows.length;
}
