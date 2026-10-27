import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMailOverlayScrollbars} from './src/mail-scrollbars-view.js';
test('phone input has no custom scrollbar portal or capturing scroll owner; desktop can activate and cleanly leave',()=>{
 const query={matches:false,addEventListener(type,fn){this.change=fn},removeEventListener(){}},events=new Set();let observing=0;
 const context={Map,matchMedia:()=>query,requestAnimationFrame:()=>1,cancelAnimationFrame(){},window:{addEventListener:type=>events.add('window:'+type),removeEventListener:type=>events.delete('window:'+type)},document:{body:{},querySelectorAll:()=>[],addEventListener:type=>events.add('document:'+type),removeEventListener:type=>events.delete('document:'+type)},ResizeObserver:class{disconnect(){}},MutationObserver:class{observe(){observing++}disconnect(){}}};
 vm.createContext(context);vm.runInContext(installMailOverlayScrollbars.toString()+'; binding=installMailOverlayScrollbars(()=>{throw Error("phone must not mount")})',context);
 assert.equal(events.size,0);assert.equal(observing,0);query.matches=true;query.change();assert(events.has('document:scroll'));assert.equal(observing,1);query.matches=false;query.change();assert.equal(events.size,0);context.binding.dispose();
});
