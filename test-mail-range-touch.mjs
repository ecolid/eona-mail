import {mailListScrollElement,mailCommitListContent} from './src/mail-mobile-view.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mailListActionsBrowserScript} from './src/mail-list-actions.js';

// Minimal DOM/event adapter: run the delivered controller, including its real
// identity slots. The native-scroll model locks after an uncancelled first move.
function fixture(kind="received"){
 const dataKey=name=>name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes=new Map();this.className='';this.style={values:new Map(),setProperty(k,v){this.values.set(k,v)},removeProperty(k){this.values.delete(k)}};this.nodeType=1;this.hidden=false;this.disabled=false;this.offsetLeft=0;this.clientWidth=390;this.scrollTop=0;this.listeners={};this.classList={contains:c=>this.className.split(' ').includes(c),add:c=>{if(!this.classList.contains(c))this.className+=' '+c},remove:c=>{this.className=this.className.split(' ').filter(x=>x!==c).join(' ')},toggle:(c,on)=>{const next=on??!this.classList.contains(c);this.classList[next?'add':'remove'](c);return next}}}
  set innerHTML(value){this._html=value;this.textContent=String(value).replace(/<[^>]*>/g,'')}
  get innerHTML(){return this._html||''}
  append(...nodes){for(const n of nodes){n.remove?.();n.parentElement=this;this.children.push(n)}}
  before(n){const p=this.parentElement;n.remove?.();n.parentElement=p;p.children.splice(p.children.indexOf(this),0,n)}
  remove(){if(this.parentElement){const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null}}
  get offsetHeight(){return this.getBoundingClientRect().height}
  get isConnected(){return !!this.parentElement||this===body}
  setAttribute(k,v){if(k==='class')this.className=String(v);else if(k.startsWith('data-'))this.dataset[dataKey(k)]=String(v);else this.attributes.set(k,String(v))}
  getAttribute(k){return k==='class'?this.className:k.startsWith('data-')?this.dataset[dataKey(k)]??null:this.attributes.get(k)??null}
  hasAttribute(k){return this.getAttribute(k)!==null}
  removeAttribute(k){if(k.startsWith('data-'))delete this.dataset[dataKey(k)];else this.attributes.delete(k)}
  toggleAttribute(k,on){const next=on??!this.hasAttribute(k);if(next)this.setAttribute(k,'');else this.removeAttribute(k);return next}
  matches(selector){return selector.split(',').some(raw=>{const s=raw.trim();if(s==='*')return true;const parts=s.split(/\s+/);if(parts.length>1){const tail=parts.pop();if(!this.matches(tail))return false;return !!this.parentElement?.closest(parts.join(' '))}const tag=s.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;for(const m of s.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;for(const m of s.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)){if(!this.hasAttribute(m[1])||(m[2]!==undefined&&this.getAttribute(m[1])!==m[2]))return false}return s[0]!=='#'||this.id===s.slice(1)})}
  closest(s){for(let n=this;n;n=n.parentElement)if(n.matches(s))return n;return null}
  querySelectorAll(s){return this.children.flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)])}
  querySelector(s){return this.querySelectorAll(s)[0]||null}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)}
  contains(n){return n===this||this.children.some(x=>x.contains(n))}
  getBoundingClientRect(){const row=this===list?null:this.matches('.mail')?this:this.querySelector('.mail');const top=row?100+(Number(row.dataset.fixtureIndex)-1)*100:this===list?56:this.classList.contains('mail-selection-toolbar')?640:0,height=row?100:this===list?644:64;return {x:0,y:top,top,bottom:top+height,left:0,right:390,width:390,height}}
 }
 const body=new Element('body'),root=new Element(),list=new Element('section'),head=new Element(),title=new Element('h1');root.id='app';list.id='list';head.className='mail-workspace-title';title.textContent='收件箱';head.append(title);list.append(head);root.append(list);body.append(root);
 for(let id=1;id<=5;id++){const row=new Element();row.className='mail';row.dataset.fixtureIndex=String(id);row.dataset[{received:'mailId',sent:'sentOpen',draft:'draftOpen',contact:'directoryOpen',source:'directoryOpen'}[kind]]=String(id);const av=new Element(),subject=new Element();av.className='av';subject.className='subj';subject.textContent='邮件'+id;row.append(av,subject);list.append(row)}
 const surfaceListeners=[];const doc={body,documentElement:{clientWidth:390,clientHeight:740},getElementById:id=>id==='list'?list:root,createElement:tag=>new Element(tag),addEventListener(type,fn){if(type==='mail:surface')surfaceListeners.push(fn)},elementFromPoint(x,y){const row=list.querySelectorAll('.mail').find(n=>y>=n.getBoundingClientRect().top&&y<n.getBoundingClientRect().bottom);if(!row)return null;const check=row.parentElement.querySelector('.mail-row-check');return x<53&&y<row.getBoundingClientRect().top+50&&!check?.hidden?check:row.querySelector('.av')}};
 const noop=()=>{},observer=class{observe(){}},frames=new Map();let id=0;
 const context={getComputedStyle:()=>({bottom:'16px'}),document:doc,window:{addEventListener(){},getSelection:()=>({toString:()=>''})},state:{folder:{received:'inbox',sent:'sent',draft:'drafts',contact:'contacts',source:'subscriptions'}[kind]},MailWorkspace:{identityGeneration:1,row:(_,id)=>({id,subject:'邮件'+id}),data:{sources:Array.from({length:5},(_,i)=>({key:String(i+1),included:true})),directory:Array.from({length:5},(_,i)=>({address:String(i+1),name:'联系人'+i,important:false}))}},activeMailPage:{readerPreviews:new Map(Array.from({length:5},(_,i)=>[String(i+1),{subject:'邮件'+(i+1),folder:'inbox'}]))},api:{peek:noop},I:{},EonaUI:{icon:key=>'<svg data-icon="'+key+'"></svg>'},esc:x=>x,mailPageKey:()=> 'inbox',matchMedia:()=>({matches:true}),MutationObserver:observer,ResizeObserver:observer,requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:id=>frames.delete(id)};
 Object.assign(context.window,{requestAnimationFrame:context.requestAnimationFrame,cancelAnimationFrame:context.cancelAnimationFrame});Object.assign(context,{mailListScrollElement,mailCommitListContent});vm.createContext(context);vm.runInContext(mailListActionsBrowserScript()+'\nthis.binding=installMailListActions()',context);
 let nativeLocked=false;
 const fire=(type,points,{target,modelNative=true,cancelable=!nativeLocked}={})=>{const e={touches:points,target:target||doc.elementFromPoint(points.at(-1)?.clientX||100,points.at(-1)?.clientY||150),cancelable,defaultPrevented:false,preventDefault(){if(this.cancelable)this.defaultPrevented=true}};const result=context.binding[type](e,'list');if(type==='end'&&!points.length)nativeLocked=false;if(type==='move'&&modelNative&&!e.defaultPrevented)nativeLocked=true;return {result,prevented:e.defaultPrevented,cancelable:e.cancelable,decision:e.mailGestureDecision}};
 const p=(identifier,x,y)=>({identifier,clientX:x,clientY:y});
 return {binding:context.binding,p,fire,context,surface:()=>surfaceListeners.forEach(fn=>fn()),selected:()=>list.querySelectorAll('.mail-action-row').filter(n=>n.hasAttribute('data-selected')).map(n=>n.querySelector('.mail').dataset.fixtureIndex),enter:()=>list.querySelector('[data-mail-select-toggle]').onclick(),row:id=>list.querySelectorAll('.mail').find(n=>n.dataset.fixtureIndex===id),locked:()=>nativeLocked};
}

