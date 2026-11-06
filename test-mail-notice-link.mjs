import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {testHooks} from './src/index.js';
const html=testHooks().PAGE;
const script='const $=s=>document.querySelector(s);'+html.slice(html.indexOf('function mailClientOwner('),html.indexOf('function setMailboxUsageOwner('))+html.slice(html.indexOf('function show(ok)'),html.indexOf('function fmtTime('))+html.slice(html.indexOf('function createMailFeedbackPresenter('),html.indexOf('\n',html.indexOf('function mailToast(')));
const session=html.slice(html.indexOf("const initialMailIdentity="),html.indexOf('</script>',html.indexOf("const initialMailIdentity=")));
async function page(search,authed=true,failOpen=false,overrides={}){
 const nodes=new Map(),events=[];
 const node=(key)=>{if(!nodes.has(key))nodes.set(key,{style:{},value:'test-password',addEventListener(){}});return nodes.get(key)};
 const context=vm.createContext({URLSearchParams,location:{search},window:{},setInterval(){},alert:s=>events.push(['alert',s]),
  document:{querySelector:node,getElementById:node,addEventListener(){},body:{dataset:{},classList:{remove:s=>events.push(['remove',s])}}},
  setMailboxUsageOwner(){},installMailNavigation:()=>({hasInitial:false,restoreInitial:async()=>{}}),loadMailLayout:async()=>{},loadSide(){},refresh:()=>events.push(['refresh']),loadList:async()=>events.push(['list']),refreshMailSearchOptions(){},openMail:async id=>{events.push(['mail',id]);if(failOpen)throw Error('missing')},EonaUI:{toast:s=>events.push(['alert',s])},mailTools:{setIdentity(){}},MailWorkspace:{setOwner(){}},MailExperience:{setOwner(){}},api:async()=>({authed}),fetch:async p=>({status:200,ok:true,json:async()=>({authed:p==='/api/me'?authed:undefined})}),events,...overrides});
 vm.runInContext(script+session,context);
 await new Promise(resolve=>setImmediate(resolve));
 return {context,events,nodes};
}
test('an authenticated deep link opens the exact mail, including IDs outside the list page',async()=>{
 const p=await page('?mail=7767');assert.deepEqual(structuredClone(p.events),[['list'],['mail','7767']]);
});
test('a logged-out link retains its mail through successful inbox login',async()=>{
 const p=await page('?mail=7767',false);assert.deepEqual(structuredClone(p.events),[]);
 assert.equal(p.nodes.get('#login').style.display,'flex');
 await vm.runInContext('doLogin()',p.context);
 assert.deepEqual(structuredClone(p.events),[['list'],['mail','7767']]);assert.equal(p.nodes.get('#login').style.display,'none');
});
test('invalid, repeated and injection-shaped mail parameters do not open a mail',async()=>{
 for(const search of ['', '?mail=0','?mail=-1','?mail=1.5','?mail=1&mail=2','?mail=1%2Fraw','?mail=%3Cscript%3E','?mail=999999999999999999']){
  const p=await page(search);assert.deepEqual(structuredClone(p.events),[['refresh']],search);
 }
});
test('missing or inaccessible mail returns to inbox with a useful error',async()=>{
 const p=await page('?mail=7767',true,true);
 assert.deepEqual(p.events.map(x=>x[0]),['list','mail','remove','alert']);
 assert.equal(p.nodes.get('#app').style.display,'flex');
});

test('notification reader does not wait for a slow backing list or sidebar',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),events=[];
 const p=await page('?mail=7767',true,false,{loadList:()=>{events.push('list-start');return gate},loadSide:()=>gate,openMail:async id=>events.push('reader-'+id)});
 assert.deepEqual(events,['list-start','reader-7767']);release();
});
test('verified document bootstrap skips the duplicate identity request',async()=>{
 let calls=0;const p=await page('?mail=7767',true,false,{window:{MailInitialIdentity:{authed:true,email:'owner@example.test'}},api:async()=>{calls++;return {authed:true}}});
 assert.equal(calls,0);assert.equal(p.context.window.MailInitialIdentity,undefined);
 assert.deepEqual(structuredClone(p.events),[['list'],['mail','7767']]);
});
test('unverified bootstrap still requires the identity API',async()=>{
 let calls=0;await page('',true,false,{window:{MailInitialIdentity:{authed:false}},api:async()=>{calls++;return {authed:true}}});assert.equal(calls,1);
});


test('public script assets are immutable, ordered and contain no document identity',async()=>{
 const {default:application,mailPageAssetResponse}=await import('./src/index.js');
 const root=await application.fetch(new Request('https://mail.example.test/'),{PUBLIC_HOST:'mail.example.test'}),html=await root.text();
 const paths=[...html.matchAll(/<script defer src="([^"]+)"/g)].map(m=>m[1]);assert.equal(paths.length,4);
 assert.ok(Buffer.byteLength(html)<Buffer.byteLength(testHooks().PAGE)/3);
 for(const path of paths){
  const request=new Request('https://mail.example.test'+path),response=await mailPageAssetResponse(request),code=await response.text();
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/);
  const {createHash}=await import('node:crypto');assert.equal(path,'/assets/mail-page/'+createHash('sha256').update(code).digest('hex')+'.js');
  assert.equal((await mailPageAssetResponse(new Request(request,{headers:{'if-none-match':response.headers.get('etag')}}))).status,304);
  assert.equal((await mailPageAssetResponse(new Request(request,{method:'HEAD'}))).status,200);
  assert.equal((await mailPageAssetResponse(new Request(request,{method:'POST'}))).status,405);
 }
 assert.equal(await mailPageAssetResponse(new Request('https://mail.example.test/assets/mail-page/'+'a'.repeat(64)+'.js')),null);
});
