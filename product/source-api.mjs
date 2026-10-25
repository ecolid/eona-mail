import {sourceFolders,sourceHealthAPI} from './source-health.mjs';
import {publicAccounts} from './config.mjs';
import {timingSafeEqual} from 'node:crypto';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function sourceAPI(request,store,config,{secrets,runJobs=async()=>[],clock=Date.now}){
 const path=new URL(request.url).pathname;
    if(config.mode!=='personal'||!equal(request.headers.get('authorization'),'Bearer '+secrets('MAIL_WORKER_TOKEN')))return json({error:'forbidden'},403);
    if(path==='/internal/product/status'&&request.method==='GET')return json({accounts:publicAccounts(config),sources:(await store.db.prepare('SELECT * FROM product_source_status').all()).results,jobs:await store.jobs.inspect(),inventories:(await store.db.prepare('SELECT * FROM product_source_inventory').all()).results,audits:(await store.db.prepare('SELECT * FROM product_source_audit').all()).results});
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    if(path==='/internal/product/run')return json({jobs:await runJobs()});
    const body=await request.json().catch(()=>null);if(!body)return json({error:'invalid_json'},400);
    if(['/internal/product/source-inventory','/internal/product/source-coverage'].includes(path)){try{return json(await sourceHealthAPI(path,body,store,config,{clock}));}catch(error){return json({error:error.message},400);}}
    if(path==='/internal/product/known-copies'){
      const account=config.accounts.find(a=>a.id===body.account);
      if((!account?.imap||!(await sourceFolders(store.db,account)).some(f=>f.name===body.folder))||typeof body.validity!=='string'||!/^\d+$/.test(body.validity)||!Array.isArray(body.uids)||body.uids.length>100||body.uids.some(x=>typeof x!=='string'||!/^\d+$/.test(x)))return json({error:'source_proof_query_invalid'},400);
      const rows=body.uids.length?(await store.db.prepare('SELECT uid FROM product_source_copies WHERE account=? AND folder=? AND validity=? AND uid IN ('+body.uids.map(()=>'?').join(',')+')').bind(body.account,body.folder,body.validity,...body.uids).all()).results:[];
      return json({uids:rows.map(r=>r.uid)});
    }
    if(path==='/internal/product/ingest'){
      if(typeof body.raw_base64!=='string'||body.raw_base64.length>70*1024*1024)return json({error:'raw_size_invalid'},413);
      try{return json(await store.ingest(Buffer.from(body.raw_base64,'base64'),body.source));}catch(error){return json({error:error.message},409);}
    }
    if(path==='/internal/product/source-status'){
      const account=config.accounts.find(a=>a.id===body.account);
      if((!account?.imap||!(await sourceFolders(store.db,account)).some(f=>f.name===body.folder))||!['ok','backfilling','error'].includes(body.state)||['last_uid','backfill_cursor','backfill_until'].some(k=>!Number.isSafeInteger(body[k])||body[k]<0)||typeof body.validity!=='string'||body.validity.length>100)return json({error:'source_status_invalid'},400);
      const old=await store.db.prepare('SELECT * FROM product_source_status WHERE account=? AND folder=?').bind(body.account,body.folder).first();
      if(old?.validity===body.validity&&(body.last_uid<old.last_uid||body.backfill_cursor<old.backfill_cursor))return json({error:'stale_source_cursor'},409);
      const previous=JSON.parse(old?.gaps_json||'[]'),gaps=body.gaps??previous;
      if(!Array.isArray(gaps)||gaps.length>1000||gaps.some(g=>!g||typeof g.uid!=='string'||!/^\d+$/.test(g.uid)||typeof g.validity!=='string'||!/^\d+$/.test(g.validity)||typeof g.historical!=='boolean'||!Number.isSafeInteger(g.retry_after)||g.retry_after<0)||new Set(gaps.map(g=>g.validity+':'+g.uid)).size!==gaps.length)return json({error:'source_gaps_invalid'},400);
      // A cursor may pass an unavailable original only with a durable gap.
      // A gap can disappear only after its exact source proof has committed.
      for(const gap of previous)if(!gaps.some(g=>g.uid===gap.uid&&g.validity===gap.validity)&&!await store.db.prepare('SELECT 1 FROM product_source_copies WHERE account=? AND folder=? AND validity=? AND uid=?').bind(body.account,body.folder,gap.validity,gap.uid).first())return json({error:'source_gap_unresolved'},409);
      const state=gaps.length?'error':body.state;
      await store.db.prepare('INSERT INTO product_source_status(account,folder,validity,last_uid,backfill_cursor,backfill_until,state,checked_at,error,gaps_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,folder) DO UPDATE SET validity=excluded.validity,last_uid=excluded.last_uid,backfill_cursor=excluded.backfill_cursor,backfill_until=excluded.backfill_until,state=excluded.state,checked_at=excluded.checked_at,error=excluded.error,gaps_json=excluded.gaps_json').bind(body.account,body.folder,body.validity,body.last_uid,body.backfill_cursor,body.backfill_until,state,new Date(clock()).toISOString(),gaps.length?'source_original_unavailable':state==='error'?'source_unavailable':'',JSON.stringify(gaps)).run();
      return json({ok:true});
    }
    return json({error:'not_found'},404);
}
