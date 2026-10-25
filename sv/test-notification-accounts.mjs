import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {openIdentity} from './identity.mjs';
test('notification accounts use verified subjects, private apps stay owner-only, logout revokes only its subject and old flows',async()=>{
 const root=await mkdtemp(join(tmpdir(),'notification-accounts-')),issuer='https://id.example.test/application/o/notify/',publicOrigin='https://message.example.test',privateOrigin='https://mail.example.test';
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk={...await exportJWK(publicKey),kid:'k',alg:'RS256'};
 let subject='A',nonce;const emails={A:'a@example.test',B:'b@example.test'};
 const policy={issuer,client_id:'client',client_secret:'secret'};
 const config={local_url:'http://127.0.0.1:9999',owner_subject:'owner',owner_email:'owner@example.test',revocation_db:join(root,'revocations.db'),origins:{[publicOrigin]:{...policy,app:'notification',account_scope:'notifications'},[privateOrigin]:{...policy,app:'mail'}}};
 const fetcher=async(url,init)=>{
  const p=new URL(url).pathname;
  if(p.endsWith('openid-configuration'))return Response.json({issuer,authorization_endpoint:'https://id.example.test/authorize',token_endpoint:'https://id.example.test/token',jwks_uri:issuer+'jwks',userinfo_endpoint:'https://id.example.test/userinfo',response_types_supported:['code'],id_token_signing_alg_values_supported:['RS256']});
  if(p.endsWith('jwks'))return Response.json({keys:[jwk]});
  if(p.endsWith('/token'))return Response.json({access_token:'test-access',token_type:'Bearer',expires_in:900,id_token:await new SignJWT({sub:subject,email:emails[subject],email_verified:true,nonce}).setProtectedHeader({alg:'RS256',kid:'k'}).setIssuer(issuer).setAudience('client').setIssuedAt().setExpirationTime('15m').sign(privateKey)});
  throw Error('unexpected provider path');
 };
 let identity;
 try{
  identity=await openIdentity(join(root,'identity.db'),config,{fetcher});
  async function start(origin=publicOrigin){const response=await identity.route(new Request(origin+'/auth/start'));const url=new URL(response.headers.get('location'));return {origin,state:url.searchParams.get('state'),nonce:url.searchParams.get('nonce'),cookie:response.headers.get('set-cookie').split(';')[0]}}
  async function finish(flow){nonce=flow.nonce;return identity.route(new Request(flow.origin+'/auth/callback?code=test&state='+flow.state,{headers:{cookie:flow.cookie}}))}
  async function login(user){subject=user;const response=await finish(await start());assert.equal(response.status,303);return response.headers.getSetCookie().find(c=>c.startsWith('__Host-eona-notification-session')).split(';')[0]}
  const a=await login('A'),b=await login('B'),read=cookie=>identity.session(new Request(publicOrigin+'/api/me',{headers:{cookie}}));
  assert.equal((await read(a)).subject,'A');assert.equal((await read(b)).subject,'B');
  subject='B';assert.equal((await finish(await start(privateOrigin))).status,403);
  subject='A';const stale=await start();await identity.route(new Request(publicOrigin+'/api/logout',{method:'POST',headers:{origin:publicOrigin,cookie:a}}));assert.equal(await read(a),null);assert.equal((await read(b)).subject,'B');
  assert.equal((await finish(stale)).status,400);const anew=await login('A');assert.equal((await read(anew)).subject,'A');
 }finally{identity?.close();await rm(root,{recursive:true,force:true})}
});
