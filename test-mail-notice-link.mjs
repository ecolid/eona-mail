import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {testHooks} from './src/index.js';
const html=testHooks().PAGE;
const script='const $=s=>document.querySelector(s);'+html.slice(html.indexOf('function mailClientOwner('),html.indexOf('function setMailboxUsageOwner('))+html.slice(html.indexOf('function show(ok)'),html.indexOf('function fmtTime('))+html.slice(html.indexOf('function createMailFeedbackPresenter('),html.indexOf('\n',html.indexOf('function mailToast(')));
const session=html.slice(html.indexOf("api('/api/me').then"),html.indexOf('</script>',html.indexOf("api('/api/me').then")));
async function page(search,authed=true,failOpen=false){
 const nodes=new Map(),events=[];
 const node=(key)=>{if(!nodes.has(key))nodes.set(key,{style:{},value:'test-password',addEventListener(){}});return nodes.get(key)};
 const context=vm.createContext({URLSearchParams,location:{search},window:{},setInterval(){},alert:s=>events.push(['alert',s]),
  document:{querySelector:node,getElementById:node,addEventListener(){},body:{dataset:{},classList:{remove:s=>events.push(['remove',s])}}},
  setMailboxUsageOwner(){},installMailNavigation:()=>({hasInitial:false,restoreInitial:async()=>{}}),loadMailLayout:async()=>{},loadSide(){},refresh:()=>events.push(['refresh']),openMail:async id=>{events.push(['mail',id]);if(failOpen)throw Error('missing')},EonaUI:{toast:s=>events.push(['alert',s])},mailTools:{setIdentity(){}},MailWorkspace:{setOwner(){}},MailExperience:{setOwner(){}},api:async()=>({authed}),fetch:async p=>({status:200,ok:true,json:async()=>({authed:p==='/api/me'?authed:undefined})}),events});
 vm.runInContext(script+session,context);
 await new Promise(resolve=>setImmediate(resolve));
 return {context,events,nodes};
}
test('an authenticated deep link opens the exact mail, including IDs outside the list page',async()=>{
 const p=await page('?mail=7767');assert.deepEqual(structuredClone(p.events),[['refresh'],['mail','7767']]);
});
test('a logged-out link retains its mail through successful inbox login',async()=>{
 const p=await page('?mail=7767',false);assert.deepEqual(structuredClone(p.events),[]);
 assert.equal(p.nodes.get('#login').style.display,'flex');
 await vm.runInContext('doLogin()',p.context);
 assert.deepEqual(structuredClone(p.events),[['refresh'],['mail','7767']]);assert.equal(p.nodes.get('#login').style.display,'none');
});
test('invalid, repeated and injection-shaped mail parameters do not open a mail',async()=>{
 for(const search of ['', '?mail=0','?mail=-1','?mail=1.5','?mail=1&mail=2','?mail=1%2Fraw','?mail=%3Cscript%3E','?mail=999999999999999999']){
  const p=await page(search);assert.deepEqual(structuredClone(p.events),[['refresh']],search);
 }
});
test('missing or inaccessible mail returns to inbox with a useful error',async()=>{
 const p=await page('?mail=7767',true,true);
 assert.deepEqual(p.events.map(x=>x[0]),['refresh','mail','remove','alert']);
 assert.equal(p.nodes.get('#app').style.display,'flex');
});
