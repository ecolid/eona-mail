import {sourceAPI} from './source-api.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readConfig,validateConfig,loadSecrets,publicAccounts} from './config.mjs';
import {openStore} from './store.mjs';
import {openLocalAuth} from './local-auth.mjs';
import {productSender,productAI,productNotifier} from './connectors.mjs';
import {seedDemo} from './demo.mjs';
import {openDemoSessions} from './demo-sessions.mjs';
import {fetchWithIdentity,classifyEmail,saveMailLabels} from '../src/index.js';
import {openIdentity} from '../sv/identity.mjs';
import {openMailIcons} from '../sv/home-icons.mjs';
import {writeResponse} from '../sv/http-response.mjs';

const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'cache-control':'no-store',...headers}});
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function openProduct(input,options={}){
  const config=typeof input==='string'?await readConfig(input):validateConfig(input);
  const demoCookieName='mail-demo-'+createHash('sha256').update(config.origin).digest('hex').slice(0,16);
  const fetcher=options.fetcher||fetch,clock=options.clock||Date.now;
  const secrets=config.mode==='demo'?()=>{throw Error('demo_has_no_secrets')}:options.secrets||await loadSecrets(config);
  const icons=await openMailIcons(new URL(config.origin).hostname);
  const assets=new Map();
  for(const name of ['filament-boot','filament-theme','eona-ui','eona-foundation']){
    const bundled=new URL('./public/'+name+'.css',import.meta.url);
    let raw;try{raw=await readFile(bundled);}catch(error){if(error.code!=='ENOENT')throw error;raw=await readFile(new URL('../../../config/connectors/'+name+'.css',import.meta.url));}
    assets.set('/assets/'+name+'.css',raw);
  }
  let visitors=null,personal=null,closed=false,closing;
  async function create(root){
    const store=await openStore(config,{root,clock});
    try{
      const env=store.env;
      env.MAIL_PRODUCT={mode:config.mode,authMode:config.mode==='demo'?'demo':config.auth.mode,aliasDomain:'',tools:{applications:[],accountUrl:config.auth?.account_url||false},capabilities:{source_sync:config.sync?.enabled?'bidirectional':'import-only',local_state:true}};
      if(config.readonly_token_env)env.READONLY_TOKENS=secrets(config.readonly_token_env);
      env.MAIL_SYNC_ENABLED=config.mode==='personal'&&!!config.sync?.enabled;
      const sender=config.mode==='demo'?{list:async()=>[{id:'demo',address:config.owner.email,name:'演示账号',available:true}],send:async(_owner,message)=>({accepted:message.to.map(p=>p.address),rejected:[]})}:productSender(config,secrets,{createTransport:options.createTransport});
      if(sender)env.MAIL_SENDER=sender;
      const ai=productAI(config,secrets,{fetcher});if(ai)env.AI=ai;
      const notifier=productNotifier(config,secrets,{fetcher});
      const handlers={};
      if(ai)handlers.classify=async job=>{
        const row=await store.db.prepare('SELECT * FROM emails WHERE id=?').bind(job.email_id).first();
        if(!row)throw Error('classification_source_missing');
        const result=await classifyEmail(env,{...row,from:row.from_addr,fromName:row.from_name,textBody:row.text_body});
        await saveMailLabels(env,row.id,result);
      };
      if(notifier)handlers.notify=async job=>{
        const row=await store.db.prepare('SELECT id,subject,from_addr,from_name,received_at FROM emails WHERE id=?').bind(job.email_id).first();
        if(!row)throw Error('notification_source_missing');await notifier(row);
      };
      let running=null;
      store.runJobs=()=>running||(running=store.jobs.run(handlers).finally(()=>{running=null}));
      const close=store.close;store.close=async()=>{await running;await store.serialize(async()=>{});close();};
      if(config.mode==='demo')await seedDemo(store,config);
      return store;
    }catch(error){await store.close();throw error;}
  }
  let authentication=null;
  if(config.mode==='personal'){
    personal=await create(config.data_root);
    try{
      if(config.auth.mode==='local')authentication=await openLocalAuth(personal.db,config,secrets,{clock});
      else{
        const identityConfig={owner_subject:config.auth.subject||config.owner.id,owner_email:config.owner.email,origins:{[config.origin]:{app:'mail',issuer:config.auth.issuer,client_id:config.auth.client_id,client_secret:secrets(config.auth.client_secret_env),scopes:config.auth.scopes||'openid profile email offline_access'}}};
        const oidc=await openIdentity(join(config.data_root,'identity.db'),identityConfig,{fetcher,clock,authorizeClaims:claims=>claims?.sub===identityConfig.owner_subject&&claims.email===config.owner.email&&claims.email_verified===true});
        authentication={route:request=>new URL(request.url).pathname.startsWith('/auth/')||new URL(request.url).pathname==='/api/logout'?oidc.route(request):null,session:async request=>{const value=await oidc.session(request);return value?{...value,subject:config.owner.id}:null;},close:()=>oidc.close()};
      }
    }catch(error){await personal.close();throw error;}
  }
  if(config.mode==='demo')visitors=await openDemoSessions({root:join(config.data_root,'demo-workspaces'),create,clock});
  async function visitor(request){
    const value=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(demoCookieName+'='))?.slice(demoCookieName.length+1);
    const visit=await visitors.acquire(value);
    visit.item.store.env.MAIL_PRODUCT.workspaceId=visit.item.id;
    return {...visit,cookie:`${demoCookieName}=${visit.key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${config.origin.startsWith('https:')?'; Secure':''}`};
  }
  const internal=(request)=>sourceAPI(request,personal,config,{secrets,runJobs:()=>personal.runJobs(),clock});
  async function handle(request,{client='local'}={}){
    if(closed)return json({error:'product_closed'},503);
    const url=new URL(request.url),path=url.pathname;
    if(url.origin!==config.origin)return json({error:'wrong_origin'},403);
    if(path==='/health')return json({ok:true,product:'mail',schema:1,mode:config.mode});
    const icon=icons(request);if(icon)return icon;
    if(assets.has(path))return new Response(assets.get(path),{headers:{'content-type':'text/css','cache-control':'public,max-age=3600'}});
    if(!['GET','HEAD'].includes(request.method)&&((request.headers.has('origin')&&request.headers.get('origin')!==config.origin)||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'forbidden'},403);
    if(path.startsWith('/internal/'))return internal(request,path);
    if(path.startsWith('/api/import')||path.startsWith('/api/icloud-repair')||path.startsWith('/api/notifications'))return json({error:'integration_not_configured'},404);
    if(config.mode==='personal'&&request.headers.has('authorization')){
      if(!config.readonly_token_env||!equal(request.headers.get('authorization'),'Bearer '+secrets(config.readonly_token_env)))return json({error:'unauthorized'},401);
      const {default:application}=await import('../src/index.js');return application.fetch(request,personal.env);
    }
    let store=personal,demoVisit=null,identity;
    if(config.mode==='demo'){
      try{demoVisit=await visitor(request);store=demoVisit.item.store;}catch{return json({error:'demo_unavailable'},503);}
      identity={authenticated:true,subject:config.owner.id,email:config.owner.email};
    }else{
      const auth=await authentication.route(request,{client});if(auth)return auth;
      identity=await authentication.session(request);
      if(!identity&&path==='/api/me')return json({authed:false});
      if(!identity&&path!=='/'&&path!=='/index.html')return json({error:'unauthorized',...(config.auth.mode==='oidc'?{login_url:'/auth/start'}:{})},401);
      if(!identity&&config.auth.mode==='oidc')return new Response(null,{status:303,headers:{location:'/auth/start'}});
    }
    try{
      let response;
      if(demoVisit&&!['GET','HEAD'].includes(request.method)&&request.headers.has('x-mail-workspace')&&request.headers.get('x-mail-workspace')!==demoVisit.item.id)response=json({error:'workspace_changed'},409);
      else if(config.mode==='demo'&&path==='/api/logout'&&request.method==='POST'){
        await demoVisit.revoke();demoVisit.cookie=null;
        response=json({ok:true,logout_url:'/'},200,{'set-cookie':`${demoCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.origin.startsWith('https:')?'; Secure':''}`});
      }
      else if(path==='/api/product'&&identity)response=json({mode:config.mode,accounts:publicAccounts(config),sources:(await store.db.prepare('SELECT * FROM product_source_status').all()).results,jobs:await store.jobs.inspect(),source_sync:config.sync?.enabled?'bidirectional':'import-only',local_actions:['read','star','trash','restore']});
      else if(!identity){
        // The existing login surface is reused; no browser supplied identity is trusted.
        const {default:application}=await import('../src/index.js');response=await application.fetch(request,{...store.env,INBOX_PASSWORD:''});
      }else response=await fetchWithIdentity(request,store.env,identity);
      if(demoVisit){response=new Response(response.body,response);response.headers.set('x-mail-workspace',demoVisit.item.id);if(demoVisit.cookie)response.headers.append('set-cookie',demoVisit.cookie);}
      return response;
    }finally{await demoVisit?.release();}
  }
  return {config,handle,store:personal,runJobs:()=>personal?.runJobs(),close(){if(closing)return closing;closed=true;return closing=(async()=>{authentication?.close?.();await personal?.close();await visitors?.close();})();}};
}
export async function serveProduct(path,options={}){
  const product=await openProduct(path,options),origin=new URL(product.config.origin);
  const server=createServer(async(req,res)=>{
    try{
      if(req.headers.host!==origin.host){res.writeHead(403);res.end();return;}
      const url=new URL(req.url,origin);if(url.origin!==origin.origin){res.writeHead(403);res.end();return;}
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>72*1024*1024){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const request=new Request(url,{method:req.method,headers:req.headers,...(size?{body:Buffer.concat(chunks)}:{})});
      await writeResponse(await product.handle(request,{client:req.socket.remoteAddress}),res);
    }catch{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'product_unavailable'}));}
  });
  server.requestTimeout=60000;server.headersTimeout=15000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(product.config.port||Number(origin.port)||8789,'127.0.0.1',resolve);});}
  catch(error){await product.close();throw error;}
  return {...product,server,async close(){await new Promise(resolve=>server.close(resolve));await product.close();}};
}