test('sequential fingers reserve the first small move before native scrolling can lock',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(17,120,140)]);f.fire('start',[p(17,120,140),p(42,180,150)]);
 assert.equal(f.fire('move',[p(17,120,143),p(42,180,153)]).prevented,true,'the 3px move must remain cancellable until direction resolves');
 assert.equal(f.locked(),false);assert.deepEqual(f.selected(),[]);
 assert.equal(f.fire('move',[p(17,120,340),p(42,180,350)]).prevented,true);assert.deepEqual(f.selected(),['1','2','3']);
 f.fire('end',[]);assert.deepEqual(f.selected(),['1','2','3']);
});
test('two fingers can start on selection circles and keep the first finger anchor across touchstart targets',()=>{
 const f=fixture(),{p}=f;f.enter();f.fire('start',[p(17,31,125)]);const second=f.fire('start',[p(42,31,225),p(17,31,125)],{target:f.row('2').parentElement.querySelector('.mail-row-check')});assert.equal(second.result,true);
 f.fire('move',[p(42,31,425),p(17,31,325)]);assert.deepEqual(f.selected(),['1','2','3'],'the second touch target must not replace the first-row anchor');
 f.binding.cancel();assert.deepEqual(f.selected(),[]);assert.equal(f.binding.selecting,true);
});
test('an already native-owned stream never mutates selection, and a fresh pair still works',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(17,120,140)]);f.fire('move',[p(17,120,170)]);assert(f.locked());f.fire('start',[p(17,120,170),p(42,180,180)]);assert.equal(f.fire('move',[p(17,120,370),p(42,180,380)]).prevented,false);assert.deepEqual(f.selected(),[]);f.fire('end',[]);f.fire('start',[p(3,120,140),p(4,180,140)]);f.fire('move',[p(3,120,143),p(4,180,143)]);f.fire('move',[p(3,120,340),p(4,180,340)]);assert.deepEqual(f.selected(),['1','2','3']);
});
test('an early pinch remains native; a third finger cancels the current range',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140),p(2,180,140)]);assert.equal(f.fire('move',[p(1,115,140),p(2,185,140)]).prevented,false);assert.deepEqual(f.selected(),[]);
 const g=fixture();g.fire('start',[p(1,120,140),p(2,180,140)]);g.fire('move',[p(1,120,340),p(2,180,340)]);assert.deepEqual(g.selected(),['1','2','3']);g.fire('start',[p(1,120,340),p(2,180,340),p(3,220,340)]);assert.deepEqual(g.selected(),[]);
});

