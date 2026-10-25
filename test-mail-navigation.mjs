import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailNavigation,normalizeMailNavigation} from './src/mail-navigation-state.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const route=(folder='inbox',q='')=>({folder,q,searchOrder:'recent'});
function fixture(saved=null){
 let target=route(),reader=null,scroll={listScroll:0,readerScroll:0,loaded:100},pending=null;
 const stack=[saved?{eonaMailPage:saved}:{}],events=[];let at=0;
 const history={get state(){return stack[at]},get length(){return stack.length},pushState(v){stack.splice(at+1);stack.push(clone(v));at++;events.push('push')},replaceState(v){stack[at]=clone(v);events.push('replace')},back(){events.push('back');at=Math.max(0,at-1)}};
 const nav=createMailNavigation({owner:'a',history,url:'https://mail.test/',readRoute:()=>target,readReader:()=>reader,readScroll:()=>scroll,applyRoute:(r)=>{target=r},restoreList:()=>pending?new Promise(resolve=>pending=resolve):Promise.resolve(),openReader:async r=>{reader=r;events.push('read:'+r.id)},applyScroll:(s,reading)=>{scroll={listScroll:s.listScroll,readerScroll:reading?s.readerScroll:0,loaded:s.loaded}},closeReader:()=>{reader=null;events.push('close')},onError:e=>events.push('error:'+e.message)});
 return {nav,history,stack,events,setRoute:r=>target=r,setReader:r=>reader=r,setScroll:s=>scroll=s,reader:()=>reader,scroll:()=>scroll,defer:()=>pending=true,release:()=>{const fn=pending;pending=null;fn()},pop:()=>nav.pop(history.state)};
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
