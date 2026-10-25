import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {testHooks} from './src/index.js';
const page=testHooks().PAGE;
const source=page.slice(page.indexOf('function refresh(manual='),page.indexOf("window.addEventListener('mail:resource'"));
function fixture(){
 let key='inbox',alert=null,finish;const calls=[],toasts=[],button={disabled:false,setAttribute(k,v){this[k]=v}},list={querySelectorAll:()=>[{dataset:{mailId:'1'}}],querySelector:()=>alert};
 const context={Promise,state:{folder:'inbox'},mailPageKey:()=>key,$:s=>s==='#mail-refresh'?button:list,refreshMailSearchOptions(){},mailResources:{invalidate(){calls.push('invalidate')}},MailExperience:{refreshStarted(){calls.push('motion:start')},refreshFinished(){calls.push('motion:finish')}},MailWorkspace:{load(){calls.push('workspace');return Promise.resolve()}},loadSide:async()=>{calls.push('side')},loadList(){calls.push('list');return new Promise((resolve,reject)=>finish={resolve,reject})},EonaUI:{toast:(...args)=>{toasts.push(args);return {dismiss:()=>calls.push('notice:dismiss')}}}};
 const presenter=page.slice(page.indexOf('function createMailFeedbackPresenter('),page.indexOf('\n',page.indexOf('function mailToast(')));
 vm.createContext(context);vm.runInContext("let mailRefreshPending=null,mailRefreshFeedback='toast',mailRefreshNotice=null,mailRefreshAttempt=0;"+presenter+source,context);
 return {calls,toasts,button,folder:value=>context.state.folder=value,refresh:(feedback,manual=true)=>vm.runInContext('refresh('+manual+','+JSON.stringify({feedback})+')',context),flush:()=>new Promise(setImmediate),finish:value=>finish.resolve(value),fail:()=>finish.reject(Error('offline')),navigate:()=>key='contacts',alert:()=>alert={textContent:'网络中断 重试'}};
}
test('pull refresh returns a result and leaves all feedback to the inline owner',async()=>{const f=fixture(),p=f.refresh('pull');assert(f.button.disabled);await f.flush();f.finish({ok:true,ids:['1','2']});assert.equal((await p).message,'列表新增 1 封邮件');assert.deepEqual(f.toasts,[]);assert.equal(f.button.disabled,false);assert.equal(f.calls.filter(x=>x==='motion:start').length,1);assert.equal(f.calls.at(-1),'motion:finish')});
test('joining initial loading does not present initially loaded rows as new mail',async()=>{const f=fixture(),p=f.refresh('toast',false);await f.flush();assert.equal(f.refresh('pull'),p);f.finish({ok:true,ids:['1','2']});assert.equal((await p).message,'刷新完成');assert.deepEqual(f.toasts,[])});
test('button refresh emits one completion toast and merging into a pull transfers feedback ownership',async()=>{
 const f=fixture(),p=f.refresh('toast');await f.flush();const joined=f.refresh('pull');assert.equal(p,joined);f.finish({ok:true,ids:['1']});await p;assert.equal(f.calls.filter(x=>x==='list').length,1);assert.deepEqual(f.toasts,[]);
 const g=fixture(),q=g.refresh('toast');await g.flush();g.finish({ok:true,ids:['1']});await q;assert.equal(g.toasts.length,1);assert.equal(g.toasts[0][0],'暂无新邮件');assert.equal(g.toasts[0][1].tone,'success');assert.equal(g.toasts[0][1].variant,'card');
});
test('a persistent list error owns failure feedback and no success or extra toast appears',async()=>{const f=fixture(),p=f.refresh('toast');await f.flush();f.alert();f.finish();const result=await p;assert.equal(result.ok,false);assert.equal(result.presented,true);assert.deepEqual(f.toasts,[]);assert.equal(f.button.disabled,false)});
test('failed refresh resets busy state; navigation cancels old result feedback',async()=>{
 const f=fixture(),p=f.refresh('pull');await f.flush();f.fail();assert.equal((await p).ok,false);assert.equal(f.button.disabled,false);
 const g=fixture(),q=g.refresh('toast');await g.flush();g.navigate();g.finish({ok:true,ids:['1']});assert.equal((await q).cancelled,true);assert.deepEqual(g.toasts,[]);assert.equal(g.button.disabled,false);
});
test('settings refresh owns its completion message for both preserved and remounted forms',async()=>{
 for(const value of [{ok:true},undefined]){const f=fixture();f.folder('settings');const pending=f.refresh('toast');await f.flush();f.finish(value);assert.equal((await pending).message,'已刷新');assert.equal(f.toasts.length,1);assert.equal(f.toasts[0][0],'已刷新');assert.equal(f.button.disabled,false)}
});
test('each completed manual refresh performs a fresh read and presents its own completion event',async()=>{
 const f=fixture();
 for(let i=0;i<3;i++){const pending=f.refresh('toast');await f.flush();f.finish({ok:true,ids:['1']});await pending;assert.equal(f.toasts.length,i+1);assert.equal(f.toasts[i][0],'暂无新邮件')}
 assert.equal(f.calls.filter(x=>x==='invalidate').length,3);assert.equal(f.calls.filter(x=>x==='list').length,3);assert.equal(f.calls.filter(x=>x==='notice:dismiss').length,2);assert.equal(new Set(f.toasts.map(([,options])=>options.id)).size,1);
});

test('a fresh attempt retires its prior success even when failure is owned by the list',async()=>{
 const f=fixture();let p=f.refresh('toast');await f.flush();f.finish({ok:true,ids:['1']});await p;assert.equal(f.toasts.length,1);
 p=f.refresh('toast');assert.equal(f.calls.filter(x=>x==='notice:dismiss').length,1,'retire stale success at the next start');await f.flush();f.alert();f.finish();assert.equal((await p).presented,true);assert.equal(f.toasts.length,1,'the inline failure owns the new result');
});

test('inline retry refreshes workspace, sidebar and list without a second completion surface',async()=>{
 const f=fixture(),pending=f.refresh('inline');await f.flush();assert.equal(f.calls.filter(x=>x==='workspace').length,1);assert.equal(f.calls.filter(x=>x==='side').length,1);assert.equal(f.calls.filter(x=>x==='list').length,1);f.finish({ok:true,ids:['1']});await pending;assert.deepEqual(f.toasts,[]);assert.equal(f.button.disabled,false);
});
