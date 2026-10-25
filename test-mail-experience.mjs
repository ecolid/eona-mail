import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {normalizeMailExperience,orderMailNavigation,moveMailNavigation,mailPanelSizes} from './src/mail-experience-model.js';
import {testHooks} from './src/index.js';
test('corrupt browser preferences cannot hide or invent authoritative resources',()=>{for(const input of [null,[],{side:-10,list:100000,orders:{mailboxes:['removed','b','b',22],unexpected:['a']}}]){const pref=normalizeMailExperience(input);assert(pref.side>=184&&pref.side<=360);assert(pref.list>=260&&pref.list<=640);const rows=orderMailNavigation([{key:'a'},{key:'b'},{key:'new'}],pref.orders.mailboxes);assert.equal(rows.length,3);assert.deepEqual(new Set(rows.map(r=>r.key)),new Set(['a','b','new']));assert(!('unexpected' in pref.orders));}});
test('saved order survives discovery, removal and keyboard boundary operations',()=>{assert.deepEqual(orderMailNavigation([{key:'new'},{key:'a'},{key:'b'}],['b','gone','a']).map(r=>r.key),['b','a','new']);const keys=['inbox','sent','drafts'];assert.deepEqual(moveMailNavigation(keys,'sent',-1),['sent','inbox','drafts']);assert.deepEqual(moveMailNavigation(keys,'inbox',-1),keys);assert.deepEqual(moveMailNavigation(keys,'unknown',1),keys);assert.deepEqual(keys,['inbox','sent','drafts']);});
test('split layout preserves a readable detail pane and restored widths never drift',()=>{for(const width of [861,1024,1440])for(const columns of [2,3]){const sizes=mailPanelSizes(width,360,640,columns);assert(Math.abs(sizes.reduce((a,b)=>a+b,0)-100)<.00001);assert(sizes.every(n=>n>0));assert(sizes[0]*width/100-2>=184);assert(sizes.at(-1)*width/100-2>=320-.01);}let side=216,list=360;for(let i=0;i<100;i++){const sizes=mailPanelSizes(1280,side,list);side=sizes[0]*1280/100-2;list=sizes[1]*1280/100-4;}assert(Math.abs(side-216)<.001);assert(Math.abs(list-360)<.001);});
test('every actual inline browser script remains parseable after serialization',()=>{const scripts=[...testHooks().PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,4);for(const script of scripts)new vm.Script(script[1]);});

import {openMailDialog} from './src/mail-experience-view.js';
function dialogFixture(immediate=false){
 const calls=[],events={},dialog={addEventListener:(type,fn,options)=>events[type]={fn,options},remove:()=>calls.push('remove')};
 const trigger={isConnected:true,focus:options=>calls.push(['focus',options.preventScroll])},input={focus:()=>calls.push('input')};
 const ctx={document:{activeElement:trigger},EonaUI:{openDialog:()=>calls.push('open'),closeDialog:()=>{calls.push('closing');if(immediate)events.close.fn()}}};
 vm.createContext(ctx);vm.runInContext('var openMailDialog='+openMailDialog.toString(),ctx);
 const lifecycle=ctx.openMailDialog(dialog,{dispose:()=>calls.push('dispose'),initialFocus:input});return{calls,events,dialog,trigger,lifecycle};
}
test('mail dialog keeps its content until shared exit completes, ignores repeated close and then returns focus once',()=>{
 const s=dialogFixture();assert.deepEqual(s.calls,['open','input']);s.lifecycle.close();s.lifecycle.close();assert.equal(s.lifecycle.closing,true);assert.deepEqual(s.calls,['open','input','closing']);
 s.events.close.fn();assert.deepEqual(s.calls,['open','input','closing','dispose','remove',['focus',true]]);assert.equal(s.events.close.options.once,true);
});
test('Escape uses shared close, reduced motion cleans synchronously and a removed trigger is never focused',()=>{
 const s=dialogFixture(true);s.trigger.isConnected=false;let prevented=false;s.events.cancel.fn({preventDefault:()=>prevented=true});assert.equal(prevented,true);assert.deepEqual(s.calls,['open','input','closing','dispose','remove']);
});


import {mailScrollTrack} from './src/mail-scrollbars-view.js';
test('the list track starts below its sticky heading without changing the scroll owner',()=>{
 const box={top:56,bottom:740};assert.deepEqual(mailScrollTrack(box,{bottom:112}),{top:112,height:628});
 assert.deepEqual(mailScrollTrack(box),{top:56,height:684});
 assert.deepEqual(mailScrollTrack(box,{bottom:900}),{top:740,height:0});
 assert.deepEqual(mailScrollTrack(box,{bottom:0}),{top:56,height:684});
});