test('a cancelled undecided pair leaves selection closed, with no partial range',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140),p(2,180,140)]);assert(f.fire('move',[p(1,120,143),p(2,180,143)]).prevented);assert.equal(f.binding.cancel(),true);assert.deepEqual(f.selected(),[]);assert.equal(f.binding.selecting,false);
});
test('one finger in selection mode keeps native scrolling and never becomes a row swipe',()=>{
 const f=fixture(),{p}=f;f.enter();f.fire('start',[p(1,31,125)]);assert.equal(f.fire('move',[p(1,31,250)]).prevented,false);assert.deepEqual(f.selected(),[]);assert.equal(f.binding.selecting,true);
});
test('a short right swipe closes an already open row, including a start over its quick controls',()=>{
 for(const kind of ['received','sent','draft','contact','source'])for(const surface of ['row','tray']){
  const f=fixture(kind),{p}=f,row=f.row('1'),wrap=row.parentElement;
  f.fire('start',[p(1,240,150)],{target:row});f.fire('move',[p(1,80,150)],{target:row});f.fire('end',[],{target:row});assert(wrap.hasAttribute('data-open'));
  const target=surface==='tray'?wrap.querySelector('.mail-row-tray').children[0]:row;
  f.fire('start',[p(2,220,150)],{target});assert(f.fire('move',[p(2,290,150)],{target}).prevented);f.fire('end',[],{target});
  assert.equal(wrap.hasAttribute('data-open'),false,surface);assert.equal(wrap.style.values.has('--mail-row-x'),false);assert.equal(wrap.querySelector('.mail-row-tray').inert,true);
 }
});
test('staggered movement waits for the second contact rather than dropping a delayed parallel pair',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140)]);f.fire('start',[p(2,180,150),p(1,120,140)]);
 for(const [a,b] of [[12,0],[20,1],[24,4],[28,10]])assert(f.fire('move',[p(1,120,140+a),p(2,180,150+b)]).prevented);
 f.fire('move',[p(1,120,350),p(2,180,340)]);assert.deepEqual(f.selected(),['1','2','3']);f.fire('end',[]);
});

