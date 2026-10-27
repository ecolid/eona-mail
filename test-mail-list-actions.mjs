import test from 'node:test';
import assert from 'node:assert/strict';
import {mailRangeSelection,mailTwoFingerIntent,mailListActionsBrowserScript,mailActionBackdrop} from './src/mail-list-actions.js';
const points=(x,y,gap=48)=>[{clientX:x-gap/2,clientY:y},{clientX:x+gap/2,clientY:y}];
test('two parallel fingers select only after a deliberate vertical drag; pinch and sideways remain native',()=>{
 const start=points(150,100);
 assert.equal(mailTwoFingerIntent(start,points(153,105)),'');
 assert.equal(mailTwoFingerIntent(start,points(153,145)),'select');
 assert.equal(mailTwoFingerIntent(start,points(150,65),true),'select');
 assert.equal(mailTwoFingerIntent(start,points(150,65)),'select');
 assert.equal(mailTwoFingerIntent(start,points(150,100,100),true),'hold');
 assert.equal(mailTwoFingerIntent(start,points(150,65,100),true),'select','a committed vertically translated range tolerates unequal horizontal spacing');
 for(const end of [points(150,145,100),points(200,115),points(150,120).slice(0,1)])assert.equal(mailTwoFingerIntent(start,end),'cancel');
});
test('range reversal contracts new selection while preserving the selection before the gesture',()=>{
 const ids=['a','b','c','d','e'],base=new Set(['e']);
 assert.deepEqual([...mailRangeSelection(ids,base,'a','d')],['e','a','b','c','d']);
 assert.deepEqual([...mailRangeSelection(ids,base,'a','b')],['e','a','b']);
 assert.deepEqual([...base],['e']);
 assert.deepEqual([...mailRangeSelection(ids,base,'c','a')],['e','a','b','c']);
 assert.deepEqual([...mailRangeSelection(ids,base,'missing','a')],['e']);
});
test('selection cannot silently include items outside the authoritative rendered order',()=>{
 assert.deepEqual([...mailRangeSelection(['a','b'],[], 'a','b')],['a','b']);
 assert.deepEqual([...mailRangeSelection(['a','b'],['a','c'],'a','b',false)],['c']);
});
test('the delivered list controller script is valid JavaScript before embedding in Mail',()=>{
 assert.doesNotThrow(()=>new Function(mailListActionsBrowserScript()));
});

import vm from 'node:vm';
import {mailRemoveRows,mailAnimateListCommit} from './src/mail-list-actions.js';
test('row removal waits for the actual exit, removes only confirmed IDs and handles cancellation',async()=>{
 const made=[],removed=[],rows=['a','b','c'].map(id=>{const wrap={style:{},remove:()=>removed.push(id),getBoundingClientRect:()=>({height:112}),animate:frames=>{const motion={frames};made.push(motion);return motion}};return {dataset:{mailId:id},closest:()=>wrap}});
 const ctx={document:{querySelectorAll:()=>rows},matchMedia:()=>({matches:false})};vm.createContext(ctx);vm.runInContext(mailRemoveRows.toString(),ctx);
 const pending=ctx.mailRemoveRows(['a','c']);assert.deepEqual(removed,[]);assert.equal(made.length,2);assert.equal(made[0].frames[1].height,'0px');made[0].onfinish();made[1].oncancel();await pending;assert.deepEqual(removed,['a','c']);
 ctx.matchMedia=()=>({matches:true});await ctx.mailRemoveRows(['b']);assert.deepEqual(removed,['a','c','b']);assert.equal(made.length,2);
});


test('restoration moves survivors from their prior positions and reveals only new rows before completing',async()=>{
 const motions=[];let committed=false,events=0;
 const row=(id,top)=>({dataset:{mailId:id},closest(){return this},getBoundingClientRect:()=>({top,bottom:top+100}),animate(frames,options){let finish;const finished=new Promise(resolve=>finish=resolve),motion={frames,options,finished,finish,cancel:()=>finish()};motions.push(motion);return motion}});
 const survivor=row('kept',100),restored=row('returned',100),moved=row('kept',200),offscreen=row('far',2000);let rows=[survivor];
 const host={scrollTop:30,querySelectorAll:()=>rows};
 const ctx={document:{documentElement:{clientHeight:740},dispatchEvent:()=>events++},Event:class{},matchMedia:()=>({matches:false})};vm.createContext(ctx);vm.runInContext(mailAnimateListCommit.toString(),ctx);
 let completed=false;const pending=ctx.mailAnimateListCommit(host,()=>{committed=true;rows=[restored,moved,offscreen]}).then(()=>completed=true);
 assert(committed);assert.equal(events,1);assert.equal(host.scrollTop,30);assert.equal(motions.length,2);assert.equal(motions[0].frames[0].opacity,0);assert.equal(motions[1].frames[0].transform,'translateY(-100px)');assert.equal(completed,false);
 for(const motion of motions)motion.finish();await pending;assert.equal(completed,true);
 // A newer visible commit cancels the preceding trajectory instead of stacking it.
 rows=[survivor];const earlier=ctx.mailAnimateListCommit(host,()=>{rows=[moved]});assert.equal(motions.length,3);await ctx.mailAnimateListCommit(host,()=>{});await earlier;
 ctx.matchMedia=()=>({matches:true});await ctx.mailAnimateListCommit(host,()=>{rows=[restored,moved]});assert.equal(motions.length,3,'reduced motion commits the same state without spatial animation');
});

