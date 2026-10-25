import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{fetchWithIdentity} from './src/index.js';
import {SQLiteD1} from './sv/storage.mjs';
import {normalizeMailLayout,rankMailboxes} from './src/mail-layout-model.js';
test('mailboxes rank by recent arrival and usage; explicit choices and active mailbox win',()=>{
 const now=Date.parse('2026-10-15T00:00:00Z'),rows=[
 {key:'old@example.com',count:5000,last_seen:'2015-01-01'},
 {key:'recent@example.com',count:10,last_seen:'2026-10-14'},
 {key:'another@example.com',count:8,last_seen:'2026-10-14'},{key:'third@example.com',count:6,last_seen:'2026-10-14'},{key:'pin@example.com',count:0},{key:'hidden@example.com',count:9000,last_seen:'2026-10-14'},
 {key:'used@example.com',count:1},{key:'active@example.com',count:0}];
 const prefs=normalizeMailLayout({limit:3,visibility:{'pin@example.com':'show','hidden@example.com':'hide','active@example.com':'hide'}});
 const result=rankMailboxes(rows,prefs,{'used@example.com':{count:10,at:now}},'active@example.com',now);
 assert.deepEqual(result.visible.map(x=>x.key),['pin@example.com','used@example.com','active@example.com']);
 const automatic=rankMailboxes(rows,normalizeMailLayout({limit:3,visibility:{'hidden@example.com':'hide'}}),{},'',now);
 assert(automatic.visible.some(x=>x.key==='recent@example.com'));assert(!automatic.visible.some(x=>x.key==='old@example.com'));
});
test('UI preferences persist per trusted owner and reject machine credentials and oversized input',async()=>{
 const DB=new SQLiteD1(':memory:');try{
 const env={PUBLIC_HOST:'mail.eona.top',MAILDB:DB,INBOX_PASSWORD:'fixture-password',READONLY_TOKENS:'fixture-readonly-'.padEnd(40,'x'),IMPORT_TOKENS:'fixture-import-'.padEnd(40,'x')};
 const a={authenticated:true,subject:'fixture-a',email:'a@example.com'},b={authenticated:true,subject:'fixture-b',email:'b@example.com'};
 const call=(identity,method='GET',body,headers={})=>fetchWithIdentity(new Request('https://mail.eona.top/api/mail-layout',{method,headers,body}),env,identity);
 let res=await call(a,'PUT',JSON.stringify({limit:8,density:'comfortable',visibility:{'PIN@example.com':'show','hidden@example.com':'hide'}}));assert.equal(res.status,200);
 const value=(await (await call(a)).json()).preferences;assert.equal(value.limit,8);assert.equal(value.visibility['pin@example.com'],'show');
 const html=await (await fetchWithIdentity(new Request('https://mail.eona.top/'),env,a)).text();
 assert.match(html,/<body data-account-auth="true" data-mail-density="comfortable"/);
 const otherHTML=await (await fetchWithIdentity(new Request('https://mail.eona.top/'),env,b)).text();
 assert.match(otherHTML,/<body data-account-auth="true" data-mail-density="compact"/);
 const anonymousHTML=await (await fetchWithIdentity(new Request('https://mail.eona.top/'),env,null)).text();
 assert.doesNotMatch(anonymousHTML,/<body[^>]*data-mail-density/);
 assert.equal((await (await call(b)).json()).preferences.limit,6);
 assert.equal((await call(a,'PUT','{bad')).status,400);
 assert.equal((await call(a,'PUT',JSON.stringify({extra:'x'.repeat(17000)}))).status,413);
 for(const token of [env.READONLY_TOKENS,env.IMPORT_TOKENS])assert.equal((await worker.fetch(new Request('https://mail.eona.top/api/mail-layout',{headers:{Authorization:'Bearer '+token}}),env,{})).status,403);
 assert.equal((await call(null)).status,401);assert.equal((await call(a,'DELETE')).status,405);
 const me=await fetchWithIdentity(new Request('https://mail.eona.top/api/me'),env,a);assert.equal((await me.json()).email,'a@example.com');
 }finally{DB.close()}
});