test('an upward range uses the first finger anchor and contracts toward earlier messages',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(17,120,340)]);f.fire('start',[p(17,120,340),p(42,180,350)]);assert(f.fire('move',[p(17,120,337),p(42,180,347)]).prevented);f.fire('move',[p(17,120,140),p(42,180,150)]);assert.deepEqual(f.selected(),['1','2','3']);f.fire('end',[]);assert.deepEqual(f.selected(),['1','2','3']);
});

test('feedback clearance uses the dock layout rather than its animated entry position',()=>{
 const f=fixture();f.enter();assert.equal(f.context.document.body.style.values.get('--mail-selection-toast-bottom'),'92px');
});

// A diagonal opposite movement barely changes Euclidean separation; it is still
// a native two-contact gesture, not a translated range selection.
test('opposite vertical contacts never reserve native movement or flash selection',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,240),p(2,180,240)]);
 for(const [a,b] of [[-3,5],[-12,18],[-20,45]]){const event=f.fire('move',[p(1,120,240+a),p(2,180,240+b)]);assert.equal(event.prevented,false);assert.equal(f.binding.selecting,false);assert.deepEqual(f.selected(),[])}
});
test('a slightly staggered slow pair reserves slop before deciding direction',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140),p(2,180,140)]);assert.equal(f.fire('move',[p(1,120,143),p(2,180,140)]).prevented,true);assert.equal(f.binding.selecting,false);assert.deepEqual(f.selected(),[]);
 for(const amount of [.5,1,3,8,18,110,220]){assert.equal(f.fire('move',[p(1,120,143+amount),p(2,180,140+amount)]).prevented,true)}assert.deepEqual(f.selected(),['1','2','3']);
});
test('a committed translated range stays stable when contacts later separate',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140),p(2,180,140)]);f.fire('move',[p(1,120,340),p(2,180,340)]);assert.deepEqual(f.selected(),['1','2','3']);
 assert(f.fire('move',[p(1,100,300),p(2,200,380)]).prevented);assert.equal(f.binding.selecting,true);assert.deepEqual(f.selected(),['1','2','3']);f.fire('end',[]);assert.deepEqual(f.selected(),['1','2','3']);
});

test('committed selection keeps extending with naturally unequal finger travel and contracts on return',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140),p(2,180,140)]);
 f.fire('move',[p(1,120,240),p(2,180,240)]);assert.deepEqual(f.selected(),['1','2']);
 for(const [a,b] of [[390,360],[500,450],[560,500]])assert.equal(f.fire('move',[p(1,120,a),p(2,180,b)]).prevented,true);
 assert.deepEqual(f.selected(),['1','2','3','4','5'],'unequal same-direction travel must not permanently freeze the initial two rows');
 f.fire('move',[p(2,180,230),p(1,120,260)]);assert.deepEqual(f.selected(),['1','2']);f.fire('end',[]);assert.deepEqual(f.selected(),['1','2']);
});
test('a held divergence can resume parallel selection in the same committed gesture',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140),p(2,180,140)]);f.fire('move',[p(1,120,340),p(2,180,340)]);
 f.fire('move',[p(1,100,300),p(2,200,380)]);assert.deepEqual(f.selected(),['1','2','3']);assert.equal(f.binding.selecting,true);
 f.fire('move',[p(1,100,400),p(2,200,480)]);assert.deepEqual(f.selected(),['1','2','3','4'],'the earlier separation must not latch a permanent suspension');f.fire('end',[]);assert.equal(f.binding.selecting,true);
});

test('sticky header cancellation toggles in place and exits selection without changing scroll',async()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,120,140),p(2,180,140)]);f.fire('move',[p(1,120,340),p(2,180,340)]);f.fire('end',[]);
 const root=f.context.document.getElementById('app'),toolbar=root.querySelector('.mail-selection-toolbar'),toggle=root.querySelector('[data-mail-select-toggle]'),done=toolbar.querySelector('[data-list-action=done]'),list=root.querySelector('#list');
 assert(done);assert.equal(toggle.hidden,false);assert.equal(toggle.textContent,'取消');assert.equal(done.getAttribute('aria-label'),'取消选择，已选 3 封');assert.match(toggle.innerHTML,/data-icon="close"/);assert.equal(toggle.getAttribute('aria-label'),'取消选择');list.scrollTop=210;await toggle.onclick();assert.equal(f.binding.selecting,false);assert.deepEqual(f.selected(),[]);assert.equal(list.scrollTop,210);assert.equal(toggle.hidden,false);assert.equal(toggle.textContent,'选择');assert.match(toggle.innerHTML,/data-icon="check"/);f.enter();assert.deepEqual(f.selected(),[]);
});

