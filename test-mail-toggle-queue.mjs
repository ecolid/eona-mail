import test from 'node:test';import assert from 'node:assert/strict';import {createMailToggleQueue} from './src/mail-toggle-queue.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
test('rapid clicks paint immediately and coalesce writes to the last intent',async()=>{const sent=[],paint=[],gate=deferred();const q=createMailToggleQueue(async(key,value)=>{sent.push(value);if(sent.length===1)await gate.promise},{apply:(key,value)=>paint.push(value)});const pending=q.set('x',true,false);await Promise.resolve();q.set('x',false);q.set('x',true);q.set('x',false);assert.equal(paint.at(-1),false);assert.deepEqual(sent,[true]);gate.resolve();await pending;assert.deepEqual(sent,[true,false]);assert.equal(q.pending('x'),undefined);assert.equal(paint.at(-1),false)});
test('same-frame paired clicks need no write; failure rolls back the last confirmed state',async()=>{const sent=[],paint=[],errors=[];const q=createMailToggleQueue(async(k,v)=>{sent.push(v);throw Error('offline')},{apply:(k,v)=>paint.push(v),failed:e=>errors.push(e.message)});q.set('x',true,false);await q.set('x',false);assert.deepEqual(sent,[]);await q.set('x',true,false);assert.deepEqual(sent,[true]);assert.equal(paint.at(-1),false);assert.deepEqual(errors,['offline'])});
test('identity change prevents a late write from changing the new session',async()=>{const gate=deferred(),paint=[];const q=createMailToggleQueue(()=>gate.promise,{apply:(k,v)=>paint.push(v)});const old=q.set('x',true,false);await Promise.resolve();q.clear();const before=paint.length;gate.resolve();await old;assert.equal(paint.length,before)});

test('only the settled final intent receives success feedback; failure and old owners do not',async()=>{
 const gate=deferred(),success=[],failed=[];
 const q=createMailToggleQueue(async()=>gate.promise,{apply(){},settled:(key,value)=>success.push([key,value]),failed:error=>failed.push(error.message)});
 const first=q.set('mail',true,false);await Promise.resolve();q.set('mail',false);gate.resolve();await first;
 assert.deepEqual(success,[['mail',false]]);
 const errorQueue=createMailToggleQueue(async()=>{throw Error('offline')},{apply(){},settled:()=>success.push('wrong'),failed:error=>failed.push(error.message)});
 await errorQueue.set('mail',true,false);assert.deepEqual(failed,['offline']);assert.equal(success.length,1);
 const old=deferred(),other=createMailToggleQueue(()=>old.promise,{apply(){},settled:()=>success.push('old owner')});const pending=other.set('mail',true);await Promise.resolve();other.clear();old.resolve();await pending;assert.equal(success.length,1);
});

test('batch intents preserve quiet outcome metadata and explicit failure for aggregate feedback',async()=>{
 const outcomes=[];const q=createMailToggleQueue(async(key,value,options)=>{assert.equal(options.quiet,true);if(key==='bad')throw Error('offline')},{apply(){},settled:(key,value,change)=>outcomes.push({key,value,...change}),failed:(error,key,change)=>outcomes.push({key,error:error.message,...change})});
 assert.equal(await q.set('ok',true,false,{quiet:true,undoable:false}),true);assert.equal(await q.set('bad',true,false,{quiet:true,undoable:false}),false);assert.equal(outcomes.length,2);assert(outcomes.every(o=>o.quiet));assert.equal(outcomes[0].undoable,false);assert.equal(outcomes[1].error,'offline');
});
