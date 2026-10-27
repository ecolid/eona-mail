import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailNavigation,normalizeMailNavigation,createMailScrollPersistence} from './src/mail-navigation-state.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const route=(folder='inbox',q='')=>({folder,q,searchOrder:'recent'});
function fixture(saved=null,{reuse=false}={}){
 let target=route(),reader=null,scroll={listScroll:0,readerScroll:0,loaded:100},pending=null,rejectPending=null;
 const stack=[saved?{eonaMailPage:saved}:{}],events=[];let at=0;
 const history={scrollRestoration:'auto',get state(){return stack[at]},get length(){return stack.length},pushState(v){stack.splice(at+1);stack.push(clone(v));at++;events.push('push')},replaceState(v){stack[at]=clone(v);events.push('replace')},back(){events.push('back');at=Math.max(0,at-1)}};
 const nav=createMailNavigation({owner:'a',history,url:'https://mail.test/',readRoute:()=>target,readReader:()=>reader,readScroll:()=>scroll,canReuseList:()=>reuse,applyRoute:(r)=>{target=r},restoreList:()=>{events.push('restore');return pending?new Promise((resolve,reject)=>{pending=resolve;rejectPending=reject}):Promise.resolve()},openReader:async r=>{reader=r;events.push('read:'+r.id)},applyScroll:(s,reading)=>{scroll={listScroll:s.listScroll,readerScroll:reading?s.readerScroll:0,loaded:s.loaded}},closeReader:()=>{reader=null;events.push('close')},onError:e=>events.push('error:'+e.message)});
 return {nav,history,stack,events,setRoute:r=>target=r,setReader:r=>reader=r,setScroll:s=>scroll=s,reader:()=>reader,scroll:()=>scroll,defer:()=>pending=true,release:()=>{const fn=pending;pending=null;fn()},fail:()=>{pending=null;rejectPending(Error('offline'))},pop:()=>nav.pop(history.state)};
}
test('history data is account-scoped, bounded and excludes arbitrary state',()=>{
 assert.equal(normalizeMailNavigation({version:1,owner:'other',route:route()},'a'),null);
 const value=normalizeMailNavigation({version:1,owner:'a',route:{...route('sent'),'password':'secret'},reader:{id:'sent-1',kind:'sent',body:'private body'},listScroll:-1,depth:1e9},'a');
 assert.equal('password'in value.route,false);assert.equal('body'in value.reader,false);assert.equal(value.listScroll,0);assert.equal(value.depth,10000);
});
test('directories and searches create usable browser history and save prior scroll',async()=>{
 const f=fixture();f.setScroll({listScroll:410,readerScroll:0,loaded:200});f.setRoute(route('sent','known'));f.nav.visit();
 assert.equal(f.stack[0].eonaMailPage.listScroll,410);assert.equal(f.history.state.eonaMailPage.route.folder,'sent');assert.equal(f.history.length,2);
 f.history.back();assert(f.pop());await new Promise(setImmediate);assert.equal(f.nav.snapshot.route.folder,'inbox');assert.equal(f.scroll().listScroll,410);
});
test('a reader return closes immediately and retains forward-reader identity',async()=>{
 const f=fixture();f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});f.setScroll({listScroll:200,readerScroll:600,loaded:100});f.nav.save();
 assert(f.nav.back());assert.equal(f.reader(),null);assert.equal(f.events.at(-1),'back');assert.equal(f.stack[1].eonaMailPage.reader.id,'8');assert.equal(f.stack[1].eonaMailPage.readerScroll,600);
 f.pop();await new Promise(setImmediate);assert.equal(f.nav.snapshot.reader,null);
 assert(f.nav.pop(f.stack[1]));await new Promise(setImmediate);assert.equal(f.reader().id,'8');assert.equal(f.scroll().readerScroll,600);
});
test('reload seeds the current folder and restores its reader after authoritative list readiness',async()=>{
 const saved=normalizeMailNavigation({version:1,owner:'a',route:route('sent','word'),reader:{id:'s','kind':'sent'},listScroll:330,readerScroll:440,loaded:200},'a');
 const f=fixture(saved);assert(f.nav.hasInitial);assert.equal(f.nav.snapshot.route.folder,'sent');f.defer();const work=f.nav.restoreInitial();assert.equal(f.reader(),null);f.release();await work;assert.equal(f.reader().id,'s');assert.equal(f.scroll().readerScroll,440);assert.equal(f.history.length,1);
});
test('a newer navigation cancels an older pending history restoration',async()=>{
 const f=fixture(),saved=normalizeMailNavigation({version:1,owner:'a',route:route('contacts'),reader:{id:'person@test',kind:'contacts'}},'a');f.defer();assert(f.nav.pop({eonaMailPage:saved}));f.setRoute(route('settings'));f.nav.visit();f.release();await new Promise(setImmediate);assert.equal(f.nav.snapshot.route.folder,'settings');assert.equal(f.reader(),null);assert(!f.events.includes('read:person@test'));
});
test('workspace-message history retains the actual parent and sent/received identity',()=>{
 const f=fixture();f.setRoute(route('contacts'));f.nav.visit();f.nav.open('person@test','contacts');f.nav.open('s','workspace-message',true,{id:'person@test',kind:'contacts'},'sent');const saved=f.history.state.eonaMailPage;
 assert.deepEqual(saved.reader.parent,{id:'person@test',kind:'contacts'});assert.equal(saved.reader.messageKind,'sent');assert.equal(saved.reader.id,'s');
});

