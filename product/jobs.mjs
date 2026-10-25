import {createHash,randomUUID} from 'node:crypto';
export async function openJobs(db,{clock=Date.now}={}){
  await db.exec(`CREATE TABLE IF NOT EXISTS product_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,email_id INTEGER NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0,lease TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS product_jobs_due ON product_jobs(kind,state,next_at);`);
  const statement=(kind,emailId,payload={})=>{
    const id=createHash('sha256').update(kind+':'+emailId).digest('hex');
    return db.prepare("INSERT OR IGNORE INTO product_jobs(id,kind,email_id,payload,state,next_at) VALUES(?,?,?,?,'pending',?)").bind(id,kind,emailId,JSON.stringify(payload),clock());
  };
  async function run(handlers,{limit=8}={}){
    const results=[];
    await Promise.all(Object.entries(handlers).map(async([kind,handler])=>{
      const rows=(await db.prepare("SELECT * FROM product_jobs WHERE kind=? AND next_at<=? AND (state IN ('pending','error') OR (state='working' AND lease_until<=?)) ORDER BY next_at,id LIMIT ?").bind(kind,clock(),clock(),limit).all()).results;
      for(const row of rows){
        const lease=randomUUID();
        const claim=await db.prepare("UPDATE product_jobs SET state='working',lease=?,lease_until=?,attempts=attempts+1 WHERE id=? AND (state IN ('pending','error') OR (state='working' AND lease_until<=?))").bind(lease,clock()+120000,row.id,clock()).run();
        if(!claim.meta.changes)continue;
        try{
          await handler({...row,payload:JSON.parse(row.payload)});
          await db.prepare("UPDATE product_jobs SET state='done',lease_until=0,error='' WHERE id=? AND lease=?").bind(row.id,lease).run();
          results.push({kind,id:row.id,state:'done'});
        }catch{
          const wait=Math.min(3600000,1000*2**Math.min(row.attempts+1,12));
          await db.prepare("UPDATE product_jobs SET state='error',lease_until=0,next_at=?,error='connector_failed' WHERE id=? AND lease=?").bind(clock()+wait,row.id,lease).run();
          results.push({kind,id:row.id,state:'error'});
        }
      }
    }));
    return results;
  }
  const inspect=async()=> (await db.prepare('SELECT kind,state,COUNT(*) count,MIN(next_at) next_at FROM product_jobs GROUP BY kind,state').all()).results;
  return {statement,run,inspect};
}
