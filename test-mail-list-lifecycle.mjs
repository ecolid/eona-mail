import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {testHooks} from './src/index.js';
const page=testHooks().PAGE;
const invalidate=page.slice(page.indexOf('function invalidateMailSearch(){'),page.indexOf('let mailSearchTimer'));
const load=page.slice(page.indexOf('function showMailListFailure(message){'),page.indexOf('async function loadRoutes(){'))+page.slice(page.indexOf('async function loadList(options={}){'),page.indexOf('// 列表一页'));
const more=page.slice(page.indexOf('async function loadMore(){'),page.indexOf("$('#list').addEventListener('scroll'"));
function fixture(){
 const requests=[],notices=[],appended=[],entries=new Map(),events={};
 const tail={textContent:'',insertAdjacentHTML(_where,html){appended.push(html)},append(value){notices.push(value)}};
 const query={value:'old'};
 const attributes=new Map();const list={innerHTML:'',setAttribute(k,v){attributes.set(k,v)},getAttribute:k=>attributes.get(k),querySelector(){return null},querySelectorAll(){return []},prepend(value){if(value.className==='mail-search-pending'||value.className==='mail-results-bar mail-search-pending')return;notices.push(value)}};
 const selection=[],refreshes=[];
 const context={mailAnimateListCommit:(_host,commit)=>{commit();return Promise.resolve()},window:{addEventListener:(name,fn)=>events[name]=fn},activateMailPage(){const key=JSON.stringify([context.state.folder,context.state.q]);if(!entries.has(key))entries.set(key,{markup:''});return entries.get(key)},setMailSelectionPending:(...args)=>selection.push(args),clearMailReader(){context.state.cur=null;context.state.curMail=null;selection.push(['cleared'])},state:{folder:'inbox',q:'old'},document:{body:{classList:{toggle(){}}},createElement(){return {className:'',textContent:'',children:[],setAttribute(k,v){this[k]=v},append(value){this.children.push(value)}}}},refresh:(manual,options)=>{refreshes.push({manual,options});return context.loadList({fresh:manual})},$:key=>key==='#q'?query:key==='#list-tail'?tail:list,esc:String,mailRow:email=>email.subject,listUrl:offset=>context.state.q+':'+offset,mailResultsBar:()=>'',loadMailSettings:()=>{list.innerHTML='settings'},loadRoutes:()=>{list.innerHTML='routes'},api:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))};
 vm.createContext(context);vm.runInContext('let mailListIntent=0,listMore={};const PAGE_SIZE=2;'+invalidate+load+more+page.slice(page.indexOf("window.addEventListener('mail:resource-error'"),page.indexOf('setInterval(()=>',page.indexOf("window.addEventListener('mail:resource-error'"))),context);
 return {refreshes,context,requests,list,tail,notices,appended,query,selection,resourceError:()=>events['mail:resource-error']({detail:{path:context.listUrl(0)}}),invalidate:()=>vm.runInContext('invalidateMailSearch()',context),load:()=>vm.runInContext('loadList()',context),more:()=>vm.runInContext('loadMore()',context)};
}
const emails=subject=>({emails:[{subject},{subject}]});
test('a slower prior search cannot replace the latest visible list',async()=>{
 const s=fixture(),old=s.load();s.context.state.q='latest';const latest=s.load();
 s.requests[1].resolve(emails('latest'));await latest;s.requests[0].resolve(emails('old'));await old;
 assert.match(s.list.innerHTML,/latestlatest/);assert.doesNotMatch(s.list.innerHTML,/oldold/);
});
test('an old pagination response cannot append to a new search or change its cursor',async()=>{
 const s=fixture(),first=s.load();s.requests[0].resolve(emails('old'));await first;
 const more=s.more();assert.equal(s.requests[1].url,'old:2');s.context.state.q='latest';const latest=s.load();s.requests[2].resolve(emails('latest'));await latest;
 s.requests[1].resolve(emails('old-page'));await more;assert.deepEqual(s.appended,[]);
 const next=s.more();assert.equal(s.requests[3].url,'latest:2');s.requests[3].resolve({emails:[]});await next;
});
test('a current list failure preserves content and offers an explicit retry',async()=>{
 const s=fixture(),first=s.load();s.requests[0].resolve(emails('existing'));await first;const before=s.list.innerHTML;
 const refresh=s.load();s.requests[1].reject(Error('offline'));await refresh;
 assert.equal(s.list.innerHTML,before);assert.equal(s.notices[0].role,'alert');assert.equal(s.notices[0].children[0].textContent,'重试');
 const retry=s.notices[0].children[0].onclick();assert.equal(s.requests[2].options.fresh,true);assert.deepEqual(JSON.parse(JSON.stringify(s.refreshes)),[{manual:true,options:{feedback:'inline'}}]);s.requests[2].resolve(emails('recovered'));await retry;assert.match(s.list.innerHTML,/recovered/);
});
test('leaving for settings invalidates a pending list response and its errors',async()=>{
 for(const fail of [false,true]){const s=fixture(),old=s.load();s.context.state.folder='settings';await s.load();if(fail)s.requests[0].reject(Error('late failure'));else s.requests[0].resolve(emails('old'));await old;assert.equal(s.list.innerHTML,'settings');assert.deepEqual(s.notices,[]);}
});
test('pagination failure retains rows and retries only on the explicit action',async()=>{
 const s=fixture(),first=s.load();s.requests[0].resolve(emails('existing'));await first;const before=s.list.innerHTML,more=s.more();s.requests[1].reject(Error('offline'));await more;
 assert.equal(s.list.innerHTML,before);assert.equal(s.notices[0].textContent,'重新加载更多');await s.more();assert.equal(s.requests.length,2);
 const retry=s.notices[0].onclick();assert.equal(s.requests[2].url,'old:2');s.requests[2].resolve(emails('next'));await retry;assert.deepEqual(s.appended,['nextnext']);
});

