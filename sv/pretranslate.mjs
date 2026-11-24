import {parse} from 'parse5';
import {needsMailTranslation} from '../src/translation-language.js';
import {splitTranslationNode} from '../src/mail-translation-view.js';

export function htmlTranslationSegments(html){
 const doc=parse(String(html),{scriptingEnabled:false});const values=[];
 function visit(node,blocked=false,inBody=false){
  const attrs=Object.fromEntries((node.attrs||[]).map(x=>[x.name,x.value]));
  const excluded=blocked||['script','style','noscript','svg','code','template'].includes(node.tagName)||'hidden' in attrs||attrs['aria-hidden']==='true'||/(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))/i.test(attrs.style||'');
  if(node.nodeName==='#text'&&inBody&&!excluded){const text=node.value.trim();if(text)values.push(...translationBodySegments(text));}
  for(const child of node.childNodes||[])visit(child,excluded,inBody||node.tagName==='body');
 }
 visit(doc);return values;
}

export function translationBodySegments(text){
 return splitTranslationNode(String(text||'').replace(/\r\n?/g,'\n').trim()).map(value=>value.trim()).filter(Boolean);
}

export async function translationSource(row,objects){
 if(!row.html_key)return translationBodySegments(row.text_body);
 const object=await objects.get(row.html_key);
 if(!object)throw Error('translation_source_missing');
 return htmlTranslationSegments(await object.text());
}

export function translationChunks(segments){
 const chunks=[];let chunk=[],size=0;
 for(const text of segments){if(chunk.length&&(size+text.length>2000||chunk.length>=40)){chunks.push(chunk);chunk=[];size=0;}chunk.push(text);size+=text.length;}
 if(chunk.length)chunks.push(chunk);return chunks;
}

// Archive ids, rather than sender-supplied dates, enrol new arrivals. Durable
// jobs survive restarts; text-node caches resume an interrupted long email.
export async function pretranslate(env,translate,{limit=2,scan=100,timeBudgetMs=45000,now=Date.now}={}){
 const done={queued:0,translated:0,skipped:0,stopped:''};
 if(env.MAIL_PRETRANSLATE_ENABLED!=='1'||!env.AI)return done;
 const db=env.MAILDB,start=now();
 await db.exec(`CREATE TABLE IF NOT EXISTS mail_pretranslate_jobs(email_id INTEGER PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_try TEXT NOT NULL DEFAULT '',error TEXT,updated_at TEXT DEFAULT(datetime('now')));
 CREATE INDEX IF NOT EXISTS mail_pretranslate_pending ON mail_pretranslate_jobs(state,next_try,email_id);`);
 const coverageKey='mail_pretranslate_multilingual_v1';
 if(!await db.prepare('SELECT 1 FROM backup_state WHERE k=?').bind(coverageKey).first()){
  await db.batch([
   db.prepare("UPDATE mail_pretranslate_jobs SET state='pending',next_try='',error=NULL WHERE state IN ('skipped','unsupported')"),
   db.prepare('INSERT OR IGNORE INTO backup_state(k,v) VALUES(?,?)').bind(coverageKey,'1'),
  ]);
 }
 if(env.TRANSLATION_QUOTA){
  const key='mail_pretranslate_account_quota';
  const migrated=await db.prepare('SELECT v FROM backup_state WHERE k=?').bind(key).first();
  if(!migrated)await db.batch([
   db.prepare("UPDATE mail_pretranslate_jobs SET next_try=datetime('now') WHERE state='pending' AND error='translation_budget' AND next_try>datetime('now')"),
   db.prepare('INSERT OR IGNORE INTO backup_state(k,v) VALUES(?,?)').bind(key,'1'),
  ]);
 }
 const saved=await db.prepare("SELECT v FROM backup_state WHERE k='mail_pretranslate_cursor'").first();
 let cursor;
 if(saved)cursor=Number(saved.v);
 else{
  const first=await db.prepare("SELECT MIN(id) AS id FROM emails WHERE created_at>=date('now') AND folder='inbox'").first();
  cursor=first?.id?first.id-1:(await db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM emails').first()).id;
  await db.prepare("INSERT INTO backup_state(k,v) VALUES('mail_pretranslate_cursor',?) ON CONFLICT(k) DO NOTHING").bind(String(cursor)).run();
 }
 const {results}=await db.prepare('SELECT id,subject,text_body,folder,html_key FROM emails WHERE id>? ORDER BY id LIMIT ?').bind(cursor,scan).all();
 for(const row of results||[]){
  const eligible=row.folder==='inbox'&&(row.html_key||needsMailTranslation(row.subject,row.text_body));
  const updates=[];
  if(eligible){updates.push(db.prepare('INSERT OR IGNORE INTO mail_pretranslate_jobs(email_id) VALUES(?)').bind(row.id));done.queued++;}
  updates.push(db.prepare("UPDATE backup_state SET v=? WHERE k='mail_pretranslate_cursor'").bind(String(row.id)));
  await db.batch(updates);
 }
 const jobs=await db.prepare(`SELECT e.id,e.subject,e.text_body,e.html_key,e.folder FROM mail_pretranslate_jobs j JOIN emails e ON e.id=j.email_id
  WHERE j.state='pending' AND j.next_try<=datetime('now') ORDER BY e.id DESC LIMIT ?`).bind(limit).all();
 for(const row of jobs.results||[]){
  if(now()-start>=timeBudgetMs){done.stopped='time';break;}
  if(row.folder!=='inbox'){await db.prepare("UPDATE mail_pretranslate_jobs SET state='skipped',updated_at=datetime('now') WHERE email_id=?").bind(row.id).run();done.skipped++;continue;}
  try{
   const segments=await translationSource(row,env.ATTACH);
   if(!needsMailTranslation(row.subject,segments.join('\n'))){
    await db.prepare("UPDATE mail_pretranslate_jobs SET state='skipped',error=NULL,updated_at=datetime('now') WHERE email_id=?").bind(row.id).run();done.skipped++;continue;
   }
   let complete=true;
   for(const chunk of segments.length?translationChunks(segments):[[]]){
    if(now()-start>=timeBudgetMs){complete=false;done.stopped='time';break;}
    await translate(row.id,[row.subject||'',...chunk]);
   }
   if(complete){await db.prepare("UPDATE mail_pretranslate_jobs SET state='done',error=NULL,updated_at=datetime('now') WHERE email_id=?").bind(row.id).run();done.translated++;}
  }catch(e){
   const error=/^translation_[a-z_]+$/.test(e.message)?e.message:'translation_unavailable';
   const isBudget=error==='translation_budget';
   const wait=isBudget?"COALESCE(datetime(?),date('now','+1 day'))":"datetime('now','+5 minutes')";
   const args=isBudget?[e.budget?.retry_at||null]:[];
   await db.prepare("UPDATE mail_pretranslate_jobs SET state='pending',attempts=attempts+1,error=?,next_try="+wait+",updated_at=datetime('now') WHERE email_id=?").bind(error,...args,row.id).run();
   done.stopped=error;if(isBudget)break;
  }
 }
 return done;
}
