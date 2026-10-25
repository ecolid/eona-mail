import test from 'node:test';
import {projectMailRow,projectMailListRow} from './src/mail-reader-preview.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {testHooks} from './src/index.js';
import {mailReaderHeader} from './src/mail-reader-view.js';
import {mailLoadingMarkup} from './src/mail-loading-view.js';
import {mailRemoveRows} from './src/mail-list-actions.js';

test('derived workflow summary is identical in the list preview and complete reader without exposing its text sample',()=>{
 const body='https://github.com/example/project/actions/runs/123456\ncomponent Failed in 38 seconds\n'+('Details follow. '.repeat(400));
 const row={id:1,from_addr:'notifications@github.com',subject:'[example/project] Run failed: Component checks - main (abcdef1)',ai_summary:'Older stored summary',text_body:body};
 const {text_body,...metadata}=row;
 const preview=projectMailListRow({...metadata,body_preview:body.slice(0,240),translation_preview:body.slice(0,3000)}),complete=projectMailRow(row);
 assert.equal(preview.ai_summary,complete.ai_summary);assert.match(preview.ai_summary,/运行 #123456/);assert.match(preview.ai_summary,/失败任务：component/);
 assert.equal('translation_preview'in preview,false);assert.equal('text_body'in preview,false);assert.equal(complete.text_body,body);
});
const page=testHooks().PAGE;
const openStart=page.indexOf('async function openMail(id,push=true){');
const open=page.slice(openStart,page.indexOf('(function mailBodyController',openStart));
const clear=page.slice(page.indexOf('function clearMailReader(){'),page.indexOf('function closeMailReader('));
function fixture(){
 const requests=[],view={innerHTML:'',dataset:{},querySelectorAll:()=>[]},body={classList:{contains:()=>false,add(){},remove(){}}};
 const context={mailStars:{pending:()=>undefined},addEventListener(){},mailLoadingMarkup,mailResources:{update(){}},mailReaderHeader,mailContactOptions:()=>({}),mailReaderIntent:0,mailActionMenu:null,mailBodyDispose:null,mailContactsDispose:null,setMailSelectionPending(){},installMailContactActions:()=>()=>{},state:{cur:null},matchMedia:()=>({matches:false}),history:{state:null},pushMailReaderHistory(){},location:{href:'https://mail.example.test'},mailDrawer:{close(){}},syncMailReader(){},closeMailReader(){},document:{body,getElementById:()=>view,querySelector:()=>null},$:()=>view,api:url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject})),esc:String,I:{},localTime:String,installMailTextLinks:()=>()=>{},installMailTranslation(){},loadList(){},EonaUI:{bindPopover:()=>({dispose(){}})}};
 context.window=context;vm.createContext(context);vm.runInContext(clear+open,context);
 return {context,requests,view,open:id=>vm.runInContext('openMail('+JSON.stringify(id)+')',context),clear:()=>vm.runInContext('clearMailReader()',context)};
}
const mail=id=>({email:{id,subject:'Mail '+id,from_addr:'sender@example.test',attachment_keys:'[]',text_body:'Body '+id}});
test('a cold detail keeps its already known envelope and summary through the pending phase',async()=>{
 const s=fixture(),known={...mail(1).email,from_name:'Known sender',ai_summary:'Known summary',ai_category:'技术资讯',can_translate:true};
 s.context.activeMailPage={readerPreviews:new Map([['1',known]])};
 const pending=s.open('1');assert.match(s.view.innerHTML,/Known sender/);assert.match(s.view.innerHTML,/Known summary/);assert.match(s.view.innerHTML,/全文翻译/);assert.match(s.view.innerHTML,/mail-star" disabled/);assert.doesNotMatch(s.view.innerHTML,/id="back"[^>]*disabled/);
 s.requests[0].resolve({email:known});await pending;assert.match(s.view.innerHTML,/Known summary/);assert.doesNotMatch(s.view.innerHTML,/mail-page-skeleton/);
});
function mobileFixture(){
 const s=fixture(),c=s.context,classes=new Set(),list={scrollTop:410,querySelectorAll:()=>[]},events=[];
 c.matchMedia=()=>({matches:true});c.document.body.classList={contains:name=>classes.has(name),add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n))};
 c.document.getElementById=id=>id==='list'?list:s.view;c.$=selector=>selector==='#list'?list:s.view;
 c.mailListScroll=0;c.history={state:null,pushState(value){this.state=value;events.push(['push',value.eonaMailKind,value.eonaMail])},back(){events.push(['back',classes.has('viewing')]);this.state=null}};
 const helpers=page.slice(page.indexOf('function pushMailReaderHistory('),page.indexOf('function syncMailReader('));
 const close=page.slice(page.indexOf('function closeMailReader('),page.indexOf("window.addEventListener('resize',syncMailReader)"));
 vm.runInContext(helpers+close,c);return {...s,classes,list,events,back:()=>vm.runInContext('returnToMailList()',c)};
}
test('ready, pending and failed readers return immediately without opening the drawer or losing list position',async()=>{
 for(const phase of ['pending','ready','failed']){
  const s=mobileFixture(),reading=s.open('1');assert(s.classes.has('viewing'));assert.deepEqual(s.events,[['push','inbox','1']]);
  if(phase==='ready'){s.requests[0].resolve(mail(1));await reading}
  if(phase==='failed'){s.requests[0].reject(Error('offline'));await reading}
  s.list.scrollTop=5;s.back();assert.equal(s.classes.has('viewing'),false);assert.equal(s.list.scrollTop,410);assert.deepEqual(s.events.at(-1),['back',false]);assert.equal(s.classes.has('sideopen'),false);
  if(phase==='pending'){s.requests[0].resolve(mail(1));await reading;assert.equal(s.classes.has('viewing'),false)}
 }
});
test('sent readers share the same history and return path, including pending failures',async()=>{
 const s=mobileFixture(),c=s.context;c.state.folder='sent';c.sentDispose=null;c.window=c;c.data={sent:[]};c.api.peek=()=>null;
 const sent=page.slice(page.indexOf('window.openMailSent=async'),page.indexOf(' const update=()=>{',page.indexOf('window.openMailSent=async')));
 vm.runInContext(sent,c);
 const loading=c.openMailSent('sent-1');assert(s.classes.has('viewing'));assert.deepEqual(s.events,[['push','sent','sent-1']]);
 s.back();assert.equal(c.state.sentSelected,null);s.requests[0].reject(Error('offline'));await loading;assert.equal(s.classes.has('viewing'),false);assert.deepEqual(s.events.at(-1),['back',false]);
 s.view.dataset.sentID='sent-1';await c.openMailSent('sent-1');assert(s.classes.has('viewing'));s.back();assert.equal(c.state.sentSelected,null);
});
test('native browser history restores the correct inbox or sent reader without another push',()=>{
 const handlers={},actions=[],c={window:{addEventListener(type,handler){handlers[type]=handler}},openMail:(...args)=>actions.push(['inbox',...args]),openMailSent:(...args)=>actions.push(['sent',...args]),closeMailReader:()=>actions.push(['list'])};vm.createContext(c);
 vm.runInContext(page.slice(page.indexOf("window.addEventListener('popstate'"),page.indexOf('const state={')),c);
 handlers.popstate({state:{eonaMail:'1',eonaMailKind:'inbox'}});handlers.popstate({state:{eonaMail:'sent-1',eonaMailKind:'sent'}});handlers.popstate({state:{}});
 assert.deepEqual(actions,[['inbox','1',false],['sent','sent-1',false],['list']]);
});
test('changing query clears old desktop content and rejects a late detail response',async()=>{
 const s=fixture(),old=s.open('1');s.clear();s.requests[0].resolve(mail(1));await old;
 assert.equal(s.context.state.cur,null);assert.match(s.view.innerHTML,/选择一封邮件/);assert.doesNotMatch(s.view.innerHTML,/Mail 1/);
});
test('same-id retries use the latest request identity, not just matching mail id',async()=>{
 const s=fixture(),old=s.open('1'),current=s.open('1');s.requests[1].resolve(mail(1));await current;
 const rendered=s.view.innerHTML;s.requests[0].resolve({email:{...mail(1).email,subject:'stale detail'}});await old;
 assert.equal(s.view.innerHTML,rendered);assert.match(rendered,/Mail 1/);
});