test('batch recovery refreshes the authoritative sidebar count after restoring rows',async()=>{
 const f=fixture(),c=f.context;let serverCount=5,cachedCount=5,sidebarCount=5,recovery;
 c.MailWorkspace.load=async fresh=>{if(fresh)cachedCount=serverCount};
 c.loadSide=async()=>{sidebarCount=cachedCount};c.loadList=async()=>{};c.mailRemoveRows=async()=>{};
 c.act=async(id,operation)=>{serverCount+=operation==='restore'?1:-1;return {ok:true}};
 c.mailToast=(message,options)=>{if(options.action)recovery=options.action};
 f.enter();const bar=c.document.body.querySelector('.mail-selection-toolbar');
 await bar.onclick({target:bar.querySelector('[data-list-action=all]')});
 await bar.onclick({target:bar.querySelector('[data-list-action=trash]')});
 assert.equal(serverCount,0);assert.equal(sidebarCount,0);assert.ok(recovery);
 await recovery.run();await Promise.resolve();await Promise.resolve();
 assert.equal(serverCount,5);assert.equal(sidebarCount,5,'restored messages and sidebar must come from the same fresh workspace result');
});

test('successful deletion closes selection before refreshing rows and presenting recovery',async()=>{
 const f=fixture(),c=f.context,phases=[];c.act=async()=>({ok:true});c.mailRemoveRows=async()=>{phases.push('removed')};c.MailWorkspace.load=async()=>{};c.loadSide=async()=>{};
 c.loadList=async()=>{assert.equal(f.binding.selecting,false,'fresh rows must not briefly re-enter selection');phases.push('list')};
 c.mailToast=()=>{assert.equal(c.document.body.querySelector('.mail-selection-toolbar').hidden,true,'the retiring toolbar cannot overlap its replacement');phases.push('feedback')};
 f.enter();const bar=c.document.body.querySelector('.mail-selection-toolbar');await bar.onclick({target:bar.querySelector('[data-list-action=all]')});await bar.onclick({target:bar.querySelector('[data-list-action=trash]')});assert.deepEqual(phases,['removed','list','feedback']);
});

for(const kind of ['received','sent','draft','contact','source'])test(kind+' rows support the same range selection, all toggle and completion lifecycle',async()=>{
 const f=fixture(kind),{p}=f;f.enter();const c=f.context,bar=c.document.body.querySelector('.mail-selection-toolbar');assert.equal(f.binding.selecting,true);assert.equal(c.document.getElementById('list').querySelectorAll('.mail-row-check').filter(n=>!n.hidden).length,5);
 f.fire('start',[p(1,120,140),p(2,180,140)]);f.fire('move',[p(1,120,340),p(2,180,340)]);f.fire('end',[]);assert.deepEqual(f.selected(),['1','2','3']);
 await bar.onclick({target:bar.querySelector('[data-list-action=all]')});assert.equal(f.selected().length,5);await bar.onclick({target:bar.querySelector('[data-list-action=all]')});assert.deepEqual(f.selected(),[]);await f.enter();assert.equal(f.binding.selecting,false);
});

test('contact batch keeps only failures selected, emits one aggregate result, and undo restores each prior flag',async()=>{
 const f=fixture('contact'),c=f.context,writes=[],notices=[];let fail=true,recovery;
 c.MailWorkspace.important=async(value,on,options)=>{writes.push({id:value.address,on,options});if(value.address==='3'&&fail)return false;value.important=on;return true};c.MailWorkspace.load=async()=>{};c.renderMailWorkspace=()=>{};c.loadSide=()=>{};c.mailToast=(message,options)=>{notices.push(message);if(options.action)recovery=options.action};
 f.enter();const bar=c.document.body.querySelector('.mail-selection-toolbar');await bar.onclick({target:bar.querySelector('[data-list-action=all]')});await bar.onclick({target:bar.querySelector('[data-list-action=important]')});
 assert.deepEqual(f.selected(),['3']);assert.equal(notices.length,1);assert.match(notices[0],/4 位.*1 项未完成/);assert.equal(writes.length,5);assert(writes.every(w=>w.options.quiet));assert.equal(f.binding.selecting,true);assert(recovery);fail=false;await recovery.run();assert.equal(c.MailWorkspace.data.directory.filter(v=>v.important).length,0);assert.equal(notices.length,2);
});

