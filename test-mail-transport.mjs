import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMailResourceCache,mailMutationPrefixes} from './src/mail-resource-cache.js';
import {testHooks} from './src/index.js';

const page=testHooks().PAGE;
const source=page.slice(page.indexOf('const api=async(p,'),page.indexOf('\nconst I='));
function fixture(fetch,signalFactory=()=>({aborted:false})){
 const calls=[],signals=[],login=[];
 const context={window:{},mailMutationPrefixes,state:{},mailResources:{read:(p,o)=>context.fetchMailResource(p,o).then(r=>r.value),invalidate(){},clear(){}},Headers,fetch:async(...args)=>{calls.push(args);const response=await fetch(...args);return {...response,headers:response.headers||new Headers()}},AbortSignal:{timeout:ms=>{assert.equal(ms,15000);const signal=signalFactory();signals.push(signal);return signal}},EonaUI:{startLogin:()=>login.push('redirect')},show:ok=>login.push(ok)};
 vm.createContext(context);vm.runInContext(source+'\n;globalThis.request=api;',context);
 return {request:context.request,calls,signals,login};
}
const ok=value=>({ok:true,status:200,headers:new Headers(),json:async()=>value});
const aborted=()=>Object.assign(Error('Fetch is aborted'),{name:'AbortError'});

test('an interrupted response body retries the same read with a new timeout and returns its content',async()=>{
 let n=0;const f=fixture(async()=>++n===1?{ok:true,status:200,json:async()=>{throw aborted()}}:ok({email:{id:42}}));
 assert.deepEqual(await f.request('/api/email/42'),{email:{id:42}});
 assert.equal(f.calls.length,2);assert.equal(f.calls[0][0],f.calls[1][0]);assert.notEqual(f.signals[0],f.signals[1]);
});
test('a persistent transport failure stops after two attempts with readable feedback',async()=>{
 const f=fixture(async()=>{throw aborted()});
 await assert.rejects(f.request('/api/emails'),/读取已中断，请重试/);assert.equal(f.calls.length,2);
});
test('the owned deadline determines a timeout even when Safari reports a generic AbortError',async()=>{
 const f=fixture(async()=>{throw aborted()},()=>({aborted:true}));
 await assert.rejects(f.request('/api/emails'),/读取超时，请重试/);assert.equal(f.calls.length,2);
});
test('mutations and caller-cancelled requests are never replayed',async()=>{
 for(const options of [{method:'POST',body:'{}'},{method:'PUT',body:'{}'},{signal:{aborted:true}}]){
  const f=fixture(async()=>{throw aborted()});await assert.rejects(f.request('/api/email/42/star',options),options.signal?/Fetch is aborted/:/操作结果未确认/);assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].body,options.body);
 }
});
test('authentication and server errors do not cause another request',async()=>{
 for(const status of [401,429,503]){
  const f=fixture(async()=>({status,ok:false,json:async()=>({login_url:'/auth/start'})}));await assert.rejects(f.request('/api/emails'));assert.equal(f.calls.length,1);if(status===401)assert.deepEqual(f.login,['redirect']);
 }
});
test('invalid JSON is reported without an automatic retry; translation keeps its unbounded original request',async()=>{
 const f=fixture(async()=>({ok:true,status:200,json:async()=>{throw Object.assign(Error('Unexpected <'),{name:'SyntaxError'})}}));await assert.rejects(f.request('/api/emails'),/返回内容无法读取/);assert.equal(f.calls.length,1);
 const translation=fixture(async()=>ok({translated:true}));await translation.request('/api/email/42/translate',{method:'POST'});assert.equal(translation.signals.length,0);assert.equal(translation.calls[0][1].signal,undefined);
});