test('switching to an incompatible folder or star view clears the previous reader before its list request',()=>{
 const prepare=page.slice(page.indexOf('function prepareMailSelection(){'),page.indexOf('function clearMailReader(){'));
 const c={state:{folder:'trash',q:'',cur:1,curMail:{id:1,folder:'inbox'}},cleared:0,parseMailQuery:q=>q?[{field:'in',value:'any'}]:[],clearMailReader(){c.cleared++}};vm.createContext(c);vm.runInContext(prepare,c);
 vm.runInContext('prepareMailSelection()',c);assert.equal(c.cleared,1);c.state.q='in:any';vm.runInContext('prepareMailSelection()',c);assert.equal(c.cleared,1);c.state.folder='inbox';c.state.q='';c.state.starred=true;vm.runInContext('prepareMailSelection()',c);assert.equal(c.cleared,2);c.state.curMail.is_starred=1;vm.runInContext('prepareMailSelection()',c);assert.equal(c.cleared,2);
});

test('navigation cleanup and desktop reading preserve list scroll; mobile back restores its own reading origin',()=>{
 const source=page.slice(page.indexOf('function closeMailReader('),page.indexOf("window.addEventListener('resize',syncMailReader)"));
 for(const [mobile,restore,expected]of [[false,true,500],[true,false,500],[true,true,40]]){let reading=true;const list={scrollTop:500},c={mailReaderIntent:0,state:{sentSelected:'sent-1'},matchMedia:()=>({matches:mobile}),document:{body:{classList:{contains:()=>reading,remove(){reading=false}}},getElementById:()=>list},mailListScroll:40,syncMailReader(){}};vm.createContext(c);vm.runInContext(source,c);c.closeMailReader(restore);assert.equal(list.scrollTop,expected);if(mobile&&restore)assert.equal(c.state.sentSelected,null)}
});