import vm from 'node:vm';
import {testHooks} from './src/index.js';
test('shared received and sent openers preserve the correspondence history parent',()=>{
 const page=testHooks().PAGE,calls=[],ctx={window:{MailNavigation:{open:(...args)=>calls.push(args)}},state:{workspaceMail:true,workspaceSelected:{id:'friend@test',kind:'contacts'},workspaceMailKind:'received'},$:()=>({scrollTop:20})};
 vm.createContext(ctx);vm.runInContext(page.slice(page.indexOf('function pushMailReaderHistory('),page.indexOf('function returnToMailList(')),ctx);
 vm.runInContext("pushMailReaderHistory('41','workspace-message',true);pushMailReaderHistory('41','inbox',false)",ctx);assert.equal(calls[1][1],'workspace-message');assert.equal(calls[1][3].id,'friend@test');
 ctx.state.workspaceMailKind='sent';vm.runInContext("pushMailReaderHistory('sent-1','sent',false)",ctx);assert.equal(calls[2][1],'workspace-message');assert.equal(calls[2][4],'sent');
});

test('a user opening the next mail takes ownership from a slow return restoration',async()=>{
 const f=fixture();f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});f.nav.back();f.defer();f.pop();
 assert(f.nav.restoring);f.nav.open('9','inbox');f.setReader({id:'9',kind:'inbox'});
 assert.equal(f.nav.snapshot.reader.id,'9');assert.equal(f.nav.restoring,false);f.release();await new Promise(setImmediate);
 assert.equal(f.nav.snapshot.reader.id,'9');assert.equal(f.reader().id,'9');assert.equal(f.history.state.eonaMailPage.reader.id,'9');
});
test('an immediate next tap survives the asynchronous native back event',async()=>{
 const f=fixture();f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});f.nav.back();const destination=clone(f.history.state);
 // The native traversal has moved, but its popstate has not been delivered yet.
 f.nav.open('9','inbox');f.setReader({id:'9',kind:'inbox'});f.nav.pop(destination);await new Promise(setImmediate);
 assert.equal(f.nav.snapshot.reader.id,'9');assert.equal(f.reader().id,'9');assert.equal(f.history.state.eonaMailPage.reader.id,'9');
});

test('return to the mounted list is immediate and keeps the first native scroll without rereading',async()=>{
 const f=fixture(null,{reuse:true});f.setScroll({listScroll:400,readerScroll:0,loaded:200});f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});f.nav.back();
 f.setScroll({listScroll:520,readerScroll:0,loaded:200});f.nav.input?.();f.pop();await new Promise(setImmediate);
 assert.equal(f.events.includes('restore'),false);assert.equal(f.nav.restoring,false);assert.equal(f.scroll().listScroll,520);assert.equal(f.nav.snapshot.listScroll,520);
});
test('user scrolling wins over slow history restoration before and after native popstate',async()=>{
 for(const beforePop of [false,true])for(const next of [280,520]){
  const f=fixture();f.setScroll({listScroll:400,readerScroll:0,loaded:200});f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});f.nav.back();f.defer();
  if(beforePop){f.nav.input?.();f.setScroll({listScroll:next,readerScroll:0,loaded:200})}f.pop();
  if(!beforePop){f.nav.input?.();f.setScroll({listScroll:next,readerScroll:0,loaded:200})}f.release();await new Promise(setImmediate);
  assert.equal(f.scroll().listScroll,next);assert.equal(f.nav.snapshot.listScroll,next);assert.equal(f.history.state.eonaMailPage.listScroll,next);
 }
});
test('mounted list reuse cannot cross folder or filter identity or skip reload restoration',async()=>{
 const saved=normalizeMailNavigation({version:1,owner:'a',route:route(),listScroll:330,loaded:200},'a');const reloaded=fixture(saved,{reuse:true});await reloaded.nav.restoreInitial();assert.equal(reloaded.scroll().listScroll,330);assert(reloaded.events.includes('restore'));
 for(const changed of [route('sent'),route('inbox','changed')]){const f=fixture(null,{reuse:true});f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});const next=normalizeMailNavigation({version:1,owner:'a',route:changed,listScroll:90},'a');f.nav.pop({eonaMailPage:next});await new Promise(setImmediate);assert(f.events.includes('restore'));assert.equal(f.scroll().listScroll,90)}
});