test('draft batch confirms the count and retains unsaved or failed drafts without pretending all succeeded',async()=>{
 const f=fixture('draft'),c=f.context,removed=[],notices=[];c.MailWorkspace.row=(_,id)=>({id,rev:1,unsaved:id==='2',subject:'草稿'+id});let confirmation;
 c.EonaUI.confirm=async value=>{confirmation=value;return true};c.MailWorkspace.remove=async value=>{if(value.id==='4')throw Error('changed');removed.push(value.id)};c.MailWorkspace.load=async()=>{};c.renderMailWorkspace=()=>{};c.loadSide=()=>{};c.mailToast=message=>notices.push(message);
 f.enter();const bar=c.document.body.querySelector('.mail-selection-toolbar');await bar.onclick({target:bar.querySelector('[data-list-action=all]')});await bar.onclick({target:bar.querySelector('[data-list-action=discard]')});assert.match(confirmation.title,/5/);assert.deepEqual(removed,['1','3','5']);assert.deepEqual(f.selected(),['2','4']);assert.match(notices[0],/3 封.*2 项未完成/);
});

test('subscription batch removes each stable source key and undo returns the original inclusion state',async()=>{
 const f=fixture('source'),c=f.context,writes=[];let action;
 c.MailWorkspace.sourcePreference=async(key,on,options)=>{writes.push({key,on,options});c.MailWorkspace.data.sources.find(s=>s.key===key).included=on;return true};c.MailWorkspace.load=async()=>{};c.renderMailWorkspace=()=>{};c.loadSide=()=>{};c.mailToast=(_,options)=>{if(options.action)action=options.action};
 f.enter();const bar=c.document.body.querySelector('.mail-selection-toolbar');await bar.onclick({target:bar.querySelector('[data-list-action=all]')});await bar.onclick({target:bar.querySelector('[data-list-action=exclude-source]')});assert.equal(f.binding.selecting,false);assert(writes.every(w=>!w.on&&w.options.quiet));assert.equal(c.MailWorkspace.data.sources.filter(s=>s.included).length,0);await action.run();assert.equal(c.MailWorkspace.data.sources.filter(s=>s.included).length,5);
});

test('sent multi-forward reads all selected messages into one unsent compose and a read failure retains selection',async()=>{
 const f=fixture('sent'),c=f.context;let draft,calls=0,fail=true;
 c.api=async path=>{calls++;if(fail&&path.endsWith('/3'))throw Error('offline');return {message:{subject:'主题 '+path.split('/').at(-1),text_body:'实际正文 '+path.split('/').at(-1)}}};c.openMailCompose=value=>draft=value;c.mailToast=()=>{};
 f.enter();const bar=c.document.body.querySelector('.mail-selection-toolbar');await bar.onclick({target:bar.querySelector('[data-list-action=all]')});await bar.onclick({target:bar.querySelector('[data-list-action=forward]')});assert.equal(draft,undefined);assert.equal(f.selected().length,5);assert.equal(calls,3);
 fail=false;await bar.onclick({target:bar.querySelector('[data-list-action=forward]')});assert.equal(f.binding.selecting,false);assert.match(draft.subject,/5/);for(let n=1;n<=5;n++)assert(draft.body.includes('实际正文 '+n));
});