function folderActionFixture(){
 const requests=[],feedback=[],cleared=[],listReads=[];
 const ctx={Map,Promise,document:{querySelectorAll:()=>[]},state:{cur:'1'},mailPages:new Map(),mailStars:{set(){}},api:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject})),$:()=>({querySelectorAll:()=>[]}),clearMailReader(){cleared.push(ctx.state.cur);ctx.state.cur=null},loadList:async value=>{listReads.push(value)},MailWorkspace:{load:async()=>{}},loadSide:async()=>{},mailToast:(message,options)=>feedback.push({message,options})};
 vm.createContext(ctx);vm.runInContext(mailRemoveRows.toString()+page.slice(page.indexOf('const mailFolderWrites='),page.indexOf('// 2026-09-02:上面那些按钮')),ctx);
 return {ctx,requests,feedback,cleared,listReads,act:(id,op)=>ctx.act(id,op)};
}
test('deletion feedback waits for storage and undo restores the same mail without reopening another reader',async()=>{
 const f=folderActionFixture(),first=f.act(1,'trash'),duplicate=f.act(1,'trash');assert.equal(f.requests.length,1);assert.equal(f.feedback.length,0);
 f.ctx.state.cur='2';f.requests[0].resolve({ok:true});await Promise.all([first,duplicate]);assert.deepEqual(f.cleared,[]);assert.equal(f.feedback.length,1);assert.equal(f.feedback[0].message,'邮件已移入垃圾箱');
 assert.equal(f.feedback[0].options.action.label,'恢复邮件');const undo=f.feedback[0].options.action.run();assert.equal(f.requests[1].path,'/api/email/1/restore');f.requests[1].resolve({ok:true});await undo;assert.equal(f.feedback.at(-1).message,'邮件已恢复到收件箱');assert.equal(f.feedback.at(-1).options.action,undefined);assert.equal(f.ctx.state.cur,'2');assert.equal(f.listReads.length,2);
});
test('failed deletion preserves the reader and produces an error without an undo for a nonexistent change',async()=>{
 const f=folderActionFixture(),pending=f.act(1,'trash');f.requests[0].reject(Error('offline'));await pending;assert.equal(f.ctx.state.cur,'1');assert.equal(f.listReads.length,0);assert.equal(f.feedback.length,1);assert.equal(f.feedback[0].options.tone,'error');assert.equal(f.feedback[0].options.action,undefined);
});
