import {mkdir,readdir,rm,lstat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const digest=value=>createHash('sha256').update(value).digest('hex');
async function ownRoot(root){
  await mkdir(root,{recursive:true,mode:0o700});
  const path=join(root,'.runtime-lock.db');let lock;
  try{
    // The OS releases this SQLite lease after a crash. Unlike a PID file,
    // acquiring it and reclaiming orphan directories has no stale-lock race.
    lock=new DatabaseSync(path,{timeout:0});
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');await chmod(path,0o600);
    return async()=>{try{lock.exec('ROLLBACK');}finally{lock.close();}};
  }catch(error){lock?.close();if([5,6].includes(error.errcode))throw Error('demo_workspace_in_use');throw error;}
}

export async function openDemoSessions({root,create,clock=Date.now,ttl=3600000,maxSessions=64}){
  const releaseRoot=await ownRoot(root),sessions=new Map(),items=new Set();
  let chain=Promise.resolve(),closed=false,closing;
  const serialize=run=>{const task=chain.then(run);chain=task.catch(()=>{});return task;};
  const dispose=item=>item.closing||(item.closing=(async()=>{await item.store?.close();await rm(item.root,{recursive:true,force:true});items.delete(item);})());
  const retire=item=>{item.retired=true;if(sessions.get(item.key)===item)sessions.delete(item.key);};
  const expire=async()=>{for(const item of sessions.values())if(!item.active&&clock()-item.last>=ttl){retire(item);await dispose(item);}};
  try{
    // Only this module's hash-named workspace directories belong to cleanup.
    // The root lease prevents a second live instance from deleting them.
    for(const name of await readdir(root))if(/^[a-f0-9]{64}$/.test(name)){
      const path=join(root,name);if((await lstat(path)).isDirectory())await rm(path,{recursive:true,force:true});
    }
  }catch(error){await releaseRoot();throw error;}
  const timer=setInterval(()=>serialize(async()=>{if(!closed)await expire();}).catch(()=>{console.error(JSON.stringify({event:'mail_demo_cleanup_failed'}));}),Math.min(ttl,60000));timer.unref();
  return {
    acquire(key,{create:allowCreate=true}={}){return serialize(async()=>{
      if(closed)throw Error('demo_closed');
      await expire();
      let item=sessions.get(key);
      if(item&&clock()-item.last>=ttl){retire(item);if(!item.active)await dispose(item);item=null;}
      if(!item){
        if(!allowCreate)throw Error('demo_session_expired');
        if(items.size>=maxSessions)throw Error('demo_capacity_reached');
        key=randomBytes(32).toString('base64url');
        item={key,id:digest(key),root:join(root,digest(key)),last:clock(),active:0,retired:false};
        sessions.set(key,item);items.add(item);
        try{item.store=await create(item.root);}catch(error){retire(item);await dispose(item);throw error;}
      }
      item.last=clock();
      if(!item.active)item.idle=new Promise(resolve=>{item.resolveIdle=resolve;});
      item.active++;
      let released=false;
      return {item,key,
        revoke:()=>serialize(async()=>{retire(item);if(!item.active)await dispose(item);}),
        release:()=>serialize(async()=>{if(released)return;released=true;item.active--;if(!item.active){item.resolveIdle();if(item.retired)await dispose(item);}}),
      };
    });},
    close(){
      if(closing)return closing;
      closed=true;clearInterval(timer);
      return closing=(async()=>{
        const pending=await serialize(()=>{const all=[...items];for(const item of all)retire(item);return all;});
        try{
          const results=await Promise.allSettled(pending.map(async item=>{if(item.active)await item.idle;await dispose(item);}));
          const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
        }finally{await releaseRoot();}
      })();
    },
  };
}
