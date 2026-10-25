import {DatabaseSync} from 'node:sqlite';
import {mkdir,open,readFile,rename,unlink,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';

// D1 compatibility is deliberately small. A batch executes synchronously in
// one SQLite transaction, including rollback; no await can interleave writes.
export class SQLiteD1 {
  constructor(path,{readOnly=false}={}) {
    this.commitObservers=new Set();this.transactionChanges=null;
    this.db=new DatabaseSync(path,{readOnly,timeout:5000});
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    if(!readOnly)this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  }
  prepare(sql) {
    const owner=this;
    return {
      sql,args:[],
      bind(...args){return Object.assign(owner.prepare(sql),{args:args.map(v=>v===undefined?null:typeof v==='boolean'?Number(v):v)});},
      execute(mode='all') {
        const statement=owner.db.prepare(sql);
        if(mode==='first')return statement.get(...this.args)||null;
        if(mode==='run'){
          const result=statement.run(...this.args);
          if(Number(result.changes)>0)owner.committed([sql]);
          return {success:true,results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};
        }
        return {success:true,results:statement.all(...this.args),meta:{changes:0}};
      },
      async all(){return this.execute('all');},
      async first(column){const r=this.execute('first');return column?r?.[column]??null:r;},
      async run(){return this.execute('run');},
    };
  }
  // Both this connection's writes and external IMAP/sync commits invalidate
  // read projections. No table or mailbox inventory is duplicated here.
  changeToken(){return this.db.prepare('PRAGMA data_version').get().data_version+':'+this.db.prepare('SELECT total_changes() AS n').get().n;}
  // Persist the generation beside the archive. Triggers include external
  // source imports and reviewed corrections, while cache/notice writes do not
  // invalidate their own projections or force a full aggregation on each read.
  archiveRevision(){
    if(!this.archiveRevisionReady){
      this.db.exec(`CREATE TABLE IF NOT EXISTS mail_archive_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO mail_archive_revision VALUES(1,0);
        CREATE TRIGGER IF NOT EXISTS mail_archive_revision_insert AFTER INSERT ON emails BEGIN UPDATE mail_archive_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS mail_archive_revision_delete AFTER DELETE ON emails BEGIN UPDATE mail_archive_revision SET revision=revision+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS mail_archive_revision_update AFTER UPDATE OF alias,origin_to,folder,received_at,labels_json,ai_category ON emails
        WHEN OLD.alias IS NOT NEW.alias OR OLD.origin_to IS NOT NEW.origin_to OR OLD.folder IS NOT NEW.folder OR OLD.received_at IS NOT NEW.received_at OR OLD.labels_json IS NOT NEW.labels_json OR OLD.ai_category IS NOT NEW.ai_category
        BEGIN UPDATE mail_archive_revision SET revision=revision+1 WHERE id=1; END;`);
      this.archiveRevisionReady=true;
    }
    return this.db.prepare('SELECT revision FROM mail_archive_revision WHERE id=1').get().revision;
  }
  observeCommits(listener){this.commitObservers.add(listener);return()=>this.commitObservers.delete(listener);}
  committed(statements){
    if(this.transactionChanges){this.transactionChanges.push(...statements);return;}
    for(const listener of this.commitObservers){try{listener(statements);}catch{console.error(JSON.stringify({event:'mailhub_commit_observer_failed'}));}}
  }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    this.transactionChanges=[];
    try {
      const result=statements.map(s=>s.execute(/^\s*(SELECT|WITH|PRAGMA)\b/i.test(s.sql)?'all':'run'));
      this.db.exec('COMMIT');const changed=this.transactionChanges;this.transactionChanges=null;
      if(changed.length)this.committed(changed);return result;
    }catch(error){this.transactionChanges=null;this.db.exec('ROLLBACK');throw error;}
  }
  async exec(sql){this.db.exec(sql);return {count:1,duration:0};}
  close(){this.commitObservers.clear();this.db.close();}
}

async function durableWrite(path,data) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.tmp-'+randomUUID();
  const file=await open(temporary,'wx',0o600);
  try{await file.writeFile(data);await file.sync();}finally{await file.close();}
  try{await rename(temporary,path);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
  const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}
}

// Hash-derived filenames prevent traversal and preserve arbitrary legacy R2
// keys. Objects and their metadata commit as one envelope, not two rename races.
export class FileObjects {
  constructor(root){this.root=resolve(root);}
  path(key){
    if(typeof key!=='string'||!key||key.length>2048)throw Error('invalid_object_key');
    const h=createHash('sha256').update(key).digest('hex');return join(this.root,h.slice(0,2),h+'.obj');
  }
  async put(key,value,options={}){
    const bytes=typeof value==='string'?Buffer.from(value):value instanceof ArrayBuffer?Buffer.from(value):Buffer.from(value);
    const meta={key,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{}};
    const header=Buffer.from(JSON.stringify(meta));const length=Buffer.alloc(4);length.writeUInt32BE(header.length);
    await durableWrite(this.path(key),Buffer.concat([length,header,bytes]));return meta;
  }
  async get(key){
    let packed;try{packed=await readFile(this.path(key));}catch(error){if(error.code==='ENOENT')return null;throw error;}
    const length=packed.readUInt32BE(0);if(length>65536||length+4>packed.length)throw Error('object_corrupt');
    const meta=JSON.parse(packed.subarray(4,4+length));const data=packed.subarray(4+length);
    if(meta.key!==key||data.length!==meta.size||createHash('sha256').update(data).digest('hex')!==meta.sha256)throw Error('object_corrupt');
    return {...meta,body:new Response(data).body,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength),text:async()=>data.toString('utf8'),writeHttpMetadata(h){for(const [k,v]of Object.entries(meta.httpMetadata))if(k==='contentType')h.set('content-type',v);}};
  }
  async head(key){const object=await this.get(key);if(!object)return null;const {body,arrayBuffer,text,writeHttpMetadata,...meta}=object;return meta;}
  async delete(key){await unlink(this.path(key)).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export {durableWrite};