// Settings must await their source instead of freezing an initially empty mailbox inventory.
import vm from 'node:vm';
import {testHooks} from './src/index.js';
const page=testHooks().PAGE;
test('a declared child mailbox remains one entry after direct historical/source imports',async()=>{
 const side={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]},mask={};
 const ctx={state:{folder:'inbox',rt:{routes:[{mailbox:'main@example.test',hop:'',box_count:50},{mailbox:'child@example.test',hop:'main@example.test',observed_count:31}],by_alias:[{alias:'child@example.test',n:10}],by_category:[]}},
 api:async()=>({aliases:[{alias:'child@example.test',email_count:10},{alias:'unregistered@example.test',email_count:2}]}),
 MailWorkspace:{load:async()=>{},loaded:true,data:{folders:[{folder:'inbox',count:52}],drafts:[],contacts:[],directory:[],sent_total:0}},
 MailExperience:{acceptSideUpdate:()=>true,order:(_,rows)=>rows,sideRendered(){},navigationChanged(){}},mailSortHandle:()=>'',I:new Proxy({},{get:()=>''}),CATS:[],esc:String,mailCatsOpen:true,mailLayout:{},mailboxUsage:{},rankMailboxes:rows=>({visible:rows,collapsed:[]}),$:id=>id==='#side'?side:mask,mailDrawer:{close(){}}};
 vm.createContext(ctx);vm.runInContext(page.slice(page.indexOf('async function loadSide(){'),page.indexOf('const mailPages=new Map()')),ctx);await vm.runInContext('loadSide()',ctx);
 assert.equal((side.innerHTML.match(/data-origin="child@example.test"/g)||[]).length,1);
 assert.doesNotMatch(side.innerHTML,/data-alias="child@example.test"/);
 assert.match(side.innerHTML,/data-alias="unregistered@example.test"/);
 assert.match(side.innerHTML,/child@example.test<\/span><span class="n">31/);
});
const settingsStart=page.slice(page.indexOf('let mailSettingsIntent=0;'),page.indexOf(" const options=[['auto'"))+'return "ready";}';
function settingsFixture(){
 const requests=[],button={},list={innerHTML:'',querySelector:key=>key==='#mail-settings-form'?null:button};
 const ctx={state:{folder:'settings'},document:{body:{classList:{add(){}}}},$:()=>list,esc:String,loadMailLayout:()=>Promise.resolve(),MailWorkspace:{load:()=>new Promise((resolve,reject)=>requests.push({resolve,reject}))},api:()=>Promise.resolve({routes:[]})};
 vm.createContext(ctx);vm.runInContext(settingsStart,ctx);
 return {ctx,list,button,requests,load:()=>vm.runInContext('loadMailSettings()',ctx)};
}
test('settings wait for source inventory and stale navigation cannot overwrite the next page',async()=>{
 const f=settingsFixture(),pending=f.load();assert.doesNotMatch(f.list.innerHTML,/正在读取/);f.ctx.state.folder='inbox';f.list.innerHTML='inbox';f.requests[0].resolve();await pending;assert.equal(f.list.innerHTML,'inbox');
 f.ctx.state.folder='settings';const old=f.load(),latest=f.load();f.requests[1].resolve();assert.equal(await old,undefined);f.requests[2].resolve();assert.equal(await latest,'ready');
});
test('settings source failure offers retry instead of an empty account form; background refresh preserves editing',async()=>{
 const f=settingsFixture(),pending=f.load();f.requests[0].reject(Error('offline'));await pending;assert.match(f.list.innerHTML,/role="alert"/);assert.match(f.list.innerHTML,/offline/);assert.equal(typeof f.button.onclick,'function');
 const again=f.button.onclick();f.requests[1].resolve();assert.equal(await again,'ready');
 let tick,calls=0;const ctx={state:{folder:'settings'},$:()=>({style:{display:'flex'}}),document:{hidden:false},mailRefreshPending:false,loadList:()=>calls++,setInterval:fn=>tick=fn};
 vm.runInNewContext(page.slice(page.lastIndexOf('setInterval(()=>{if('),page.indexOf('},30000);',page.lastIndexOf('setInterval(()=>{if('))+10),ctx);
 tick();ctx.state.folder='routes';tick();assert.equal(calls,0);ctx.state.folder='inbox';tick();assert.equal(calls,1);
});

