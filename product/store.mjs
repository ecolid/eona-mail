import {initializeServiceAPI} from './service-api.mjs';
import {initializeSourceHealth,sourceFolders,sourceHealth,SOURCE_KINDS} from './source-health.mjs';
import {readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import PostalMime from 'postal-mime';
import {SQLiteD1,FileObjects} from '../sv/storage.mjs';
import {archiveRaw} from '../src/index.js';
import {initializeMailWorkspace} from '../src/mail-send.js';
import {initializeMailDirectory} from '../src/mail-directory.js';
import {initializeMailSync} from '../src/mail-sync-schema.js';
import {openJobs} from './jobs.mjs';
import {mailSourceReceivedAt,repairMailHeaderEncoding} from '../src/mail-source-metadata.js';
import {accountSyncEnabled} from './config.mjs';
import {gmailSource} from './gmail.mjs';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const archiveIdentity=(raw,parsed)=>sha(parsed.messageId?JSON.stringify({message_id:parsed.messageId,from:parsed.from,to:parsed.to,cc:parsed.cc,date:parsed.date,subject:parsed.subject,text:parsed.text,html:parsed.html,attachments:(parsed.attachments||[]).map(a=>({name:a.filename,mime:a.mimeType,sha:sha(Buffer.from(a.content))}))}):raw);
export async function openStore(config,{root=config.data_root,clock=Date.now}={}){
  await mkdir(root,{recursive:true,mode:0o700});
  const db=new SQLiteD1(join(root,'mail.db')),objects=new FileObjects(join(root,'objects'));
  try{
    const meta=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='product_meta'").first();
    const archive=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'").first();
    if(archive&&!meta)throw Error('product_requires_explicit_data_adoption');
    if(!archive){
      db.db.exec('BEGIN IMMEDIATE');
      try{
      await db.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));
      await db.exec(`ALTER TABLE emails ADD COLUMN archive_identity TEXT;
        DROP INDEX idx_emails_msgid;
        CREATE INDEX product_header_id ON emails(message_id);
        CREATE UNIQUE INDEX product_archive_identity ON emails(archive_identity) WHERE archive_identity IS NOT NULL;
        CREATE TABLE product_meta(id INTEGER PRIMARY KEY CHECK(id=1),schema INTEGER NOT NULL,owner TEXT NOT NULL,mode TEXT NOT NULL);`);
      await db.prepare('INSERT INTO product_meta VALUES(1,1,?,?)').bind(config.owner.id,config.mode).run();
      db.db.exec('COMMIT');
      }catch(error){db.db.exec('ROLLBACK');throw error;}
    }
    const state=await db.prepare('SELECT * FROM product_meta WHERE id=1').first();
    if(state?.schema!==1||state.owner!==config.owner.id||state.mode!==config.mode)throw Error('product_data_identity_or_schema_mismatch');
    await initializeMailWorkspace(db);await initializeMailDirectory(db);await initializeMailSync(db);
    await db.exec(`CREATE TABLE IF NOT EXISTS product_source_copies(account TEXT NOT NULL,folder TEXT NOT NULL,validity TEXT NOT NULL,uid TEXT NOT NULL,email_id INTEGER NOT NULL REFERENCES emails(id),raw_key TEXT NOT NULL,raw_sha TEXT NOT NULL,source_at TEXT NOT NULL,kind TEXT NOT NULL,seen INTEGER NOT NULL,base_rev INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,folder,validity,uid));
      CREATE TABLE IF NOT EXISTS product_source_status(account TEXT NOT NULL,folder TEXT NOT NULL,validity TEXT NOT NULL DEFAULT '',last_uid INTEGER NOT NULL DEFAULT 0,backfill_cursor INTEGER NOT NULL DEFAULT 0,backfill_until INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL,checked_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(account,folder));`);
    if(!(await db.prepare('PRAGMA table_info(product_source_status)').all()).results.some(c=>c.name==='gaps_json'))await db.exec("ALTER TABLE product_source_status ADD COLUMN gaps_json TEXT NOT NULL DEFAULT '[]'");
    await db.exec('CREATE INDEX IF NOT EXISTS product_source_email ON product_source_copies(email_id)');
    await db.exec('CREATE TABLE IF NOT EXISTS product_gmail_copies(account TEXT NOT NULL,folder TEXT NOT NULL,validity TEXT NOT NULL,uid TEXT NOT NULL,message_id TEXT NOT NULL,labels_json TEXT NOT NULL,PRIMARY KEY(account,folder,validity,uid),FOREIGN KEY(account,folder,validity,uid) REFERENCES product_source_copies(account,folder,validity,uid))');
    await db.exec('CREATE INDEX IF NOT EXISTS product_gmail_identity ON product_gmail_copies(account,message_id)');
    for(const account of config.accounts)await db.prepare("INSERT INTO mailbox_routes(mailbox,alias,role,note) VALUES(?,?,'main','') ON CONFLICT(mailbox) DO UPDATE SET alias=excluded.alias").bind(account.address,account.address).run();
    if(config.sync?.enabled)await db.exec(await readFile(new URL('./state-schema.sql',import.meta.url),'utf8'));
    if(config.sync?.enabled){
      const readonly=config.accounts.filter(a=>a.imap&&!accountSyncEnabled(config,a)).map(a=>a.id);
      await db.batch([db.prepare('DELETE FROM product_receive_only_accounts'+(readonly.length?' WHERE account NOT IN ('+readonly.map(()=>'?').join(',')+')':'')).bind(...readonly),...readonly.map(id=>db.prepare('INSERT OR IGNORE INTO product_receive_only_accounts VALUES(?)').bind(id))]);
    }
    for(const account of config.accounts.filter(a=>accountSyncEnabled(config,a)))for(const folder of account.imap?.folders||[])if(['sent','drafts'].includes(folder.kind))await db.prepare('DELETE FROM product_source_status WHERE account=? AND folder=?').bind(account.id,folder.name).run();
    await initializeSourceHealth(db);await initializeServiceAPI(db);
    const jobs=await openJobs(db,{clock});
    let chain=Promise.resolve();
    const serialize=run=>{const task=chain.then(run);chain=task.catch(()=>{});return task;};
    const env={MAIL_ARCHIVE_IDENTITY:archiveIdentity,MAILDB:db,ATTACH:objects,PUBLIC_HOST:new URL(config.origin).hostname,MAIL_ALIAS_DOMAIN:'',MAX_ATTACHMENT_MB:'0'};
    env.MAIL_SOURCE_HEALTH=()=>sourceHealth(db,config,{clock});
    const accountIds=mailbox=>config.accounts.filter(a=>a.address.toLowerCase()===String(mailbox).toLowerCase()).map(a=>a.id);
    env.MAIL_MAILBOX_SCOPE=mailbox=>{const ids=accountIds(mailbox);return ids.length?{where:'EXISTS(SELECT 1 FROM product_source_copies sc WHERE sc.email_id=emails.id AND sc.account IN ('+ids.map(()=>'?').join(',')+'))',binds:ids}:null;};
    env.MAIL_MAILBOX_STATS=async()=>{
      const rows=(await db.prepare("SELECT sc.account,COUNT(DISTINCT e.id) count,MAX(e.received_at) last_seen FROM product_source_copies sc JOIN emails e ON e.id=sc.email_id WHERE e.folder='inbox' GROUP BY sc.account").all()).results;
      const values=new Map();for(const a of config.accounts){const ids=accountIds(a.address),scope=env.MAIL_MAILBOX_SCOPE(a.address);const row=ids.length===1?rows.find(r=>r.account===a.id):await db.prepare("SELECT COUNT(*) count,MAX(received_at) last_seen FROM emails WHERE folder='inbox' AND ("+scope.where+')').bind(...scope.binds).first();values.set(a.address.toLowerCase(),row||{count:0,last_seen:null});}return values;
    };
    async function ingest(raw,input){return serialize(async()=>{
      const account=config.accounts.find(a=>a.id===input.account)||(config.mode==='demo'&&input.account==='demo'?{id:'demo',address:config.owner.email}:null);
      if(!account||typeof input.folder!=='string'||input.folder.length>300||typeof input.validity!=='string'||!input.validity||input.validity.length>100||!/^[a-zA-Z0-9_-]{1,100}$/.test(String(input.uid))||!SOURCE_KINDS.includes(input.kind))throw Error('product_source_proof_invalid');
      if(config.mode!=='demo'&&(!(await sourceFolders(db,account)).some(f=>f.name===input.folder&&f.kind===input.kind)))throw Error('product_source_folder_unconfigured');
      if(config.mode!=='demo'&&[input.uid,input.validity].some(x=>!/^\d+$/.test(String(x))||Number(x)<1||Number(x)>4294967295))throw Error('product_source_uid_invalid');
      const gmail=gmailSource(account,input),projection=gmail?{...input,kind:gmail.kind}:input;
      const firstGmailCopy=!gmail||!await db.prepare('SELECT 1 FROM product_gmail_copies WHERE account=? AND message_id=? LIMIT 1').bind(account.id,gmail.message_id).first();
      raw=Buffer.from(raw);if(raw.length<20||raw.length>50*1024*1024)throw Error('product_raw_size_invalid');
      const hash=sha(raw),proof=[account.id,input.folder,input.validity,String(input.uid)];
      const old=await db.prepare('SELECT * FROM product_source_copies WHERE account=? AND folder=? AND validity=? AND uid=?').bind(...proof).first();
      if(old){if(old.raw_sha!==hash)throw Error('product_source_identity_changed');return {id:old.email_id,stored:false,raw_sha256:hash};}
      const parsed=await PostalMime.parse(raw);
      const identity=archiveIdentity(raw,parsed);
      const receivedAt=mailSourceReceivedAt(parsed,input.internal_date,clock());
      if(!receivedAt)throw Error('product_source_date_unavailable');
      const result=await archiveRaw(env,raw,{alias:account.address,envelopeFrom:parsed.from?.address||'',imported:true,sourceKind:projection.kind,isRead:!!input.seen,skipAI:!config.ai&&!(env.AI&&!input.historical),archiveIdentity:identity,receivedAt});
      if(!result.emailId)throw Error('product_archive_receipt_missing');
      const rawKey='source/'+hash+'.eml';await objects.put(rawKey,raw,{customMetadata:{raw_sha256:hash}});
      const commands=[db.prepare('INSERT INTO product_source_copies(account,folder,validity,uid,email_id,raw_key,raw_sha,source_at,kind,seen) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(...proof,result.emailId,rawKey,hash,new Date(clock()).toISOString(),input.kind,!!input.seen)];
      if(gmail)commands.push(db.prepare('INSERT INTO product_gmail_copies VALUES(?,?,?,?,?,?)').bind(...proof,gmail.message_id,JSON.stringify(gmail.labels)));
      if(gmail?.starred&&result.stored){
        if(config.sync?.enabled)commands.push(db.prepare('UPDATE product_state_guard SET remote_apply=1 WHERE id=1'));
        commands.push(db.prepare('UPDATE emails SET is_starred=1 WHERE id=?').bind(result.emailId));
        if(config.sync?.enabled)commands.push(db.prepare('UPDATE product_state_guard SET remote_apply=0 WHERE id=1'));
      }
      // Retrying after a crash between archive and source receipt must still
      // create the durable responsibility. Unique job keys prevent replay.
      if(config.ai)commands.push(jobs.statement('classify',result.emailId));
      if(config.notifications&&projection.kind==='inbox'&&!input.historical&&firstGmailCopy)commands.push(jobs.statement('notify',result.emailId));
      if(!accountSyncEnabled(config,account))commands.push(...sourceProjection(db,config.owner.id,await repairMailHeaderEncoding(raw,parsed,PostalMime),gmail?{...input,kind:gmail.workspaceKind}:projection,result.emailId,rawKey,gmail?.projection||proof,receivedAt));
      // Complete the adapter's durable incoming responsibility before the
      // source proof/cursor can commit. A failed handoff is safely retried.
      if(projection.kind==='inbox'&&!input.historical&&firstGmailCopy&&env.MAIL_SOURCE_ARRIVAL)await env.MAIL_SOURCE_ARRIVAL(result.emailId);
      await db.batch(commands);
      return {id:result.emailId,stored:result.stored,raw_sha256:hash};
    });}
    return {db,objects,jobs,env,ingest,serialize,close:()=>db.close()};
  }catch(error){db.close();throw error;}
}
function sourceProjection(db,owner,parsed,input,emailId,rawKey,proof,at){
  if(!['sent','drafts'].includes(input.kind))return [];
  const id=sha(JSON.stringify(proof)).slice(0,48),body=String(parsed.text||'').slice(0,50000);
  const address=x=>({address:x.address||'',name:x.name||''});
  const assets=(parsed.attachments||[]).map((a,i)=>({id:'source-'+sha(JSON.stringify([proof,i])).slice(0,48),name:String(a.filename||'attachment').slice(0,240),type:a.mimeType||'application/octet-stream',size:Buffer.from(a.content).length,content:Buffer.from(a.content)}));
  const payload={from:address(parsed.from||{}),to:(parsed.to||[]).map(address),cc:(parsed.cc||[]).map(address),bcc:(parsed.bcc||[]).map(address),subject:parsed.subject||'',body,document:{ops:[{insert:body+'\n'}]},attachments:assets.map(({content,...a})=>({...a,url:'/api/mail-workspace/assets/'+a.id})),raw_key:rawKey,source_email_id:emailId};
  const commands=assets.map(a=>db.prepare('INSERT OR IGNORE INTO mail_assets(owner,id,draft_id,name,mime,size,data_base64,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(owner,a.id,'source-'+id,a.name,a.type,a.size,a.content.toString('base64'),at));
  if(input.kind==='sent'){
    commands.push(db.prepare("INSERT OR IGNORE INTO mail_outbox(owner,id,draft_id,draft_rev,payload_json,state,message_id,created_at,updated_at) VALUES(?,?,?,1,?,'sent',?,?,?)").bind(owner,id,'source-'+id,JSON.stringify(payload),parsed.messageId||'',at,at));
  }else{
    commands.push(db.prepare("INSERT OR IGNORE INTO mail_drafts(owner,id,to_addr,subject,body,rev,updated_at,envelope_json) VALUES(?,?,?,?,?,1,?,?)").bind(owner,'source-'+id,payload.to.map(p=>p.address).join(', '),payload.subject,body,at,JSON.stringify({from_id:input.account,cc:payload.cc.map(p=>p.address).join(', '),bcc:payload.bcc.map(p=>p.address).join(', '),document:payload.document,attachments:payload.attachments})));
  }
  return commands;
}
