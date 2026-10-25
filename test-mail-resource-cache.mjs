import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailResourceCache} from './src/mail-resource-cache.js';
function fixture(){let at=1;const requests=[],changed=[],failures=[];const cache=createMailResourceCache((path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject})),{now:()=>at,changed:(...args)=>changed.push(args),failed:(...args)=>failures.push(args)});return {cache,requests,changed,failures,advance:()=>{at+=60001}}}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('warm navigation reads locally; expired reads keep content, coalesce validation and accept 304',async()=>{
 const f=fixture(),path='/api/emails?folder=inbox';const a=f.cache.read(path),b=f.cache.read(path);await turn();assert.equal(f.requests.length,1);f.requests[0].resolve({value:{emails:[{id:1}]},etag:'one'});assert.deepEqual(await a,await b);
 const copy=await f.cache.read(path);copy.emails[0].id=99;assert.equal((await f.cache.read(path)).emails[0].id,1);assert.equal(f.requests.length,1);
 f.advance();assert.equal((await f.cache.read(path)).emails[0].id,1);await f.cache.read(path);await turn();assert.equal(f.requests.length,2);assert.equal(f.requests[1].options.etag,'one');f.requests[1].resolve({unchanged:true,etag:'one'});await turn();assert.equal(f.changed.length,0);
});
test('failed background validation retains content and records failure; explicit refresh waits for actual recovery',async()=>{
 const f=fixture(),path='/api/routes';const first=f.cache.read(path);await turn();f.requests[0].resolve({value:{routes:[1]}});await first;f.advance();await f.cache.read(path);await turn();f.requests[1].reject(Error('offline'));await turn();assert.equal(f.failures.length,1);assert.deepEqual(f.cache.peek(path),{routes:[1]});
 const recovery=f.cache.read(path,{fresh:true});await turn();f.requests[2].resolve({value:{routes:[1,2]}});assert.deepEqual(await recovery,{routes:[1,2]});assert.equal(f.changed.length,1);
});
test('writes and identity changes invalidate late read results; send receipts never come from a cache',async()=>{
 const f=fixture(),path='/api/emails?folder=inbox';const old=f.cache.read(path);await turn();f.cache.invalidate();const newer=f.cache.read(path,{fresh:true});await turn();f.requests[1].resolve({value:{emails:[2]}});await newer;f.requests[0].resolve({value:{emails:[1]}});await assert.rejects(old,/资料版本已变化/);assert.deepEqual(f.cache.peek(path),{emails:[2]});
 const last=f.cache.read('/api/routes');await turn();f.cache.clear();f.requests[2].resolve({value:{routes:['old-owner']}});await assert.rejects(last,/资料版本已变化/);assert.equal(f.cache.peek('/api/routes'),undefined);
 const receipt=f.cache.read('/api/mail-workspace/send/attempt');await turn();f.requests[3].resolve({value:{message:{state:'sending'}}});await receipt;const again=f.cache.read('/api/mail-workspace/send/attempt');await turn();assert.equal(f.requests.length,5);f.requests[4].resolve({value:{message:{state:'sent'}}});assert.equal((await again).message.state,'sent');
});

import {mailMutationPrefixes} from './src/mail-resource-cache.js';
test('typing and lease heartbeats do not expire inbox pages, while message actions invalidate counts and details',()=>{
 assert.deepEqual(mailMutationPrefixes('/api/mail-workspace/drafts/one/editing'),[]);assert.deepEqual(mailMutationPrefixes('/api/mail-workspace/drafts/one'),['/api/mail-workspace']);
 const scopes=mailMutationPrefixes('/api/email/42/star');assert(scopes.includes('/api/emails'));assert(scopes.includes('/api/email/42'));assert(scopes.includes('/api/routes'));
});

test('correspondence revisits reuse the same identity; incoming mail invalidation refreshes it without a blank wait',async()=>{
 const f=fixture(),path='/api/mail-workspace/correspondence?address=friend%40example.test';const first=f.cache.read(path);await turn();f.requests[0].resolve({value:{messages:[{id:1}],total:1,next:null}});await first;
 assert.equal((await f.cache.read(path)).total,1);assert.equal(f.requests.length,1);
 f.cache.invalidate('/api/mail-workspace');await f.cache.read(path);assert.equal(f.requests.length,1);
 f.cache.invalidate('/api/mail-workspace/correspondence');assert.equal((await f.cache.read(path)).total,1);await turn();assert.equal(f.requests.length,2);f.requests[1].resolve({value:{messages:[{id:2},{id:1}],total:2,next:null}});await turn();assert.equal(f.cache.peek(path).total,2);assert.equal(f.changed[0][0],path);
});

test('a mutated detail cannot expose its old folder or attachments while the authoritative reload is pending',async()=>{
 const f=fixture(),path='/api/email/42';const first=f.cache.read(path);await turn();
 f.requests[0].resolve({value:{email:{id:42,folder:'inbox',attachment_keys:'["old"]'}}});await first;
 f.cache.invalidate(path,{discard:true});assert.equal(f.cache.peek(path),undefined);
 let settled=false;const updated=f.cache.read(path).then(v=>{settled=true;return v});await turn();
 assert.equal(settled,false);assert.equal(f.requests.length,2);
 f.requests[1].resolve({value:{email:{id:42,folder:'trash',attachment_keys:'[]'}}});
 assert.deepEqual((await updated).email,{id:42,folder:'trash',attachment_keys:'[]'});
});
