import {DatabaseSync} from 'node:sqlite';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
async function snapshot(source,target){
  const script="import sqlite3,sys,pathlib\ns=sqlite3.connect(pathlib.Path(sys.argv[1]).resolve().as_uri()+'?mode=ro',uri=True,timeout=30)\nd=sqlite3.connect(sys.argv[2],timeout=30)\ntry:s.backup(d,pages=1024,sleep=.05)\nfinally:d.close();s.close()\n";
  try{await execute('python3',['-c',script,source,target],{timeout:120000,maxBuffer:4096});}catch{throw Error('migration_snapshot_failed');}
}
import {mkdir,cp,rename,rm,readFile,writeFile,stat,lstat,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import PostalMime from 'postal-mime';
import {FileObjects} from '../sv/storage.mjs';
import {archiveIdentity} from './store.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
function inventory(db){
  return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,inventoryTable(db,name)]));
}
export async function planMigration(source,owner){
  source=resolve(source);const db=new DatabaseSync(join(source,'mail.db'),{readOnly:true});
  try{
    const owners=new Set();
    for(const table of ['mail_drafts','mail_outbox','mail_assets','mail_sync_status'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))for(const r of db.prepare('SELECT DISTINCT owner FROM '+quote(table)).all())owners.add(r.owner);
    if([...owners].some(value=>value!==owner))throw Error('migration_owner_mismatch');
    const tables=inventory(db);if(!tables.emails||!tables.mail_drafts)throw Error('migration_workspace_missing');
    const value={schema:1,source,owner,tables};return {...value,sha256:sha(JSON.stringify(value))};
  }finally{db.close();}
}
export async function migrateData({source,destination,owner,expectedPlan,apply=false}){
  const plan=await planMigration(source,owner);
  if(!apply)return plan;
  if(plan.sha256!==expectedPlan)throw Error('migration_source_changed');
  source=resolve(source);destination=resolve(destination);
  if(source===destination||destination.startsWith(source+'/')||source.startsWith(destination+'/'))throw Error('migration_paths_overlap');
  try{await stat(destination);throw Error('migration_destination_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  const stage=destination+'.migration-'+randomUUID();await mkdir(stage,{mode:0o700});
  let sourceDB,db;
  try{
    await snapshot(join(source,'mail.db'),join(stage,'mail.db'));
    db=new DatabaseSync(join(stage,'mail.db'));
    if(JSON.stringify(inventory(db))!==JSON.stringify(plan.tables))throw Error('migration_source_changed');
    await cp(join(source,'objects'),join(stage,'objects'),{recursive:true,dereference:false,filter:async path=>{if((await lstat(path)).isSymbolicLink())throw Error('migration_symlink');return true;}});
    const objects=new FileObjects(join(stage,'objects'));let verified=0;
    const columns=db.prepare('PRAGMA table_info(emails)').all().map(x=>x.name);
    const oldEmailFingerprint=inventoryTable(db,'emails',columns);
    let allObjectsVerified=0;
    async function verifyObjects(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())await verifyObjects(path);else{if(!entry.isFile()||!entry.name.endsWith('.obj'))throw Error('migration_object_format_invalid');const bytes=await readFile(path);if(bytes.length<4)throw Error('migration_object_corrupt');const length=bytes.readUInt32BE(0);if(length>65536||4+length>bytes.length)throw Error('migration_object_corrupt');const meta=JSON.parse(bytes.subarray(4,4+length));if(objects.path(meta.key)!==path||!await objects.get(meta.key))throw Error('migration_object_corrupt');allObjectsVerified++;}}}
    await verifyObjects(join(stage,'objects'));
    if(!columns.includes('archive_identity'))db.exec('ALTER TABLE emails ADD COLUMN archive_identity TEXT');
    db.exec('BEGIN IMMEDIATE');
    const used=new Set();
    for(const row of db.prepare('SELECT id,raw_key FROM emails ORDER BY id').iterate()){
      if(!row.raw_key)throw Error('migration_original_missing');
      const object=await objects.get(row.raw_key);if(!object)throw Error('migration_original_missing');
      const raw=Buffer.from(await new Response(object.body).arrayBuffer()),parsed=await PostalMime.parse(raw);let identity=archiveIdentity(raw,parsed);
      if(used.has(identity))identity=sha(identity+':preserved-history:'+row.id);used.add(identity);
      db.prepare('UPDATE emails SET archive_identity=? WHERE id=?').run(identity,row.id);verified++;
    }
    if(JSON.stringify(oldEmailFingerprint)!==JSON.stringify(inventoryTable(db,'emails',columns)))throw Error('migration_email_fields_changed');
    db.exec('CREATE TABLE IF NOT EXISTS product_migrated_emails(email_id INTEGER PRIMARY KEY)');
    if(!plan.tables.product_migrated_emails)db.exec('INSERT OR IGNORE INTO product_migrated_emails SELECT id FROM emails');
    db.exec('DROP INDEX IF EXISTS idx_emails_msgid; CREATE INDEX IF NOT EXISTS product_header_id ON emails(message_id); CREATE UNIQUE INDEX IF NOT EXISTS product_archive_identity ON emails(archive_identity) WHERE archive_identity IS NOT NULL; CREATE TABLE IF NOT EXISTS product_meta(id INTEGER PRIMARY KEY CHECK(id=1),schema INTEGER NOT NULL,owner TEXT NOT NULL,mode TEXT NOT NULL)');
    const old=db.prepare('SELECT * FROM product_meta WHERE id=1').get();
    if(old&&(old.owner!==owner||old.mode!=='personal'))throw Error('migration_product_identity_mismatch');
    db.prepare("INSERT OR IGNORE INTO product_meta VALUES(1,1,?,'personal')").run(owner);
    for(const [name,expected] of Object.entries(plan.tables)){
      if(name==='emails')continue;
      const actual=inventoryTable(db,name);if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('migration_preserved_table_changed:'+name);
    }
    db.exec('COMMIT');db.close();db=null;
    const receipt={schema:1,source,owner,planSha256:plan.sha256,originalsVerified:verified,objectsVerified:allObjectsVerified,preservedEmailFields:oldEmailFingerprint,preservedTables:plan.tables,sourceUnmodified:true};
    await writeFile(join(stage,'MIGRATION-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
    await rename(stage,destination);return receipt;
  }catch(error){sourceDB?.close();db?.close();await rm(stage,{recursive:true,force:true});throw error;}
}
function inventoryTable(db,name,columns){
  columns ||= db.prepare('PRAGMA table_info('+quote(name)+')').all().map(r=>r.name);
  const selection=columns.map(quote).join(','),hash=createHash('sha256');let count=0;
  for(const row of db.prepare('SELECT '+selection+' FROM '+quote(name)+' ORDER BY '+selection).iterate()){
    if(count++)hash.update('\n');hash.update(JSON.stringify(row,(_key,v)=>typeof v==='bigint'?String(v):v));
  }
  return {count,sha256:hash.digest('hex')};
}
