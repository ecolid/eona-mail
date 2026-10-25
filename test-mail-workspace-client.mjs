import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createMailToggleQueue} from './src/mail-toggle-queue.js';
import {mailDirectoryFilter} from './src/mail-list-filters.js';
import {mailWorkspaceBrowserScript} from './src/mail-workspace-view.js';
function fixture(){
 const requests=[],storage=new Map(),events={},syncNode={textContent:''};
 const ctx={mailReadWrites:{clear(){}},mailDirectoryFilter,mailToast(){},createMailToggleQueue,mailResources:{invalidate(){}},console,Event,Date,setInterval:()=>1,clearInterval(){},setTimeout:callback=>{queueMicrotask(callback);return 1},state:{folder:'inbox'},location:{hostname:'fixture.test'},document:{body:{classList:{contains:()=>false}},querySelector:()=>null,querySelectorAll:selector=>selector==='[data-mail-sync-status]'?[syncNode]:[],addEventListener(){}},addEventListener:(name,callback)=>events[name]=callback,dispatchEvent:event=>events[event.type]?.(event),sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},api:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(mailWorkspaceBrowserScript(),ctx);ctx.MailWorkspace.setOwner('owner@example.test');
 return {store:ctx.MailWorkspace,requests,storage,syncNode,context:ctx};
}
const initial={id:'draft-one',to:'to@example.test',subject:'A',body:'old',rev:1};
async function loaded(){const s=fixture(),ready=s.store.load();s.requests[0].resolve({drafts:[initial],contacts:[],folders:[]});await ready;return s}
test('a save response preserves newer typing and advances the revision for its next write',async()=>{
 const s=await loaded(),submitted={...initial,body:'submitted'};s.store.local(submitted);const saving=s.store.save(submitted);
 s.store.local({...submitted,body:'newer typing'});s.requests[1].resolve({draft:{...submitted,rev:2}});await saving;
 assert.equal(s.store.data.drafts[0].body,'newer typing');assert.equal(s.store.data.drafts[0].rev,2);assert.equal(s.store.data.drafts[0].unsaved,true);
 const next=s.store.save({...s.store.data.drafts[0]});assert.equal(JSON.parse(s.requests[2].options.body).rev,2);s.requests[2].resolve({draft:{...submitted,body:'newer typing',rev:3}});await next;assert.equal(s.store.data.drafts[0].rev,3);
});
test('unknown write outcome is recovered by stable-ID readback, not a duplicate write',async()=>{
 const s=await loaded(),submitted={...initial,body:'saved remotely'};const saving=s.store.save(submitted);s.requests[1].reject(Error('connection lost'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(s.requests[2].options.fresh,true);s.requests[2].resolve({drafts:[{...submitted,rev:2}]});
 assert.equal((await saving).rev,2);assert.equal(s.requests.filter(r=>r.options?.method==='PUT').length,1);
});
test('refreshing unchanged server revision preserves a recoverable local draft without inventing a conflict',async()=>{
 const s=await loaded();s.store.local({...initial,body:'local typing'});const refresh=s.store.load(true);s.requests[1].resolve({drafts:[initial],contacts:[],folders:[]});await refresh;
 assert.equal(s.store.data.drafts[0].body,'local typing');assert.equal(s.store.data.drafts[0].conflict,false);
 const fail=s.store.load(true);s.requests[2].reject(Error('offline'));await assert.rejects(fail,/offline/);assert.equal(s.store.data.drafts[0].body,'local typing');assert(s.store.error);
});

test('a lost submit response polls its stable receipt and completes without a second send',async()=>{
 const s=await loaded(),draft=s.store.data.drafts[0];const sending=s.store.send(draft,'submission');s.requests[1].reject(Error('connection lost'));
 await new Promise(resolve=>setImmediate(resolve));s.requests[2].resolve({message:{id:'submission',state:'sending'}});
 await new Promise(resolve=>setImmediate(resolve));s.requests[3].resolve({message:{id:'submission',draft_id:draft.id,draft_rev:1,state:'sent'}});
 await new Promise(resolve=>setImmediate(resolve));s.requests[4].resolve({drafts:[],contacts:[],folders:[],sent:[{id:'submission',draft_id:draft.id,draft_rev:1,state:'sent'}]});
 assert.equal((await sending).state,'sent');assert.equal(s.requests.filter(r=>r.options?.method==='POST').length,1);assert.equal(s.store.data.drafts.length,0);assert.equal(s.store.data.sent.length,1);
});
test('an explicit pre-submit rejection preserves the draft and does not become an ambiguous send',async()=>{
 const s=await loaded(),sending=s.store.send(s.store.data.drafts[0],'submission');s.requests[1].reject(Object.assign(Error('收件地址无效'),{status:400,data:{error:'收件地址无效'}}));
 await assert.rejects(sending,error=>error.definitelyNotSubmitted===true);assert.equal(s.requests.length,2);assert.equal(s.store.data.drafts.length,1);
});

test('source recovery updates the visible sent status without fetching rows or rebuilding the reader',async()=>{
 const s=fixture();s.context.state.folder='sent';const first=s.store.load();s.requests[0].resolve({drafts:[],contacts:[],folders:[],sync:{configured:true,accounts:[{state:'error'}]}});await first;assert.match(s.syncNode.textContent,/暂未完成/);
 const recovery=s.store.load(true);s.requests[1].resolve({drafts:[],contacts:[],folders:[],sync:{configured:true,accounts:[{state:'ok'}]}});await recovery;assert.equal(s.syncNode.textContent,'');assert.equal(s.syncNode.hidden,true);assert.equal(s.requests.length,2);assert(s.requests.every(r=>!r.url.startsWith('/api/mail-workspace/sent')));
});

test('recovering an unchanged workspace clears failure state; invalidated reads do not show a false network failure',async()=>{
 const s=fixture();s.context.state.folder='sent';const value={drafts:[],contacts:[],folders:[],sync:{configured:true,accounts:[{state:'ok'}]}};const initial=s.store.load();s.requests[0].resolve(value);await initial;
 const failed=s.store.load(true);s.requests[1].reject(Error('offline'));await assert.rejects(failed,/offline/);assert.match(s.syncNode.textContent,/更新失败/);
 const recovered=s.store.load(true);s.requests[2].resolve(value);await recovered;assert.equal(s.syncNode.textContent,'');assert.equal(s.syncNode.hidden,true);assert.equal(s.store.error,null);
 const invalidated=s.store.load(true);s.requests[3].reject(Object.assign(Error('older read'),{name:'MailReadSuperseded'}));await invalidated;assert.equal(s.store.error,null);assert.equal(s.syncNode.textContent,'');assert.equal(s.syncNode.hidden,true);assert.equal(s.requests.length,4);
});

test('directory search matches visible identity fields, not internal grouping enums',async()=>{
 const s=fixture(),ready=s.store.load();s.requests[0].resolve({drafts:[],contacts:[],folders:[],directory:[{address:'person@example.test',name:'Person',group:'other'}]});await ready;
 const list={scrollTop:0,setAttribute(){},innerHTML:'',querySelector:()=>null};s.context.mailListHeading=()=>'';s.context.MailExperience={segmentsChanged(){}};s.context.document.getElementById=()=>list;s.context.activeMailPage={markup:''};s.context.EonaUI={searchRank:(query,fields)=>Object.values(fields).some(value=>String(value).toLowerCase().includes(query.toLowerCase()))};s.context.esc=value=>String(value??'');s.context.I={person:'',mail:'',star:''};s.context.state.folder='contacts';s.context.state.q='other';
 assert.equal((await s.context.renderMailWorkspace()).count,0);s.context.state.q='Person';assert.equal((await s.context.renderMailWorkspace()).count,1);
});


test('important-contact writes preserve an identity not already in the directory and failures roll back',async()=>{
 const s=await loaded(),person={address:'new@example.test',name:'New person'};
 const saving=s.store.important(person,true);assert.equal(s.store.isImportant(person.address),true);await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.parse(s.requests[1].options.body).name,'New person');s.requests[1].resolve({contact:person});assert.equal(await saving,true);assert.equal(s.store.data.directory[0].name,'New person');
 const removal=s.store.important(person,false);assert.equal(s.store.isImportant(person.address),false);await new Promise(resolve=>setImmediate(resolve));s.requests[2].reject(Error('offline'));assert.equal(await removal,false);assert.equal(s.store.isImportant(person.address),true);
});

test('subscription removal and recovery each persist; restored result offers no reverse undo',async()=>{
 const s=fixture(),notices=[];s.context.mailToast=(message,options)=>notices.push({message,options});const ready=s.store.load();const value={drafts:[],contacts:[],folders:[],sources:[{key:'list:weekly.test',included:true}]};s.requests[0].resolve(value);await ready;
 const removed=s.store.sourcePreference('list:weekly.test',false);await new Promise(resolve=>setImmediate(resolve));assert.equal(s.store.data.sources[0].included,false);s.requests[1].resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));s.requests[2].resolve({...value,sources:[{key:'list:weekly.test',included:false}]});await removed;
 const notice=notices.at(-1);assert.equal(notice.options.action.label,'恢复订阅');const undo=notice.options.action.run();await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.parse(s.requests[3].options.body).included,true);s.requests[3].resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));s.requests[4].resolve(value);await undo;
 assert.equal(s.store.data.sources[0].included,true);assert.equal(notices.at(-1).message,'已加入订阅列表');assert.equal(notices.at(-1).options.action,undefined);
});
test('failed subscription removal rolls back; old-account recovery cannot write',async()=>{
 const s=fixture(),notices=[];s.context.mailToast=(message,options)=>notices.push({message,options});const ready=s.store.load();const value={drafts:[],contacts:[],folders:[],sources:[{key:'list:weekly.test',included:true}]};s.requests[0].resolve(value);await ready;
 const failed=s.store.sourcePreference('list:weekly.test',false);await new Promise(resolve=>setImmediate(resolve));s.requests[1].reject(Error('offline'));assert.equal(await failed,false);assert.equal(s.store.data.sources[0].included,true);
 const removed=s.store.sourcePreference('list:weekly.test',false);await new Promise(resolve=>setImmediate(resolve));s.requests[2].resolve({ok:true});await new Promise(resolve=>setImmediate(resolve));s.requests[3].resolve({...value,sources:[{key:'list:weekly.test',included:false}]});await removed;const undo=notices.at(-1).options.action.run;s.context.mailStars={clear(){}};s.context.mailPages={clear(){}};s.context.mailResources.clear=()=>{};s.store.setOwner('different-owner');assert.throws(undo,/账号已变化/);assert.equal(s.requests.length,4);
});