test('action drawer backdrop closes only outside its bounds and preserves inside controls',()=>{
 const dialog={getBoundingClientRect:()=>({left:16,right:374,top:130,bottom:724})};let closed=0;const close=()=>closed++;
 assert.equal(mailActionBackdrop({target:dialog,clientX:3,clientY:60},dialog,close),true);assert.equal(closed,1);
 assert.equal(mailActionBackdrop({target:dialog,clientX:20,clientY:150},dialog,close),false);
 assert.equal(mailActionBackdrop({target:{},clientX:3,clientY:60},dialog,close),false);assert.equal(closed,1);
});


import {bindMailRowPointerInput} from './src/mail-list-actions.js';
test('pointer axis input shares row state, native cancellation releases it, and pairs remain touch-owned',()=>{
 const handlers={},moves=[];let g=null,cancels=0;const input=bindMailRowPointerInput({list:{addEventListener:(type,fn)=>handlers[type]=fn},window:{PointerEvent:class{}},readGesture:()=>g,move:e=>moves.push(e),cancel:()=>{cancels++;g=null}});
 handlers.pointerdown({pointerType:'touch',pointerId:4});assert.equal(input.primary(),4);g={pointer:4};handlers.pointermove({pointerId:4,clientX:10,clientY:5,cancelable:true,preventDefault(){}});assert.equal(moves.length,1);assert.equal(moves[0].mailPointer,true);
 handlers.pointercancel({type:'pointercancel',pointerId:4});assert.equal(cancels,1);assert.equal(g,null);assert.equal(input.primary(),undefined);
 handlers.pointerdown({pointerType:'touch',pointerId:5});handlers.pointerdown({pointerType:'touch',pointerId:6});g={two:true};handlers.pointermove({pointerId:5});assert.equal(moves.length,1);assert.equal(input.primary(),undefined);input.reset();handlers.pointerdown({pointerType:'touch',pointerId:7});assert.equal(input.primary(),7,'a removed surface cannot leave stale pointer contacts');input.dispose();
});

test('row paint coalesces input bursts, flushes release and rejects cancelled callbacks',async()=>{
 const {createMailRowPainter}=await import('./src/mail-list-actions.js');const callbacks=new Map(),all=[],writes=[];let id=0;
 const win={requestAnimationFrame(fn){all.push(fn);callbacks.set(++id,fn);return id},cancelAnimationFrame(id){callbacks.delete(id)}};
 const paint=createMailRowPainter((wrap,x)=>writes.push([wrap,x]),win);
 for(let x=0;x<12;x++)paint.queue('row-a',x);assert.equal(callbacks.size,1);[...callbacks.values()][0]();assert.deepEqual(writes,[['row-a',11]]);
 paint.queue('row-a',30);paint.flush();assert.deepEqual(writes.at(-1),['row-a',30]);paint.queue('row-a',50);paint.cancel();all.forEach(fn=>fn());assert.equal(writes.length,2);
 paint.queue('row-b',-40);[...callbacks.values()].forEach(fn=>fn());assert.deepEqual(writes.at(-1),['row-b',-40]);
});


import {bindMailListSurface} from './src/mail-list-actions.js';
test('reader surface changes reset input without rebuilding a prepared list; scope and selection keep their owners',()=>{
 const handlers=new Map(),calls=[],doc={addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:(name,fn)=>{if(handlers.get(name)===fn)handlers.delete(name)}};let scope='inbox:owner-a',prepared=scope,reading=false,selected=false,missingHeader=false;
 const binding=bindMailListSurface({document:doc,readScope:()=>scope,preparedScope:()=>prepared,needsPreparation:()=>missingHeader,reading:()=>reading,hasSelection:()=>selected,reset:()=>calls.push('reset'),exitSelection:()=>{calls.push('exit');selected=false},enhance:()=>{calls.push('enhance');prepared=scope;missingHeader=false}});
 const change=()=>handlers.get('mail:surface')();for(let i=0;i<20;i++){reading=true;change();reading=false;change()}assert.equal(calls.filter(c=>c==='enhance').length,0);assert.equal(calls.filter(c=>c==='exit').length,0);assert.equal(calls.filter(c=>c==='reset').length,40);
 selected=true;reading=true;change();assert.equal(calls.at(-1),'exit');change();assert.equal(calls.at(-1),'reset');scope='inbox:owner-b';change();assert.equal(calls.at(-1),'enhance');reading=false;change();assert.equal(calls.at(-1),'reset');scope='sent:owner-b';change();assert.equal(calls.at(-1),'enhance');missingHeader=true;change();assert.equal(calls.at(-1),'enhance');change();assert.equal(calls.at(-1),'reset');binding.dispose();assert.equal(handlers.size,0);
});