test('failed restoration keeps the new scroll in both the viewport and history',async()=>{
 const f=fixture();f.setScroll({listScroll:400,readerScroll:0,loaded:200});f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});f.nav.back();f.defer();f.pop();f.nav.input();f.setScroll({listScroll:520,readerScroll:0,loaded:200});f.fail();await new Promise(setImmediate);assert.equal(f.scroll().listScroll,520);assert.equal(f.nav.snapshot.listScroll,520);assert.equal(f.history.state.eonaMailPage.listScroll,520);assert(f.events.includes('error:offline'));
});


test('continuous reading scroll cannot exhaust the browser history budget or block the next open',async()=>{
 const f=fixture(null,{reuse:true});let writes=0;
 for(const name of ['replaceState','pushState']){const original=f.history[name].bind(f.history);f.history[name]=(...args)=>{if(++writes>100)throw new DOMException('history rate limit','SecurityError');return original(...args)}}
 f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});
 for(let i=0;i<900;i++){f.setScroll({listScroll:75,readerScroll:i,loaded:100});f.nav.save()}
 assert(writes<10,'scroll state stays in memory, not one history write per frame');assert.equal(f.nav.snapshot.readerScroll,899);
 assert.doesNotThrow(()=>f.nav.back());f.pop();await new Promise(setImmediate);assert.doesNotThrow(()=>f.nav.open('9','inbox'));assert.equal(f.nav.snapshot.reader.id,'9');
});
test('browser history refusal cannot disable reading or the local return path',async()=>{
 const f=fixture(null,{reuse:true});for(const name of ['replaceState','pushState'])f.history[name]=()=>{throw new DOMException('history rate limit','SecurityError')};
 assert.doesNotThrow(()=>f.nav.open('8','inbox'));f.setReader({id:'8',kind:'inbox'});assert(f.nav.back());await new Promise(setImmediate);assert.equal(f.nav.snapshot.reader,null);assert.equal(f.reader(),null);
 assert.doesNotThrow(()=>f.nav.open('9','inbox'));assert.equal(f.nav.snapshot.reader.id,'9');
});


test('scroll persistence coalesces frame updates and flushes the latest state at a bounded rate',()=>{
 let now=0,id=0,saved=0,written=0,latest=0;const jobs=new Map(),writer=createMailScrollPersistence({now:()=>now,save:()=>saved++,persist:()=>{written++;latest=now},schedule:(fn,ms)=>{jobs.set(++id,{fn,at:now+ms});return id},cancel:id=>jobs.delete(id)});
 for(let i=0;i<1800;i++){now=i*16;writer.update();for(const [id,job]of [...jobs])if(job.at<=now){jobs.delete(id);job.fn()}}
 assert(written<=30);assert(saved>=1800);writer.flush();assert.equal(latest,now);assert.equal(jobs.size,0);writer.dispose();
});
test('repeated surface synchronization is idempotent across the return event and its native history event',()=>{
 const match=/function syncMailReader[^\n]+/.exec(testHooks().PAGE);assert(match);let reading=false,events=0,removed=0;const nodes={view:{},list:{querySelectorAll:()=>[{classList:{remove:()=>removed++}}]}};
 const context={mailReaderSurfaceKey:'',state:{cur:null},matchMedia:()=>({matches:true}),Event,document:{body:{classList:{contains:()=>reading}},getElementById:id=>nodes[id],dispatchEvent:()=>events++}};vm.createContext(context);vm.runInContext(match[0]+';syncMailReader();syncMailReader();',context);assert.equal(events,1);assert.equal(removed,1);
 reading=true;context.state.cur='8';vm.runInContext('syncMailReader();syncMailReader()',context);assert.equal(events,2);assert.equal(nodes.list.inert,true);
 reading=false;context.state.cur=null;vm.runInContext('syncMailReader();syncMailReader()',context);assert.equal(events,3);assert.equal(nodes.list.inert,false);
});


test('open-return-open-return before native traversal settles issues only one browser back',async()=>{
 const f=fixture(null,{reuse:true});f.nav.open('8','inbox');f.setReader({id:'8',kind:'inbox'});f.nav.back();const destination=clone(f.history.state);
 f.nav.open('9','inbox');f.setReader({id:'9',kind:'inbox'});f.nav.back();assert.equal(f.events.filter(x=>x==='back').length,1,'never queue a second traversal across the app entry');
 f.nav.pop(destination);await new Promise(setImmediate);assert.equal(f.nav.snapshot.reader,null);assert.equal(f.nav.restoring,false);assert.equal(f.history.state.eonaMailPage.reader,null);
 f.nav.open('10','inbox');assert.equal(f.nav.snapshot.reader.id,'10');assert.equal(f.history.state.eonaMailPage.reader.id,'10');
});

test('browser traversal cannot restore scroll behind the application after return input begins',()=>{const f=fixture();assert.equal(f.history.scrollRestoration,'manual')});
