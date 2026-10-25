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