import {readFileSync} from 'node:fs';
import {mailSettingsAccounts} from './src/mail-settings-view.js';
test('combined settings save display, sender and routing changes together; invalid groups never partially commit',async()=>{
 const db=new SQLiteD1(':memory:');db.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const env={MAILDB:db,MAIL_SENDER:{list:async()=>[{id:'one',address:'one@example.test',available:true}]}};
 const identity={authenticated:true,subject:'owner',email:'owner@example.test'};
 const call=input=>fetchWithIdentity(new Request('https://mail.eona.top/api/mail-workspace/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),env,identity);
 const payload={layout:{density:'comfortable',limit:8,visibility:{'one@example.test':'show'}},sending:{default_id:'one',default_name:'示例用户',names:{}},routes:[{mailbox:'one@example.test',hop:'relay@example.test',alias:'archive@example.test',eona_reads:true}]};
 try{
  assert.equal((await call({...payload,sending:{...payload.sending,default_id:'forged'}})).status,400);
  assert.equal(db.db.prepare("SELECT name FROM sqlite_master WHERE name='mail_ui_preferences'").get(),undefined);
  let response=await call(payload);assert.equal(response.status,200);let value=await response.json();assert.equal(value.preferences.limit,8);assert.equal(value.senders[0].name,'示例用户');assert.equal(db.db.prepare('SELECT hop FROM mailbox_routes').get().hop,'relay@example.test');
  const previous=db.db.prepare('SELECT value FROM mail_ui_preferences').get().value;
  db.db.exec("CREATE TRIGGER fail_settings_test BEFORE INSERT ON mailbox_routes WHEN NEW.mailbox='reject@example.test' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");
  response=await call({...payload,layout:{...payload.layout,limit:4},sending:{...payload.sending,default_name:'Other'},routes:[{mailbox:'reject@example.test',eona_reads:true}]});assert.equal(response.status,503);
  assert.equal(db.db.prepare('SELECT value FROM mail_ui_preferences').get().value,previous);assert.equal(JSON.parse(db.db.prepare('SELECT preferences_json FROM mail_sender_preferences').get().preferences_json).default_name,'示例用户');assert.equal(db.db.prepare("SELECT mailbox FROM mailbox_routes WHERE mailbox='reject@example.test'").get(),undefined);
  assert.equal((await call({...payload,routes:[{mailbox:'bad',eona_reads:true}]})).status,400);assert.equal((await call({...payload,sending:null})).status,400);
  response=await call({...payload,routes:[{mailbox:'one@example.test',remove:true}]});assert.equal(response.status,200);assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM mailbox_routes').get().n,0);
 }finally{db.close()}
});
test('mail account settings derive a deduplicated union of observed mailboxes, sender identities and declared routes',()=>{
 const result=mailSettingsAccounts([{key:'observed@example.test'},{key:'BOTH@example.test'}],[{id:'a',address:'both@example.test'},{id:'b',address:'send-only@example.test'}],[{mailbox:'both@example.test',alias:'archive@example.test'},{mailbox:'receive-only@example.test'}]);
 assert.equal(result.length,4);assert.equal(result.find(r=>r.address==='both@example.test').sender.id,'a');assert.equal(result.find(r=>r.address==='both@example.test').route.alias,'archive@example.test');assert.equal(result.find(r=>r.address==='send-only@example.test').route,undefined);assert.equal(result.find(r=>r.address==='receive-only@example.test').sender,undefined);
});

test('route read failures remain unknown initially, retain last data on later failure and recover',async()=>{
 const side={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]},mask={};let broken=true;
 const source={routes:[{mailbox:'known@example.test',box_count:17}],by_alias:[],by_category:[{c:'工作',n:9}]};
 const ctx={state:{folder:'inbox'},api:async path=>{if(path.startsWith('/api/routes')){if(broken)throw Error('offline');return source}return {aliases:[]}},
 MailWorkspace:{load:async()=>{},loaded:true,data:{folders:[{folder:'inbox',count:17}],drafts:[],contacts:[],directory:[],sent_total:0}},
 MailExperience:{acceptSideUpdate:()=>true,order:(_,rows)=>rows,sideRendered(){}},mailSortHandle:()=>'',I:new Proxy({},{get:()=>''}),CATS:['工作'],esc:String,mailCatsOpen:true,mailLayout:{},mailboxUsage:{},rankMailboxes:rows=>({visible:rows,collapsed:[]}),$:id=>id==='#side'?side:mask,mailDrawer:{close(){}}};
 vm.createContext(ctx);vm.runInContext(page.slice(page.indexOf('async function loadSide(){'),page.indexOf('const mailPages=new Map()')),ctx);
 await vm.runInContext('loadSide()',ctx);assert.equal(ctx.state.rt,undefined);assert.equal(ctx.state.rtStale,true);assert.match(side.innerHTML,/邮箱与分类读取失败/);assert.match(side.innerHTML,/data-mail-routes-retry/);assert.match(side.innerHTML,/工作<\/span><span class="n">—/);assert.doesNotMatch(side.innerHTML,/data-box=/);
 broken=false;await vm.runInContext('loadSide()',ctx);assert.equal(ctx.state.rtStale,false);assert.match(side.innerHTML,/known@example.test<\/span><span class="n">17/);assert.match(side.innerHTML,/工作<\/span><span class="n">9/);assert.doesNotMatch(side.innerHTML,/读取失败/);
 broken=true;ctx.state.rtStale=true;await vm.runInContext('loadSide()',ctx);assert.match(side.innerHTML,/已保留上次内容/);assert.match(side.innerHTML,/known@example.test<\/span><span class="n">17/);assert.match(side.innerHTML,/工作<\/span><span class="n">9/);
});
test('automatic mailbox usage is isolated by trusted owner without migrating global legacy data',()=>{
 const store=new Map([['eona-mailbox-usage',JSON.stringify({'legacy@example.test':{count:99}})]]),ctx={mailboxUsage:{},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}};
 vm.createContext(ctx);vm.runInContext(page.slice(page.indexOf("let mailboxUsageKey='';"),page.indexOf('function mailPreview(')),ctx);
 vm.runInContext("setMailboxUsageOwner('a');visitMailbox('a@example.test')",ctx);assert.equal(ctx.mailboxUsage['a@example.test'].count,1);
 vm.runInContext("setMailboxUsageOwner('b');visitMailbox('b@example.test')",ctx);assert.equal(ctx.mailboxUsage['a@example.test'],undefined);
 vm.runInContext("setMailboxUsageOwner('a')",ctx);assert.equal(ctx.mailboxUsage['a@example.test'].count,1);assert.equal(ctx.mailboxUsage['b@example.test'],undefined);assert.equal(ctx.mailboxUsage['legacy@example.test'],undefined);assert.equal(JSON.parse(store.get('eona-mailbox-usage'))['legacy@example.test'].count,99);
});
test('fresh demo workspaces never reuse the browser owner namespace of a prior visitor',()=>{
 const ctx={window:{MailProduct:{mode:'demo',workspaceId:'a'.repeat(64)}}};vm.createContext(ctx);
 vm.runInContext(page.slice(page.indexOf('function mailClientOwner('),page.indexOf('function setMailboxUsageOwner(')),ctx);
 const first=vm.runInContext("mailClientOwner('owner@example.test')",ctx);
 ctx.window.MailProduct.workspaceId='b'.repeat(64);
 assert.notEqual(vm.runInContext("mailClientOwner('owner@example.test')",ctx),first);
 ctx.window.MailProduct.mode='personal';assert.equal(vm.runInContext("mailClientOwner('owner@example.test')",ctx),'owner@example.test');
});
test('an expired demo response cannot populate an old browser cache or retry a write',async()=>{
 let reloads=0,clears=0,requestHeaders;
 const ctx={window:{MailProduct:{mode:'demo',workspaceId:'old'}},document:{body:{}},location:{reload:()=>reloads++},mailResources:{clear:()=>clears++},Headers,AbortSignal,
  fetch:async(path,options)=>{requestHeaders=options.headers;return new Response('{}',{status:409,headers:{'X-Mail-Workspace':'new'}})}};
 vm.createContext(ctx);vm.runInContext(page.slice(page.indexOf('async function fetchMailResource('),page.indexOf('// 线性图标')),ctx);
 await assert.rejects(vm.runInContext("fetchMailResource('/api/mail-workspace/drafts/test',{method:'PUT',body:'{}'})",ctx),error=>error.name==='MailWorkspaceChanged');
 assert.equal(requestHeaders.get('X-Mail-Workspace'),'old');assert.equal(reloads,1);assert.equal(clears,1);assert.equal(ctx.document.body.inert,true);
});
