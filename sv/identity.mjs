import * as oidc from 'openid-client';
import {decodeJwt,jwtVerify,createLocalJWKSet} from 'jose';
import {randomBytes,createHash} from 'node:crypto';
import {SQLiteD1} from './storage.mjs';
import {authPage,isAuthDocument} from './auth-page.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const opaque=()=>randomBytes(32).toString('base64url');
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax${age===null?'':'; Max-Age='+age}`;
const readCookie=(r,name)=>(r.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
const sessionName=p=>'__Host-eona-'+p.app+'-session';
const flowName=(p,state)=>'__Host-eona-'+p.app+'-flow'+(state?'-'+sha(state).slice(0,16):'');
const flowSeconds=900;
// Keep only a browser binding beyond the code-grant deadline. It can restart
// an expired flow once; it cannot redeem an expired authorization code.
const recoverySeconds=28800;
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'cache-control':'no-store',...headers}});
const redirect=(url,headers={})=>new Response(null,{status:303,headers:{location:String(url),'cache-control':'no-store',...headers}});
export function safeReturn(value){return typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!/[\\\r\n]/.test(value)&&!value.startsWith('/auth/')?value:'/';}
export function ownerClaims(claims,config){
  return !!claims&&typeof config.owner_subject==='string'&&config.owner_subject.length>0
    &&claims.sub===config.owner_subject&&claims.email===config.owner_email
    &&claims.email_verified===true&&claims.eona_private_owner===true;
}

export function accountClaims(claims,config,policy){
  if(policy.account_scope!=='notifications')return ownerClaims(claims,config);
  return ['notification','ntfy'].includes(policy.app)&&!!claims&&typeof claims.sub==='string'&&claims.sub.length>0&&claims.sub.length<=256&&!/[\x00-\x1f]/.test(claims.sub)&&claims.email_verified===true&&typeof claims.email==='string'&&claims.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email);
}

// Opt-in contract with an issuer: only verified ID-token claims determine
// persistence. Query parameters and userinfo cannot upgrade a browser session.
function issuedSession(claims,config,now){
  let age=Math.min(config.session_seconds||34560000,34560000),persistent=true;
  if(config.session_claims){
    const p=config.session_claims,choice=claims[p.persistent],expires=claims[p.expires_at];
    if(typeof choice!=='boolean'||!Number.isFinite(expires))throw Error('session_policy_missing');
    persistent=choice;
    age=Math.floor(Math.min(age,expires-now/1000,persistent?age:43200));
    if(age<1)throw Error('session_policy_expired');
  }
  return {age,persistent};
}

// The provider connection is local, even when its public browser endpoint
// uses CF. Origins and issuer URLs are explicit configuration, never headers.
export async function openIdentity(path,config,{fetcher=fetch,clock=Date.now,onRevoke=async()=>{},authorizeClaims=accountClaims}={}){
  if(config.session_claims&&['persistent','expires_at'].some(k=>typeof config.session_claims[k]!=='string'||!/^[a-zA-Z][\w.:-]{0,99}$/.test(config.session_claims[k])))throw Error('identity_session_policy_invalid');
  const db=new SQLiteD1(path),providers=new Map(),refreshes=new Map(),logoutKeys=new Map(),callbacks=new Map();
  await db.exec(`CREATE TABLE IF NOT EXISTS auth_states(key TEXT PRIMARY KEY,origin TEXT NOT NULL,body TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_sessions(key TEXT PRIMARY KEY,origin TEXT NOT NULL,body TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_logout_replays(key TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  const revocations=config.revocation_db?new SQLiteD1(config.revocation_db):db;
  await revocations.exec(`CREATE TABLE IF NOT EXISTS auth_user_revocations(subject TEXT PRIMARY KEY,generation INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_shared_logout_replays(key TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
  const generation=async(subject=config.owner_subject)=>Number((await revocations.prepare('SELECT generation FROM auth_user_revocations WHERE subject=?').bind(subject).first())?.generation||0);
  const generationSnapshot=async()=>Object.fromEntries((await revocations.prepare('SELECT subject,generation FROM auth_user_revocations').all()).results.map(r=>[r.subject,Number(r.generation)]));
  const flowGeneration=(flow,subject)=>flow.generations?Number(flow.generations[subject]||0):Number(flow.revocation_generation||0);
  const revokeUser=subject=>revocations.prepare('INSERT INTO auth_user_revocations VALUES(?,1) ON CONFLICT(subject) DO UPDATE SET generation=generation+1').bind(subject).run();
  const origins=config.origins||{};
  for(const [origin,p] of Object.entries(origins)){
    if(new URL(origin).origin!==origin||!origin.startsWith('https://')||!p.issuer.startsWith('https://')||!['mail','notification','me','ledger','servers','ntfy','dsh','cang','resume'].includes(p.app))throw Error('identity_config_invalid');
    if(p.account_scope!==undefined&&(p.account_scope!=='notifications'||!['notification','ntfy'].includes(p.app)))throw Error('identity_account_scope_invalid');
    if(p.portal_home===true&&(p.app!=='mail'||p.mail_path!=='/mail'))throw Error('identity_portal_invalid');
    if(p.mail_path!==undefined&&p.mail_path!=='/mail')throw Error('identity_mail_path_invalid');
  }
  const now=()=>clock();
  async function provider(origin){
    if(providers.has(origin))return providers.get(origin);
    const p=origins[origin];if(!p)throw Error('origin_forbidden');const issuer=new URL(p.issuer),allowedOrigin=issuer.origin;
    const localFetch=async(url,options={})=>{
      const u=new URL(url);if(u.origin!==allowedOrigin)throw Error('provider_endpoint_forbidden');
      if(!config.local_url)return fetcher(u,{...options,redirect:'manual',signal:AbortSignal.timeout(8000)});
      const local=new URL(u.pathname+u.search,config.local_url);if(local.origin!==config.local_url||!['127.0.0.1','localhost'].includes(local.hostname))throw Error('provider_local_invalid');
      const headers=new Headers(options.headers);headers.set('host',issuer.host);headers.set('x-forwarded-proto','https');headers.set('x-forwarded-host',issuer.host);
      return fetcher(local,{...options,headers,redirect:'manual',signal:AbortSignal.timeout(8000)});
    };
    const discovery=new URL(issuer.href.replace(/\/?$/,'/')+'.well-known/openid-configuration');
    const res=await localFetch(discovery);if(!res.ok)throw Error('provider_unavailable');
    const meta=await res.json();if(meta.issuer!==p.issuer)throw Error('issuer_mismatch');
    for(const field of ['authorization_endpoint','token_endpoint','jwks_uri','userinfo_endpoint','revocation_endpoint','end_session_endpoint'])if(meta[field]&&new URL(meta[field]).origin!==allowedOrigin)throw Error('provider_endpoint_forbidden');
    const c=new oidc.Configuration(meta,p.client_id,p.client_secret);c.timeout=8;c[oidc.customFetch]=localFetch;oidc.enableNonRepudiationChecks(c);providers.set(origin,c);return c;
  }
  async function session(request){
    const origin=new URL(request.url).origin,p=origins[origin];if(!p)return null;
    const key=readCookie(request,sessionName(p));if(!/^[\w-]{43}$/.test(key))return null;const hash=sha(key);
    const row=await db.prepare('SELECT body,expires FROM auth_sessions WHERE key=? AND origin=?').bind(hash,origin).first();
    if(!row||row.expires<=now()){if(row)await db.prepare('DELETE FROM auth_sessions WHERE key=?').bind(hash).run();return null;}
    let body=JSON.parse(row.body);
    if(!authorizeClaims(body.claims,config,p))return null;
    if(Number(body.revocation_generation||0)!==await generation(body.claims.sub)){
      await db.prepare('DELETE FROM auth_sessions WHERE key=?').bind(hash).run();return null;
    }
    if(body.access_until<=now()+30000){
      if(!body.refresh_token){await db.prepare('DELETE FROM auth_sessions WHERE key=?').bind(hash).run();return null;}
      if(!refreshes.has(hash))refreshes.set(hash,(async()=>{
        try{
          const tokens=await oidc.refreshTokenGrant(await provider(origin),body.refresh_token);
          const user=await oidc.fetchUserInfo(await provider(origin),tokens.access_token,body.claims.sub);
          const claims={...(tokens.claims()||body.claims),...user};if(!authorizeClaims(claims,config,p)||claims.sub!==body.claims.sub)throw Error('owner_revoked');
          body={...body,claims,access_token:tokens.access_token,refresh_token:tokens.refresh_token||body.refresh_token,access_until:now()+Number(tokens.expires_in||60)*1000,id_token:tokens.id_token||body.id_token};
          await db.prepare('UPDATE auth_sessions SET body=? WHERE key=? AND origin=?').bind(JSON.stringify(body),hash,origin).run();return body;
        }catch{await db.prepare('DELETE FROM auth_sessions WHERE key=?').bind(hash).run();return null;}
        finally{refreshes.delete(hash);}
      })());
      body=await refreshes.get(hash);if(!body)return null;
    }
    if(Number(body.revocation_generation||0)!==await generation(body.claims.sub))return null;
    return {authenticated:true,email:body.claims.email,subject:body.claims.sub,body,key:hash};
  }
  const failure=(request,error,status=400,options={})=>isAuthDocument(request)?authPage(error,{status,...options}):json({error},status);
  async function beginLogin(request,p,{returnTo='/',reauth=false,recoveryAttempt=0,revocationGeneration,generations}={}){
    const u=new URL(request.url);
    await db.prepare('DELETE FROM auth_states WHERE expires<?').bind(now()-recoverySeconds*1000).run();
    const secret=opaque(),state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier();
    const body={state,nonce,verifier,returnTo:safeReturn(returnTo),reauth,recoveryAttempt,startedAt:now(),revocation_generation:revocationGeneration??await generation(),...(p.account_scope==='notifications'?{generations:generations??await generationSnapshot()}:{})};
    const url=oidc.buildAuthorizationUrl(await provider(u.origin),{redirect_uri:u.origin+'/auth/callback',scope:p.scopes||'openid profile email offline_access eona_owner',state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',...(reauth?{prompt:'login',max_age:'0'}:{})});
    await db.prepare('INSERT INTO auth_states VALUES(?,?,?,?)').bind(sha(secret),u.origin,JSON.stringify(body),now()+flowSeconds*1000).run();
    return redirect(url,{'set-cookie':cookie(flowName(p,state),secret,recoverySeconds)});
  }
  async function route(request){
    const u=new URL(request.url),p=origins[u.origin];if(!p)return json({error:'wrong_host'},403);
    if(u.pathname==='/auth/backchannel'&&request.method==='POST'){
      if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return json({error:'invalid_logout'},400);
      const text=await request.text();if(text.length>16384)return json({error:'invalid_logout'},400);
      try{
        const raw=new URLSearchParams(text).get('logout_token');if(!raw)throw Error('missing_token');
        // Unverified claims only select an explicit issuer/client configuration.
        // Authorization happens only after signature and all claims validate.
        const hint=decodeJwt(raw),selected=Object.entries(origins).find(([,x])=>
          [x.issuer,...(x.logout_issuers||[])].includes(hint.iss)&&
          (Array.isArray(hint.aud)?hint.aud:[hint.aud]).includes(x.client_id));
        if(!selected)throw Error('issuer_forbidden');const [origin,op]=selected;
        let keys=logoutKeys.get(origin);
        if(!keys||keys.until<=now()){
          const c=await provider(origin),issuer=new URL(op.issuer),endpoint=new URL(c.serverMetadata().jwks_uri);
          const headers={host:issuer.host,'x-forwarded-proto':'https','x-forwarded-host':issuer.host};
          const res=await fetcher(config.local_url?new URL(endpoint.pathname,config.local_url):endpoint,{...(config.local_url?{headers}:{}),redirect:'manual',signal:AbortSignal.timeout(8000)});
          if(!res.ok)throw Error('keys_unavailable');keys={until:now()+60000,jwk:createLocalJWKSet(await res.json())};logoutKeys.set(origin,keys);
        }
        const {payload}=await jwtVerify(raw,keys.jwk,{algorithms:['RS256'],issuer:hint.iss,audience:op.client_id,
          currentDate:new Date(now()),maxTokenAge:'3m',clockTolerance:5,requiredClaims:['sub','iat','jti','events']});
        if((op.account_scope!=='notifications'&&payload.sub!==config.owner_subject)||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>256||typeof payload.jti!=='string'||!payload.jti||payload.jti.length>512||'nonce' in payload
          ||!payload.events||!Object.hasOwn(payload.events,'http://schemas.openid.net/event/backchannel-logout'))throw Error('invalid_claims');
        await revocations.prepare('DELETE FROM auth_shared_logout_replays WHERE expires<?').bind(now()).run();
        const result=await revocations.batch([
          revocations.prepare('INSERT OR IGNORE INTO auth_shared_logout_replays VALUES(?,?)').bind(sha(payload.iss+'\n'+payload.jti),now()+600000),
          revocations.prepare('INSERT INTO auth_user_revocations(subject,generation) SELECT ?,1 WHERE changes()>0 ON CONFLICT(subject) DO UPDATE SET generation=generation+1').bind(payload.sub),
        ]);
        if(result[0].meta.changes){await db.prepare("DELETE FROM auth_sessions WHERE json_extract(body,'$.claims.sub')=?").bind(payload.sub).run();await onRevoke(payload.sub).catch(()=>{});}
        const response=json({ok:true,replayed:result[0].meta.changes===0});response.logoutSubject=payload.sub;return response;
      }catch{return json({error:'invalid_logout'},400);}
    }
    if(p.login_enabled===false)return failure(request,'account_login_not_enabled',503);
    if(u.pathname==='/auth/logged-out'&&request.method==='GET')return authPage('logged_out',{status:200});
    if(u.pathname==='/auth/account'&&request.method==='GET'){
      const target=new URL('/if/user/',p.issuer);
      if(u.searchParams.get('view')==='settings')target.hash='/settings';
      return redirect(target);
    }
    if(u.pathname==='/auth/start'&&request.method==='GET'){
      return beginLogin(request,p,{returnTo:u.searchParams.get('return'),reauth:u.searchParams.get('reauth')==='1'});
    }
    if(u.pathname==='/auth/callback'&&request.method==='GET'){
      const state=u.searchParams.get('state');
      const name=/^[\w-]{43}$/.test(state||'')?flowName(p,state):flowName(p);
      const boundName=readCookie(request,name)?name:flowName(p);
      async function unavailableFlow(error,flow){
        // An authorization callback is single-use. Revisiting it after a
        // successful login may use only the already verified owner session;
        // it must never exchange the old code without the browser-bound flow.
        if(await session(request))return redirect('/');
        const action=flow?'/auth/start?return='+encodeURIComponent(safeReturn(flow.returnTo))+(flow.reauth?'&reauth=1':''):'/auth/start';
        return failure(request,error,400,{action,headers:{'set-cookie':cookie(boundName,'',0)}});
      }
      const secret=readCookie(request,boundName);if(!/^[\w-]{43}$/.test(secret))return unavailableFlow('login_flow_missing');
      // A navigation can be cancelled after the provider consumes its code.
      // Coalesce the same browser-bound callback, and retain its verified
      // result briefly so the next navigation receives the original cookies.
      const callbackKey=sha(u.origin+'\n'+secret+'\n'+state+'\n'+(u.searchParams.get('code')||''));
      for(const [key,value] of callbacks)if(value.done&&value.until<=now())callbacks.delete(key);
      const prior=callbacks.get(callbackKey);
      async function repeat(entry){
        const response=await entry.promise;
        const issued=response.headers.getSetCookie().find(value=>value.startsWith(sessionName(p)+'='));
        if(issued&&!await session(new Request(u.origin+'/',{headers:{cookie:issued.split(';')[0]}})))return failure(request,'login_flow_revoked');
        return response.clone();
      }
      if(prior)return repeat(prior);
      if(callbacks.size>=128)return failure(request,'identity_unavailable',503);
      let finish;
      const entry={until:now()+60000,done:false,promise:new Promise(resolve=>finish=resolve)};
      callbacks.set(callbackKey,entry);
      async function exchange(){
      const hash=sha(secret),row=await db.prepare('SELECT body,expires FROM auth_states WHERE key=? AND origin=?').bind(hash,u.origin).first();
      if(!row)return unavailableFlow('login_flow_expired');
      const flow=JSON.parse(row.body);
      // A stray/older tab must not consume the current tab's flow.
      if(flow.state!==state)return failure(request,'login_validation_failed');
      if(!flow.generations&&Number(flow.revocation_generation||0)!==await generation())return failure(request,'login_flow_revoked');
      if(row.expires<=now()){
        const consumed=await db.prepare('DELETE FROM auth_states WHERE key=? AND origin=? RETURNING key').bind(hash,u.origin).first();
        if(consumed&&isAuthDocument(request)&&!flow.reauth&&!flow.recoveryAttempt&&row.expires+recoverySeconds*1000>now()){
          const resumed=await beginLogin(request,p,{returnTo:flow.returnTo,recoveryAttempt:1,revocationGeneration:flow.revocation_generation||0,generations:flow.generations});
          resumed.headers.append('set-cookie',cookie(boundName,'',0));return resumed;
        }
        return unavailableFlow('login_flow_expired',flow);
      }
      const consumed=await db.prepare('DELETE FROM auth_states WHERE key=? AND origin=? AND expires>? RETURNING key').bind(hash,u.origin,now()).first();
      if(!consumed)return unavailableFlow('login_flow_expired');
      try{
        const tokens=await oidc.authorizationCodeGrant(await provider(u.origin),u,{expectedState:flow.state,expectedNonce:flow.nonce,pkceCodeVerifier:flow.verifier,idTokenExpected:true});
        const claims=tokens.claims();if(!authorizeClaims(claims,config,p))return failure(request,'application_forbidden',403);
        if(flowGeneration(flow,claims.sub)!==await generation(claims.sub))return failure(request,'login_flow_revoked');
        if(flow.reauth&&(!Number.isFinite(claims.auth_time)||claims.auth_time*1000<flow.startedAt-60000||claims.auth_time*1000>now()+30000))return failure(request,'recent_authentication_required',403,{action:'/auth/start?reauth=1&return='+encodeURIComponent(safeReturn(flow.returnTo))});
        const {age,persistent}=issuedSession(claims,config,now());
        const sid=opaque(),body={claims,access_token:tokens.access_token,refresh_token:tokens.refresh_token,id_token:tokens.id_token,access_until:now()+Number(tokens.expires_in||60)*1000,revocation_generation:flowGeneration(flow,claims.sub)};
        await db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').bind(sha(sid),u.origin,JSON.stringify(body),now()+age*1000).run();
        const res=redirect(flow.returnTo);res.headers.append('set-cookie',cookie(sessionName(p),sid,persistent?age:null));res.headers.append('set-cookie',cookie(boundName,'',0));return res;
      }catch{return failure(request,'login_validation_failed');}
      }
      let result;
      try{result=await exchange();}catch{result=failure(request,'identity_unavailable',503);}
      entry.done=true;entry.until=now()+60000;finish(result);
      if(result.status!==303||!result.headers.getSetCookie().some(value=>value.startsWith(sessionName(p)+'=')))callbacks.delete(callbackKey);
      return result.clone();
    }
    if(['/auth/logout','/api/logout'].includes(u.pathname)&&request.method==='POST'){
      if(request.headers.get('origin')!==u.origin)return json({error:'forbidden_origin'},403);
      let logoutUrl;const own=await session(request);if(own&&request.headers.has('x-eona-account')&&request.headers.get('x-eona-account')!==sha(own.subject).slice(0,24))return json({error:'account_changed'},409);if(own){
        await revokeUser(own.subject);await onRevoke(own.subject).catch(()=>{});
        const rows=await db.prepare('SELECT origin,body FROM auth_sessions WHERE json_extract(body,\'$.claims.sub\')=?').bind(own.subject).all();
        await db.prepare('DELETE FROM auth_sessions WHERE json_extract(body,\'$.claims.sub\')=?').bind(own.subject).run();
        try{logoutUrl=String(oidc.buildEndSessionUrl(await provider(u.origin),{id_token_hint:own.body.id_token,post_logout_redirect_uri:u.origin+'/auth/logged-out'}));}catch{}
        await Promise.allSettled(rows.results.map(async row=>{
          const saved=JSON.parse(row.body);if(saved.refresh_token)await oidc.tokenRevocation(await provider(row.origin),saved.refresh_token);
        }));
      }
      return json({ok:true,logout_url:logoutUrl},200,{'set-cookie':cookie(sessionName(p),'',0)});
    }
    return json({error:'not_found'},404);
  }
  return {config,origins,session,route:async request=>{try{return await route(request);}catch{return failure(request,'identity_unavailable',503);}},provider,close:()=>{if(revocations!==db)revocations.close();db.close();}};
}