test('sent row identity and subject survive a later ID-only compact refresh',async()=>{
 const s=fixture(),ready=s.store.load();const compact={drafts:[],contacts:[],folders:[],sent:[{id:'sent-one'}]};s.requests[0].resolve(compact);await ready;
 const list={scrollTop:0,setAttribute(){},innerHTML:'',querySelector:()=>null};s.context.state.folder='sent';s.context.state.q='';s.context.URLSearchParams=URLSearchParams;s.context.document.getElementById=()=>list;s.context.activeMailPage={markup:''};s.context.mailListHeading=()=>'';s.context.mailRow=m=>'<article data-mail-id="'+m.id+'">'+m.subject+'</article>';s.context.esc=String;s.context.I={};s.context.EonaUI={};
 const rendering=s.context.renderMailWorkspace();await new Promise(setImmediate);if(!s.requests[1])throw Error('sent-render:'+list.innerHTML);s.requests[1].resolve({messages:[{id:'sent-one',subject:'Preserved subject',body:'Original body',to:[],updated_at:'2026-10-23T12:00:00Z'}],total:1,next:null});await rendering;
 assert.equal(s.store.row('sent','sent-one').subject,'Preserved subject');
 const refresh=s.store.load(true);s.requests[2].resolve(compact);await refresh;assert.equal(s.store.data.sent[0].subject,undefined);assert.equal(s.store.row('sent','sent-one').subject,'Preserved subject');
});
