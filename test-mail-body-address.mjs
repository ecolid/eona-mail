import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mailBodyBrowserScript} from './src/mail-body-view.js';
import {testHooks} from './src/index.js';
import {mailAddressParts} from './src/mail-reader-view.js';
const script=mailBodyBrowserScript(),start=script.indexOf(' function followMailLink('),end=script.indexOf('\n function linkify(',start);
function click(href,trusted=true){
 const contacts=[],messages=[],trigger={tagName:'BUTTON'},source={dataset:{mailOriginalHref:href},getAttribute:()=>href};let prevented=false;
 const context={URL,mailAddressParts,EonaUI:{toast:value=>messages.push(value)},showMailContact:(node,contact)=>contacts.push({node,contact})};vm.createContext(context);vm.runInContext(testHooks().PAGE.slice(testHooks().PAGE.indexOf('function createMailFeedbackPresenter('),testHooks().PAGE.indexOf('\n',testHooks().PAGE.indexOf('function mailToast(')))+script.slice(start,end),context);
 context.followMailLink({isTrusted:trusted,currentTarget:trigger,preventDefault(){prevented=true},target:source},{URL:'https://mail.example.test/original'},source);
 return {contacts,messages,trigger,prevented};
}
test('a trusted email-address click in the sandbox opens the parent-owned contact menu',()=>{
 const result=click('mailto:person%2Btag%40example.test?subject=Untrusted%20prefill');assert(result.prevented);assert.equal(result.contacts.length,1);assert.equal(result.contacts[0].node,result.trigger);assert.equal(result.contacts[0].contact.address,'person+tag@example.test');assert.equal(result.messages.length,0);
});
test('malformed addresses and synthetic clicks cannot navigate or initiate contact actions',()=>{
 const malformed=click('mailto:person@@example.test');assert.equal(malformed.contacts.length,0);assert.equal(malformed.messages.length,1);
 const synthetic=click('mailto:person@example.test',false);assert.equal(synthetic.contacts.length,0);assert(synthetic.prevented);
});
test('source failures retain their retry owner through late render callbacks and repeated activation',async()=>{
 class Node{
  constructor(){this.children=[];this.attributes={};this.style={};this.dataset={};this.isConnected=true;}
  set textContent(value){this.text=String(value);this.children=[];}get textContent(){return this.text||'';}
  setAttribute(key,value){this.attributes[key]=value;}append(...items){this.children.push(...items);}prepend(node){this.children.unshift(node);}remove(){this.removed=true;}
 }
 const timers=[],holder=new Node(),frame=new Node();frame.parentElement=holder;frame.addEventListener=()=>{};
 let release,reloads=0;const pending=new Promise(resolve=>release=resolve);
 const context={window:{},document:{createElement:()=>new Node(),querySelector:()=>null},AbortController,Map,Set,setTimeout(fn,delay){timers.push({fn,delay});return timers.length;},clearTimeout(){},requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
 vm.createContext(context);vm.runInContext(script,context);
 const dispose=context.window.installMailBodyFrame(frame,{reload:async()=>{reloads++;dispose.sourceLoading();await pending;dispose.sourceLoaded();}});
 dispose.sourceLoading();assert.equal(timers.filter(timer=>timer.delay===15000).length,0,'source reads must not run the render watchdog');
 dispose.sourceLoaded();const lateWatchdog=timers.find(timer=>timer.delay===15000).fn;
 dispose.sourceLoading();dispose.sourceFailed(new Error('source unavailable'));
 const status=holder.children[0],retry=status.children[0];lateWatchdog();assert.equal(status.textContent,'source unavailable');assert.equal(status.children[0],retry);
 const first=retry.onclick(),second=retry.onclick();await second;assert.equal(reloads,1);assert.equal(status.attributes.role,'status');
 release();await first;assert.equal(timers.filter(timer=>timer.delay===15000).length,2);
 dispose();lateWatchdog();assert.equal(status.removed,true);assert.equal(reloads,1);
});

test('body and following files share pending, fitted, failed, retry and disposed presentation',()=>{
 class Node{
  constructor(){this.children=[];this.attributes={};this.style={setProperty(k,v){this[k]=v},getPropertyValue(k){return this[k]}};this.dataset={};this.isConnected=true;this.clientWidth=600;this.scrollWidth=600;}
  set textContent(v){this.text=String(v);this.children=[]}get textContent(){return this.text||''}
  setAttribute(k,v){this.attributes[k]=v}append(...v){this.children.push(...v)}prepend(n){this.children.unshift(n)}remove(){this.removed=true}addEventListener(){}querySelectorAll(){return []}getBoundingClientRect(){return{left:0,top:0,width:600,height:56}}
 }
 const frames=new Map();let serial=0;const reader=new Node(),holder=new Node(),frame=new Node(),body=new Node(),html=new Node();frame.parentElement=holder;frame.closest=()=>reader;
 const doc={URL:'about:srcdoc',readyState:'complete',body,documentElement:html,head:new Node(),addEventListener(){},createElement:()=>{const n=new Node();n.ownerDocument=doc;return n},createTreeWalker:()=>({nextNode:()=>null}),querySelectorAll:()=>[],defaultView:{getComputedStyle:()=>({overflowX:'visible'})}};frame.contentDocument=doc;
 const context={window:{},document:{createElement:()=>new Node(),querySelector:()=>null},AbortController,Map,Set,ResizeObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},setTimeout:()=>1,clearTimeout(){},requestAnimationFrame(fn){frames.set(++serial,fn);return serial},cancelAnimationFrame(id){frames.delete(id)}};
 const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn())};vm.createContext(context);vm.runInContext(script,context);
 const dispose=context.window.installMailBodyFrame(frame,{reload:()=>{}}),placeholder=holder.children.find(n=>n.className==='mail-body-placeholder');
 assert.equal(reader.dataset.mailBodyState,'pending');assert.equal(holder.attributes['aria-busy'],'true');assert.equal(placeholder.hidden,false);assert.equal(frame.style.visibility,'hidden');
 dispose.sourceLoading();dispose.sourceLoaded();flush();assert.equal(reader.dataset.mailBodyState,'pending','first fit is not a committed layout');
 dispose.sourceFailed(new Error('unavailable'));flush();assert.equal(reader.dataset.mailBodyState,'failed','late fit must not clear a failure');assert.equal(placeholder.hidden,true);assert.equal(holder.attributes['aria-busy'],'false');
 dispose.sourceLoading();frame.contentDocument={...doc};dispose.sourceLoaded();flush();flush();assert.equal(frame.dataset.mailReady,'true');assert.equal(reader.dataset.mailBodyState,'ready');assert.equal(frame.style.visibility,'visible');assert.equal(placeholder.hidden,true);
 dispose.sourceLoading();assert.equal(reader.dataset.mailBodyState,'pending');assert.equal(frame.style.visibility,'hidden');dispose.sourceLoaded();dispose();flush();assert.equal(reader.dataset.mailBodyState,'pending','disposed source cannot reveal a different reader');assert.equal(placeholder.removed,true);
});