test('typing invalidates an older response before the debounce starts the next request',async()=>{
 const s=fixture(),old=s.load();s.query.value='latest';s.invalidate();s.requests[0].resolve(emails('old'));await old;assert.equal(s.list.innerHTML,'');
 s.context.state.q='latest';const current=s.load();s.requests[1].resolve(emails('latest'));await current;assert.match(s.list.innerHTML,/latestlatest/);
});

// The archive confirms membership even when the selected row is outside page one.
test('filtering and clearing retain a matching selected mail, unrelated results clear it',async()=>{
 const s=fixture();s.context.state.cur='9';s.context.state.curMail={id:9,subject:'current'};
 let pending=s.load();s.requests[0].resolve({...emails('filtered'),selected_matches:true,selected_email:{id:9,subject:'current'}});await pending;
 assert.equal(s.context.state.cur,'9');assert.deepEqual(s.selection,[[false]]);assert.match(s.list.innerHTML,/data-mail-selection-anchor/);
 s.context.state.q='';pending=s.load();s.requests[1].resolve({...emails('all'),selected_matches:true,selected_email:{id:9,subject:'current'}});await pending;assert.equal(s.context.state.cur,'9');
 s.context.state.q='unrelated';pending=s.load();s.requests[2].resolve({...emails('other'),selected_matches:false});await pending;assert.equal(s.context.state.cur,null);assert.deepEqual(s.selection.at(-1),['cleared']);
});
test('a late selection rejection cannot clear a newer matching query',async()=>{
 const s=fixture();s.context.state.cur='9';const old=s.load();s.context.state.q='latest';const latest=s.load();
 s.requests[1].resolve({...emails('latest'),selected_matches:true});await latest;s.requests[0].resolve({...emails('old'),selected_matches:false});await old;assert.equal(s.context.state.cur,'9');
});

test('returning after selection retains already loaded pages and their cursor',async()=>{
 const s=fixture();let loading=s.load();s.requests[0].resolve({emails:[{id:1,subject:'one'},{id:2,subject:'two'}],total:6});await loading;const more=s.more();s.requests[1].resolve({emails:[{id:3,subject:'three'},{id:4,subject:'four'}],total:6});await more;s.context.state.cur='1';
 loading=s.load();s.requests[2].resolve({emails:[{id:1,subject:'one-updated'},{id:2,subject:'two'}],total:6,selected_matches:true});await loading;
 assert.match(s.list.innerHTML,/onetwo/);assert.deepEqual(s.appended,['threefour']);const next=s.more();assert.equal(s.requests[3].url,'old:4');s.requests[3].resolve({emails:[],total:6});await next;
});


test('resource refresh cannot supersede the foreground request and its visible operation commit',async()=>{
 const s=fixture(),first=s.context.loadList({fresh:true});
 const background=s.context.loadList({background:true});assert.equal(s.requests.length,1,'own resource update must not create a second list owner');
 s.requests[0].resolve(emails('foreground'));await first;await background;assert.match(s.list.innerHTML,/foreground/);
});

test('one foreground failure has one visible owner even when the cache also emits an error',async()=>{
 const s=fixture(),first=s.load();s.requests[0].resolve(emails('existing'));await first;
 const pending=s.load();s.resourceError();assert.equal(s.notices.length,0,'cache must defer while the foreground list is busy');
 s.requests[1].reject(Error('offline'));await pending;assert.equal(s.notices.length,1);assert.equal(s.notices[0].children[0].textContent,'重试');
});

test('failure stays below the fixed heading and uses the existing animated row commit',()=>{
 const s=fixture(),placed=[];const heading={after:n=>placed.push(n)};s.list.querySelector=selector=>selector==='.mail-workspace-title,.mail-results-bar'?heading:null;
 s.context.showMailListFailure('offline');assert.equal(placed.length,1);assert.equal(s.notices.length,0,'failure cannot push the fixed heading down');assert.equal(placed[0].className,'mail-list-error');
});
