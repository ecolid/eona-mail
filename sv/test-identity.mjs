import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {openIdentity,ownerClaims,safeReturn} from './identity.mjs';
import {createServer,request as httpRequest} from 'node:http';
import {writeResponse} from './http-response.mjs';
import {DatabaseSync} from 'node:sqlite';

const root=await mkdtemp(join(tmpdir(),'eona-identity-'));
let identity,secondary;
try{
  const origin='https://mail.example.invalid',issuer='https://account.example.invalid/application/o/mail/';
  const config={revocation_db:join(root,'revocations.db'),local_url:'http://127.0.0.1:9000',owner_subject:'owner-id',owner_email:'owner@example.invalid',origins:{[origin]:{app:'mail',issuer,client_id:'mail-client',client_secret:'client-secret'}}};
  const notice='https://notice.example.invalid';config.origins[notice]={...config.origins[origin],app:'notification'};
  let instant=Date.now();
  const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk={...await exportJWK(publicKey),kid:'key1',alg:'RS256',use:'sig'};
  const claims={sub:'owner-id',email:config.owner_email,email_verified:true,eona_private_owner:true};
  let tokenGate=null,tokenStarted=null;
  let nonce,wrongNonce=false,wrongAudience=false,tokenCalls=0,allowed=true;
  const fetcher=async(url,options)=>{
    const u=new URL(url);assert.equal(u.origin,config.local_url);assert.equal(new Headers(options.headers).get('host'),'account.example.invalid');
    if(u.pathname.endsWith('openid-configuration'))return Response.json({issuer,authorization_endpoint:'https://account.example.invalid/application/o/authorize/',token_endpoint:'https://account.example.invalid/application/o/token/',jwks_uri:issuer+'jwks/',userinfo_endpoint:'https://account.example.invalid/application/o/userinfo/',revocation_endpoint:'https://account.example.invalid/application/o/revoke/',end_session_endpoint:issuer+'end-session/',response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256']});
    if(u.pathname.endsWith('/jwks/'))return Response.json({keys:[jwk]});
    if(u.pathname.endsWith('/userinfo/'))return Response.json({...claims,eona_private_owner:allowed});
    if(u.pathname.endsWith('/revoke/'))return new Response(null,{status:200});
    if(u.pathname.endsWith('/token/')){
      tokenCalls++;tokenStarted?.();if(tokenGate)await tokenGate;
      const id=await new SignJWT({...claims,nonce:wrongNonce?'wrong':nonce}).setProtectedHeader({alg:'RS256',kid:'key1'}).setIssuer(issuer).setAudience(wrongAudience?'another-client':'mail-client').setIssuedAt().setExpirationTime('15m').sign(privateKey);
      return Response.json({access_token:'access-token',token_type:'Bearer',expires_in:900,refresh_token:'refresh-token',id_token:id});
    }
    throw Error('unexpected_url');
  };
  identity=await openIdentity(join(root,'auth.db'),config,{fetcher,clock:()=>instant});
  secondary=await openIdentity(join(root,'secondary.db'),config,{fetcher,clock:()=>instant});
  assert.equal(safeReturn('//evil.test'),'/');assert.equal(safeReturn('/\\evil.test'),'/');assert.equal(safeReturn('/api/email/1'),'/api/email/1');
  const reauth=await identity.route(new Request(origin+'/auth/start?reauth=1&return=%2Fcredentials'));
  const reauthURL=new URL(reauth.headers.get('location'));assert.equal(reauthURL.searchParams.get('prompt'),'login');assert.equal(reauthURL.searchParams.get('max_age'),'0');
  nonce=reauthURL.searchParams.get('nonce');claims.auth_time=Math.floor(instant/1000);
  const reauthDone=await identity.route(new Request(origin+'/auth/callback?code=code&state='+reauthURL.searchParams.get('state'),{headers:{cookie:reauth.headers.get('set-cookie').split(';')[0]}}));
  assert.equal(reauthDone.status,303);assert.equal(reauthDone.headers.get('location'),'/credentials');
  const staleReauth=await identity.route(new Request(origin+'/auth/start?reauth=1&return=%2Fcredentials'));
  const staleURL=new URL(staleReauth.headers.get('location'));nonce=staleURL.searchParams.get('nonce');claims.auth_time=Math.floor(instant/1000)-600;
  assert.equal((await identity.route(new Request(origin+'/auth/callback?code=code&state='+staleURL.searchParams.get('state'),{headers:{cookie:staleReauth.headers.get('set-cookie').split(';')[0]}}))).status,403);
  delete claims.auth_time;tokenCalls=0;
  assert.equal(ownerClaims({...claims,email_verified:false},config),false);assert.equal(ownerClaims({...claims,sub:'another-id'},config),false);
  async function start(at=origin,service=identity){
    const res=await service.route(new Request(at+'/auth/start?return=%2Fapi%2Femail%2F1'));assert.equal(res.status,303);
    const u=new URL(res.headers.get('location'));nonce=u.searchParams.get('nonce');assert.equal(u.searchParams.get('code_challenge_method'),'S256');
    return {at,flow:res.headers.get('set-cookie').split(';')[0],state:u.searchParams.get('state'),nonce:u.searchParams.get('nonce')};
  }
  async function callback(f,state=f.state,service=identity){nonce=f.nonce;return service.route(new Request(f.at+'/auth/callback?code=code&state='+state,{headers:{cookie:f.flow}}));}
  const f=await start();const bad=await callback(f,'bad-state');assert.equal(bad.status,400);assert.equal(tokenCalls,0);
  const valid=await start(),done=await callback(valid);assert.equal(done.status,303);assert.equal(done.headers.get('location'),'/api/email/1');
  const sid=done.headers.getSetCookie().find(x=>x.startsWith('__Host-eona-mail-session=')).split(';')[0];
  const request=new Request(origin+'/api/me',{headers:{cookie:sid}});assert.equal((await identity.session(request)).email,claims.email);
  const pendingFlow=await start();let releaseToken,startedToken;
  tokenGate=new Promise(resolve=>releaseToken=resolve);const arrived=new Promise(resolve=>startedToken=resolve);tokenStarted=startedToken;
  const beforeOverlap=tokenCalls,firstCallback=callback(pendingFlow);await arrived;
  const secondCallback=callback(pendingFlow);releaseToken();
  const overlap=await Promise.all([firstCallback,secondCallback]);tokenGate=tokenStarted=null;
  assert.ok(overlap.every(r=>r.status===303),'concurrent callback navigations receive the same completed login');
  assert.deepEqual(overlap[0].headers.getSetCookie(),overlap[1].headers.getSetCookie());assert.equal(tokenCalls,beforeOverlap+1);
  const resumedCallback=await callback(pendingFlow);assert.equal(resumedCallback.status,303);assert.deepEqual(resumedCallback.headers.getSetCookie(),overlap[0].headers.getSetCookie());assert.equal(tokenCalls,beforeOverlap+1,'a lost response never exchanges the code twice');
  const wrongCode=await identity.route(new Request(origin+'/auth/callback?code=other&state='+pendingFlow.state,{headers:{cookie:pendingFlow.flow}}));assert.equal(wrongCode.status,400);
  assert.equal((await identity.route(new Request(origin+'/auth/account'))).headers.get('location'),'https://account.example.invalid/if/user/');
  assert.equal((await identity.route(new Request(origin+'/auth/account?view=settings'))).headers.get('location'),'https://account.example.invalid/if/user/#/settings');
  const exchanged=tokenCalls;
  const revisited=await identity.route(new Request(origin+'/auth/callback?code=already-used&state='+valid.state,{headers:{cookie:sid}}));
  assert.equal(revisited.status,303);assert.equal(revisited.headers.get('location'),'/');assert.equal(tokenCalls,exchanged,'refreshing a completed callback must not re-exchange its code');
  const replayedWithOwner=await identity.route(new Request(origin+'/auth/callback?code=already-used&state='+valid.state,{headers:{cookie:valid.flow+'; '+sid}}));
  assert.equal(replayedWithOwner.status,303);assert.equal(tokenCalls,exchanged,'a consumed flow may recover only through an existing owner session');
  const crossHost=await identity.route(new Request(notice+'/auth/callback?code=unused&state='+valid.state,{headers:{cookie:sid}}));
  assert.equal(crossHost.status,400,'another host session cannot authorize callback recovery');
  const noFlow=await identity.route(new Request(origin+'/auth/callback?code=do-not-display&state=do-not-display',{headers:{accept:'text/html'}}));
  assert.equal(noFlow.status,400);assert.ok(noFlow.headers.get('set-cookie').includes('Max-Age=0'));
  const recovery=await noFlow.text();assert.ok(recovery.includes('href="/auth/start"'));assert.ok(!recovery.includes('do-not-display'));assert.equal(tokenCalls,exchanged);
  const beforeDelay=instant,delayed=await start();instant+=600000;
  assert.equal((await callback(delayed)).status,303,'normal MFA flow remains valid after the former five-minute deadline');
  instant=beforeDelay;
  const expiringFlow=await start();instant+=46*60000;const beforeExpiry=tokenCalls;
  const expired=await identity.route(new Request(origin+'/auth/callback?code=expired&state='+expiringFlow.state,{headers:{cookie:expiringFlow.flow,accept:'text/html'}}));
  assert.equal(expired.status,303);assert.equal(tokenCalls,beforeExpiry,'expired flows never exchange the authorization code');
  const resumedURL=new URL(expired.headers.get('location'));
  assert.notEqual(resumedURL.searchParams.get('state'),expiringFlow.state);
  const resumed={at:origin,flow:expired.headers.getSetCookie().find(c=>!c.includes('Max-Age=0')).split(';')[0],state:resumedURL.searchParams.get('state'),nonce:resumedURL.searchParams.get('nonce')};
  assert.ok(expired.headers.getSetCookie().some(c=>c.startsWith(expiringFlow.flow.split('=')[0]+'=;')&&c.includes('Max-Age=0')));
  const recovered=await callback(resumed);assert.equal(recovered.status,303);assert.equal(recovered.headers.get('location'),'/api/email/1');
  const loopStart=await start();instant+=900001;
  const loopRetry=await identity.route(new Request(origin+'/auth/callback?code=old&state='+loopStart.state,{headers:{cookie:loopStart.flow,accept:'text/html'}}));
  const loopURL=new URL(loopRetry.headers.get('location')),loopCookie=loopRetry.headers.getSetCookie().find(c=>!c.includes('Max-Age=0')).split(';')[0];
  instant+=900001;const beforeLoop=tokenCalls;
  const stopped=await identity.route(new Request(origin+'/auth/callback?code=do-not-display&state='+loopURL.searchParams.get('state'),{headers:{cookie:loopCookie,accept:'text/html'}}));
  assert.equal(stopped.status,400);const stoppedHTML=await stopped.text();assert.ok(stoppedHTML.includes('<main aria-labelledby="title">'));assert.ok(stoppedHTML.includes('return=%2Fapi%2Femail%2F1'));assert.ok(!stoppedHTML.includes('do-not-display'));assert.equal(tokenCalls,beforeLoop,'automatic restart is bounded to one attempt');
  instant=beforeDelay;
  const a=await start(),b=await start();assert.notEqual(a.flow.split('=')[0],b.flow.split('=')[0],'tabs have independent flow bindings');
  a.flow+='; '+b.flow;assert.equal((await callback(a)).status,303);assert.equal((await callback(b)).status,303);
  const protectedFlow=await start();assert.equal((await callback(protectedFlow,'bad-state')).status,400);assert.equal((await callback(protectedFlow)).status,303,'invalid state must not consume a legitimate flow');
  const expiringAPI=await start();instant+=900001;const beforeAPI=tokenCalls;
  assert.equal((await callback(expiringAPI)).status,400);assert.equal(tokenCalls,beforeAPI,'API callbacks never auto-restart');instant=beforeDelay;
  const sensitive=await identity.route(new Request(origin+'/auth/start?reauth=1&return=%2Fcredentials'));
  const sensitiveURL=new URL(sensitive.headers.get('location'));instant+=900001;
  const sensitiveExpired=await identity.route(new Request(origin+'/auth/callback?code=old&state='+sensitiveURL.searchParams.get('state'),{headers:{cookie:sensitive.headers.get('set-cookie').split(';')[0],accept:'text/html'}}));
  assert.equal(sensitiveExpired.status,400);assert.ok((await sensitiveExpired.text()).includes('reauth=1'),'sensitive operations require explicit fresh authentication');instant=beforeDelay;
  const loggedOut=await identity.route(new Request(origin+'/auth/logged-out',{headers:{accept:'text/html'}}));assert.equal(loggedOut.status,200);assert.ok((await loggedOut.text()).includes('<main aria-labelledby="title">'));
  assert.equal((await callback(valid)).status,400);assert.equal(await identity.session(new Request('https://notice.example.invalid/api/me',{headers:{cookie:sid}})),null);
  assert.equal((await identity.route(new Request(origin+'/api/logout',{method:'POST',headers:{origin:'https://evil.test',cookie:sid}}))).status,403);
  const other=await callback(await start(notice));const otherCookie=other.headers.getSetCookie().find(x=>x.startsWith('__Host-eona-notification-session=')).split(';')[0];
  const otherRequest=new Request(notice+'/api/me',{headers:{cookie:otherCookie}});assert.ok(await identity.session(otherRequest));
  const second=await callback(await start(origin,secondary),undefined,secondary);
  const secondCookie=second.headers.getSetCookie().find(x=>x.startsWith('__Host-eona-mail-session=')).split(';')[0];
  const secondRequest=new Request(origin+'/api/me',{headers:{cookie:secondCookie}});
  assert.ok(await secondary.session(secondRequest));
  const pendingSecond=await start(origin,secondary);
  const out=await identity.route(new Request(origin+'/api/logout',{method:'POST',headers:{origin,cookie:sid}}));assert.equal(out.status,200);assert.ok((await out.json()).logout_url.startsWith(issuer+'end-session/'));assert.equal(await identity.session(request),null);assert.equal(await identity.session(otherRequest),null);
  secondary.close();secondary=await openIdentity(join(root,'secondary.db'),config,{fetcher,clock:()=>instant});
  assert.equal(await secondary.session(secondRequest),null,'separate service and restart cannot keep a pre-logout session');
  const pendingResult=await callback(pendingSecond,undefined,secondary);
  assert.equal((await pendingResult.json()).error,'login_flow_revoked','in-flight login from before logout cannot create a fresh session');
  instant+=900001;
  const revokedExpired=await secondary.route(new Request(origin+'/auth/callback?code=old&state='+pendingSecond.state,{headers:{cookie:pendingSecond.flow,accept:'text/html'}}));
  assert.equal(revokedExpired.status,400);assert.ok((await revokedExpired.text()).includes('登录已取消'),'logout also blocks automatic recovery of an expired flow');instant=beforeDelay;
  const again=await callback(await start());const againCookie=again.headers.getSetCookie().find(x=>x.startsWith('__Host-eona-mail-session=')).split(';')[0];allowed=false;instant+=901000;assert.equal(await identity.session(new Request(origin+'/api/me',{headers:{cookie:againCookie}})),null);allowed=true;
  const fresh=await callback(await start()),freshCookie=fresh.headers.getSetCookie().find(x=>x.startsWith('__Host-eona-mail-session=')).split(';')[0];
  const freshRequest=new Request(origin+'/api/me',{headers:{cookie:freshCookie}});assert.ok(await identity.session(freshRequest));
  async function logoutToken(extra={}){return new SignJWT({sub:claims.sub,events:{'http://schemas.openid.net/event/backchannel-logout':{}},...extra})
    .setProtectedHeader({alg:'RS256',kid:'key1'}).setIssuer(issuer).setAudience('mail-client')
    .setIssuedAt(extra.iat??Math.floor(instant/1000)).setJti('one-logout').sign(privateKey)}
  const back=(raw,service=identity)=>service.route(new Request(origin+'/auth/backchannel',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({logout_token:raw})}));
  assert.equal((await back(await logoutToken({sub:'another-owner'}))).status,400);assert.ok(await identity.session(freshRequest));
  assert.equal((await back(await logoutToken({nonce:'not-a-logout'}))).status,400);
  assert.equal((await back(await logoutToken({iat:Math.floor(instant/1000)-500}))).status,400);
  const signed=await logoutToken();assert.equal((await back(signed)).status,200);assert.equal(await identity.session(freshRequest),null);
  const newer=await callback(await start());const newerCookie=newer.headers.getSetCookie().find(x=>x.startsWith('__Host-eona-mail-session=')).split(';')[0];
  assert.equal((await(await back(signed)).json()).replayed,true);
  assert.equal((await(await back(signed,secondary)).json()).replayed,true,'common replay store prevents a duplicate received by another service from revoking a new login');
  assert.ok(await identity.session(new Request(origin+'/api/me',{headers:{cookie:newerCookie}})));
  // Real Node HTTP transport: route-only tests preserve Fetch headers and
  // missed the production listener collapsing two Set-Cookie fields.
  const wire=createServer(async(req,res)=>{
    try{
      const request=new Request(origin+req.url,{headers:req.headers});
      let response;
      if(req.url.startsWith('/auth/'))response=await identity.route(request);
      else if(req.url==='/cookie-expiry'){
        response=new Response('ok');
        response.headers.append('set-cookie','a=one; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT');
        response.headers.append('set-cookie','b=two; Path=/; Max-Age=300');
      }else response=await identity.session(request)?Response.json({authenticated:true}):new Response(null,{status:303,headers:{location:'/auth/start'}});
      await writeResponse(response,res);
    }catch{res.writeHead(500);res.end();}
  });
  await new Promise(resolve=>wire.listen(0,'127.0.0.1',resolve));
  async function wireGet(path,cookie='',accept=''){
    return new Promise((resolve,reject)=>{
      const req=httpRequest({host:'127.0.0.1',port:wire.address().port,path,headers:{host:new URL(origin).host,cookie,accept}},res=>{
        const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,rawHeaders:res.rawHeaders,body:Buffer.concat(chunks).toString()}));
      });req.on('error',reject);req.end();
    });
  }
  try{
    const began=await wireGet('/auth/start?return=%2F');
    const authorization=new URL(began.headers.location);nonce=authorization.searchParams.get('nonce');
    const flowCookie=began.headers['set-cookie'][0].split(';')[0];
    const returned=await wireGet('/auth/callback?code=code&state='+authorization.searchParams.get('state'),flowCookie);
    assert.equal(returned.status,303);
    assert.equal(returned.headers['set-cookie'].length,2,'session and flow deletion must be separate HTTP Set-Cookie fields');
    assert.equal(returned.rawHeaders.filter((x,i)=>i%2===0&&x.toLowerCase()==='set-cookie').length,2);
    const jar=new Map([[flowCookie.split('=')[0],flowCookie.split('=')[1]]]);
    for(const value of returned.headers['set-cookie']){
      const [pair,...attributes]=value.split(';').map(x=>x.trim()),[name,content]=pair.split('=');
      if(attributes.some(x=>/^Max-Age=0$/i.test(x)))jar.delete(name);else jar.set(name,content);
    }
    assert.equal(jar.has(flowCookie.split('=')[0]),false);
    assert.equal(jar.has('__Host-eona-mail-session'),true);
    const saved=[...jar].map(([k,v])=>k+'='+v).join('; ');
    const page=await wireGet(returned.headers.location,saved);
    assert.equal(page.status,200,'callback must land authenticated instead of restarting authorization');
    assert.equal(JSON.parse(page.body).authenticated,true);
    assert.equal((await wireGet('/',saved)).status,200,'refresh retains the authenticated session');
    assert.equal((await wireGet('/')).status,303,'anonymous visitor remains protected');
    const delayedStart=await wireGet('/auth/start?return=%2Fapi%2Femail%2F1'),delayedURL=new URL(delayedStart.headers.location),delayedCookie=delayedStart.headers['set-cookie'][0].split(';')[0];
    const beforeWireDelay=instant;instant+=46*60000;
    const retry=await wireGet('/auth/callback?code=expired&state='+delayedURL.searchParams.get('state'),delayedCookie,'text/html');
    assert.equal(retry.status,303);assert.equal(retry.headers['set-cookie'].length,2,'HTTP recovery sets the fresh flow and deletes only the expired flow');
    const retryURL=new URL(retry.headers.location),retryCookie=retry.headers['set-cookie'].find(c=>!c.includes('Max-Age=0')).split(';')[0];nonce=retryURL.searchParams.get('nonce');
    const retryDone=await wireGet('/auth/callback?code=fresh&state='+retryURL.searchParams.get('state'),retryCookie,'text/html');
    assert.equal(retryDone.status,303);assert.equal(retryDone.headers.location,'/api/email/1');assert.equal(retryDone.headers['set-cookie'].length,2);instant=beforeWireDelay;
    const expiring=await wireGet('/cookie-expiry');assert.equal(expiring.headers['set-cookie'].length,2);
    assert.ok(expiring.headers['set-cookie'][0].includes('Expires=Wed, 21 Oct 2037'));
  }finally{await new Promise(resolve=>wire.close(resolve));}
  const broken=signed.split('.');broken[2]=broken[2].slice(0,-8)+'AAAAAAAA';assert.equal((await back(broken.join('.'))).status,400);
  wrongNonce=true;assert.equal((await callback(await start())).status,400);wrongNonce=false;wrongAudience=true;assert.equal((await callback(await start())).status,400);
  const unavailableProvider=await openIdentity(join(root,'provider-down.db'),config,{fetcher:async()=>new Response(null,{status:503}),clock:()=>instant});
  try{
    const denied=await unavailableProvider.route(new Request(origin+'/auth/start',{headers:{accept:'text/html'}}));assert.equal(denied.status,503);assert.ok((await denied.text()).includes('账号服务暂时无法连接'));
    assert.equal((await(await unavailableProvider.route(new Request(origin+'/auth/start'))).json()).error,'identity_unavailable');
  }finally{unavailableProvider.close();}
  const unavailable=new DatabaseSync(config.revocation_db);unavailable.exec('DROP TABLE auth_user_revocations');unavailable.close();
  await assert.rejects(identity.session(new Request(origin+'/api/me',{headers:{cookie:newerCookie}})),/auth_user_revocations/,'missing shared logout state fails closed');
  console.log('identity: expired flow restarts once without code exchange, return target, concurrent tabs, forged-state isolation, sensitive reauth/API stop, status cards, shared durable logout generation, cross-store replay, PKCE/state/nonce/signature/audience, pinned owner, host sessions, signed backchannel and actual HTTP callback cookies passed');
}finally{secondary?.close();identity?.close();await rm(root,{recursive:true,force:true});}