// The list alone sees downward intent, while the shell cancels the same move
// for its in-progress pull. Intent must not be confused with native scrolling.
test('a second finger takes over an uncommitted shell pull after first-finger movement',()=>{
 for(const kind of ['received','sent','draft','contact','source']){
  const f=fixture(kind),{p}=f;f.fire('start',[p(17,120,140)]);
  assert.equal(f.fire('move',[p(17,120,164)],{modelNative:false}).prevented,false);
  assert.equal(f.fire('start',[p(42,180,172),p(17,120,164)]).result,true);
  f.fire('move',[p(17,120,174),p(42,180,182)]);f.fire('move',[p(17,120,350),p(42,180,358)]);
  assert.deepEqual(f.selected(),['1','2','3'],kind);f.fire('end',[]);
 }
});
test('actual list scrolling retains ownership even if a later touchstart is cancellable',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(17,120,140)]);f.fire('move',[p(17,120,164)],{modelNative:false});
 f.context.document.getElementById('list').scrollTop=24;
 assert.equal(f.fire('start',[p(42,180,172),p(17,120,164)]).result,false);
 f.fire('move',[p(17,120,350),p(42,180,358)]);assert.deepEqual(f.selected(),[]);
});

test('a joining contact retains the original row anchor after a longer shell-owned pull',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(17,120,140)]);f.fire('move',[p(17,120,260)],{modelNative:false});
 f.fire('start',[p(42,180,270),p(17,120,260)]);f.fire('move',[p(17,120,350),p(42,180,360)]);assert.deepEqual(f.selected(),['1','2','3']);
});

// Captured on a physical iPhone: the passive start is not cancellable, but
// the first 4px/2px move is. Later non-cancellable moves are the consequence of
// missing this first arbitration opportunity, not proof it never existed.
for(const kind of ['received','sent','draft','contact','source'])for(const surface of ['row','viewport'])test(kind+' pair admits a non-cancellable start on '+surface+' and reserves the first cancellable move',()=>{
 const f=fixture(kind),{p}=f,target=surface==='viewport'?f.context.document.getElementById('list'):f.row('1');
 f.fire('start',[p(890070908,232,206),p(890070909,313,153)],{target,cancelable:false});
 const first=f.fire('move',[p(890070908,229,210),p(890070909,310,155)],{target});
 assert.equal(first.prevented,true,'claim the actual first cancellable move');assert.equal(f.locked(),false);assert.deepEqual(f.selected(),[]);
 for(const [x1,y1,x2,y2] of [[228,216,309,160],[227,224,307,168],[222,251,301,190],[211,285,290,212],[202,335,279,255],[198,374,274,289],[193,450,267,350],[209,525,272,428]])assert.equal(f.fire('move',[p(890070908,x1,y1),p(890070909,x2,y2)],{target}).prevented,true);
 assert.deepEqual(f.selected(),['2','3','4'],'keep the first contact anchor and extend through the midpoint range');f.fire('end',[],{target});assert.equal(f.binding.selecting,true);
});
test('a pair whose first move is already native-owned never flashes selection',()=>{
 const f=fixture(),{p}=f;f.fire('start',[p(1,232,206),p(2,313,153)],{cancelable:false});
 assert.equal(f.fire('move',[p(1,229,210),p(2,310,155)],{cancelable:false}).prevented,false);assert.equal(f.binding.selecting,false);assert.deepEqual(f.selected(),[]);
});

for(const kind of ['received','sent','draft','contact','source'])test(kind+' selection cancel clears every check and re-enters empty',async()=>{
 const f=fixture(kind),list=f.context.document.getElementById('list'),toggle=list.querySelector('[data-mail-select-toggle]');let dismissed=0;f.context.EonaUI.dismissPopovers=()=>dismissed++;f.enter();assert.equal(dismissed,1);const all=f.context.document.body.querySelector('[data-list-action=all]');await f.context.document.body.querySelector('.mail-selection-toolbar').onclick({target:all});assert.equal(f.selected().length,5);assert.match(toggle.innerHTML,/data-icon="close"/);await toggle.onclick();assert.deepEqual(f.selected(),[]);f.enter();assert.equal(f.binding.selecting,true);assert.deepEqual(f.selected(),[]);
});
test('empty result keeps a disabled selection action in the same heading slot',()=>{
 const f=fixture(),list=f.context.document.getElementById('list');for(const row of list.querySelectorAll('.mail-action-row'))row.remove();list.querySelector('[data-mail-select-toggle]').remove();f.surface();const toggle=list.querySelector('[data-mail-select-toggle]');assert(toggle);assert.equal(toggle.hidden,false);assert.equal(toggle.disabled,true);assert.equal(toggle.textContent,'选择');
});
