import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMailMobileGestures,mailGestureIntent,bindMailReaderSurface} from './src/mail-mobile-view.js';
import {mailLoadingMarkup} from './src/mail-loading-view.js';

function fixture({mode='list',pull=true,scroll=0,horizontal=false,excluded=false,selection='',mask=false,readerLeft=0,primaryRow=false,directoryRow=false,nativePanModel=false,releaseInside=true,listActions}={}){
 const listeners={},capture={},windowCapture={},windowEvents={},actions=[],styles={},frames=new Map(),timers=new Map();let time=0,overlay=false,finish,next=0,nativeLocked=false;
 const label={textContent:''},indicator={hidden:true,dataset:{},style:{setProperty(){}},setAttribute(){},querySelector(){return label},remove(){}};
 const root={contains:()=>false,dataset:{},style:{setProperty(k,v){styles[k]=v},removeProperty(k){delete styles[k]}},append(){},addEventListener(name,fn){listeners[name]=fn}},panel={scrollTop:scroll,parentElement:root,scrollWidth:horizontal?600:300,clientWidth:300};
 const target={isConnected:true,disabled:false,click(){click(0)},contains:node=>node===target,parentElement:panel,scrollTop:0,closest(selector){if(selector==='#side,#view,#list,#mask')return mask?{id:'mask'}:panel;if(primaryRow&&(selector==='button,a'||selector.startsWith('.mail-open')))return this;if(directoryRow&&(selector==='button,a'||selector.includes('#list .mail-directory-row')))return this;return excluded?{}:null}};
 const navigation={getBoundingClientRect:()=>({width:300,right:root.dataset.mailDrawerDrag!==undefined?300+parseFloat(styles['--mail-drawer-x']||0):mode==='navigation'?300:0})};
 const doc={elementFromPoint:()=>releaseInside?target:null,addEventListener(name,fn,options){assert(options.capture);(capture[name]??=[]).push(fn)},getElementById(){return {getBoundingClientRect:()=>({top:56})}},createElement(){return indicator},querySelector(){return overlay?{}:null},documentElement:{clientWidth:390,dataset:{}}};
 const win={addEventListener(name,fn,options){(windowEvents[name]??=[]).push(fn);if(options?.capture)(windowCapture[name]??=[]).push(fn)},matchMedia(){return {matches:true,addEventListener(){}}},getSelection:()=>({toString:()=>selection}),getComputedStyle:node=>({overflowX:horizontal&&node===panel?'auto':'visible'}),performance:{now:()=>time},requestAnimationFrame(fn){frames.set(++next,fn);return next},cancelAnimationFrame(id){frames.delete(id)},setTimeout(fn){timers.set(++next,fn);return next},clearTimeout(id){timers.delete(id)}};
 const reader={getBoundingClientRect:()=>({width:390,left:readerLeft})};
 const binding=bindMailMobileGestures({root,navigation,reader,listActions,document:doc,window:win,mode:()=>mode,canRefresh:()=>pull,openNavigation:()=>{actions.push('open-navigation');mode='navigation'},closeNavigation:()=>{actions.push('close-navigation');mode='list'},back:()=>{actions.push('back-reader');mode='list'},refresh:()=>{actions.push('refresh');return new Promise(resolve=>finish=resolve)}});
 function event(type,x=150,y=200,n=1,elapsed=50){time+=elapsed;let prevented=false;const e={target,touches:Array.from({length:n},()=>({clientX:x,clientY:y})),cancelable:nativePanModel?(type==='touchstart'?false:!nativeLocked):true,preventDefault(){if(this.cancelable)prevented=true}};(capture[type]||[]).forEach(fn=>fn(e));listeners[type]?.(e);if(nativePanModel&&type==='touchmove'&&!prevented)nativeLocked=true;if(type==='touchend'&&!n)nativeLocked=false;return prevented}
 function click(detail=1,elapsed=10){time+=elapsed;let prevented=false,stopped=false;const event={detail,preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}};for(const fn of [...windowCapture.click||[],...capture.click||[]]){if(stopped)break;fn(event)}if(!stopped)actions.push('activate');return prevented}
 const frame=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn())};
 function swipe(dx,dy=0,elapsed=50){event('touchstart');event('touchmove',150+dx,200+dy,1,elapsed);frame();return event('touchend')}
 return {actions,event,click,swipe,frame,blur:()=>windowEvents.blur?.forEach(fn=>fn()),styles,root,indicator,label,binding,earlyCapture:fn=>(capture.click??=[]).unshift(fn),finish:result=>finish?.(result),settle:()=>{const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn())},overlay:value=>overlay=value,mode:value=>mode=value,select:value=>selection=value};
}
test('a held press and initial finger jitter never claim the following vertical scroll',()=>{
 for(const mode of ['list','reader','navigation'])for(const dy of [-90,90]){
  const f=fixture({mode,scroll:120,pull:false});f.event('touchstart');
  assert.equal(f.event('touchmove',157,202,1,900),false,'7px horizontal drift remains native');
  assert.equal(f.event('touchmove',158,200+dy),false,'vertical scroll is not canceled');
  f.event('touchend');assert.deepEqual(f.actions,[]);assert.equal(f.click(),true,'native scroll release is not a new tap');f.event('pointerdown');assert.equal(f.click(),false);
 }
 for(const [x,y] of [[10,2],[8,11],[17,14]])assert.equal(mailGestureIntent(x,y,'list',true),'');
});
test('the native keyboard row opener remains the list gesture surface, while nested controls retain ownership',()=>{
 const row=fixture({primaryRow:true});assert(row.swipe(120));assert.deepEqual(row.actions,['open-navigation']);
 const scrolling=fixture({primaryRow:true,scroll:120,pull:false});scrolling.event('touchstart');assert.equal(scrolling.event('touchmove',158,290),false);assert.deepEqual(scrolling.actions,[]);
 const control=fixture({excluded:true});control.swipe(120);assert.deepEqual(control.actions,[]);
});
test('right swipe follows the visible hierarchy: reader back, list drawer, open drawer close',()=>{
 for(const [mode,dx,expected] of [['list',100,'open-navigation'],['reader',100,'back-reader'],['navigation',-100,'close-navigation']]){const f=fixture({mode});assert(f.swipe(dx));assert.deepEqual(f.actions,[expected])}
 for(const mode of ['list','reader']){const f=fixture({mode});f.swipe(-100);assert.deepEqual(f.actions,[])}
 for(const dx of [-100,100]){const f=fixture({mode:'editor'});f.swipe(dx);assert.deepEqual(f.actions,[])}
});
test('reading drag follows the finger, reverses and cancels without moving the drawer',()=>{
 const f=fixture({mode:'reader'});f.event('touchstart');f.event('touchmove',220);f.frame();assert.equal(f.styles['--mail-reader-x'],'70px');assert.equal(f.root.dataset.mailDrawerDrag,undefined);assert.deepEqual(f.actions,[]);
 f.event('touchmove',180,200,1,300);f.frame();assert.equal(f.styles['--mail-reader-x'],'30px');f.event('touchend');assert.deepEqual(f.actions,[]);assert.equal(f.root.dataset.mailReaderDrag,undefined);
 const canceled=fixture({mode:'reader'});canceled.event('touchstart');canceled.event('touchmove',300);canceled.frame();canceled.event('touchcancel');assert.deepEqual(canceled.actions,[]);assert.equal(canceled.root.dataset.mailReaderDrag,undefined);
 const slow=fixture({mode:'reader'});slow.swipe(120,0,1600);assert.deepEqual(slow.actions,['back-reader']);
});
test('reader return consumes its compatibility click and a later tap works immediately',()=>{
 const f=fixture({mode:'reader'});f.swipe(120);assert(f.click());assert.deepEqual(f.actions,['back-reader']);f.event('pointerdown');assert.equal(f.click(),false);
});
test('return during reader entrance starts from its current position instead of jumping backward',()=>{
 const f=fixture({mode:'reader',readerLeft:350});f.event('touchstart');f.event('touchmove',170,200,1,500);f.frame();assert.equal(f.styles['--mail-reader-x'],'370px');f.event('touchmove',200,200,1,500);f.frame();assert.equal(f.styles['--mail-reader-x'],'390px');f.event('touchend');assert.deepEqual(f.actions,['back-reader']);
});
test('only a top-level list refreshes, even when another surface reports refresh capability',()=>{
 for(const mode of ['reader','navigation','editor']){assert.equal(mailGestureIntent(0,110,mode,true),'ignore');const f=fixture({mode});f.swipe(0,110);assert.deepEqual(f.actions,[])}
});
test('a pending list refresh cannot block return from a newly opened reader',async()=>{
 const f=fixture();f.swipe(0,110);await Promise.resolve();f.mode('reader');f.event('mail:surface');f.swipe(120);assert.deepEqual(f.actions,['refresh','back-reader']);f.finish({ok:true});await new Promise(setImmediate);assert.equal(f.indicator.hidden,true);
});
test('drawer and dimming follow every animation frame before release, including reversal',()=>{
 const f=fixture();f.event('touchstart');f.event('touchmove',180);f.frame();assert.equal(f.styles['--mail-drawer-x'],'-270px');assert.equal(f.styles['--mail-drawer-progress'],'0.1');assert.deepEqual(f.actions,[]);
 f.event('touchmove',270);f.frame();assert.equal(f.styles['--mail-drawer-x'],'-180px');f.event('touchmove',240);f.frame();assert.equal(f.styles['--mail-drawer-x'],'-210px');assert.deepEqual(f.actions,[]);
 f.event('touchend');assert.deepEqual(f.actions,['open-navigation']);f.frame();assert.equal(f.root.dataset.mailDrawerDrag,undefined);
});
test('a close gesture can start on the whole backdrop, not only inside the drawer',()=>{
 const f=fixture({mode:'navigation',mask:true});f.event('touchstart',350);f.event('touchmove',230);f.frame();assert.equal(f.styles['--mail-drawer-x'],'-120px');f.event('touchend');assert.deepEqual(f.actions,['close-navigation']);
});
test('drawer release consumes compatibility clicks before mail, draft and navigation activation',()=>{
 for(const options of [{mode:'navigation'},{mode:'navigation',mask:true},{mode:'list'}]){
  const f=fixture(options);f.swipe(options.mode==='navigation'?-100:100);f.frame();assert(f.click());assert(f.click());assert.deepEqual(f.actions,[options.mode==='navigation'?'close-navigation':'open-navigation']);
  // A new real tap need not wait for the compatibility-click deadline.
  f.event('pointerdown');f.event('touchstart');f.event('touchend');assert.equal(f.click(),false);assert.equal(f.actions.at(-1),'activate');
 }
});
test('canceled, short and slow owned gestures also consume their release click, while keyboard and expiry work',()=>{
 for(const end of ['touchend','touchcancel']){const f=fixture({mode:'navigation'});f.event('touchstart');f.event('touchmove',130);f.event(end,130,200,0,2000);assert(f.click());assert.deepEqual(f.actions,[]);assert.equal(f.click(0),false);assert.equal(f.click(1,800),false)}
 const plain=fixture();plain.event('touchstart');plain.event('touchend');assert.equal(plain.click(),false);
 const disposed=fixture();disposed.swipe(100);disposed.binding.dispose();assert.equal(disposed.click(),false);
});
test('short or canceled drags snap back; a slow deliberate drag has no arbitrary time cutoff',()=>{
 for(const [x,y] of [[3,0],[20,0],[70,65],[0,-100]]){const f=fixture();f.swipe(x,y,300);assert.deepEqual(f.actions,[])}
 const slow=fixture();slow.swipe(120,0,1600);assert.deepEqual(slow.actions,['open-navigation']);
 const canceled=fixture();canceled.event('touchstart');canceled.event('touchmove',270);canceled.frame();canceled.event('touchcancel');canceled.frame();assert.deepEqual(canceled.actions,[]);assert.equal(canceled.root.dataset.mailDrawerDrag,undefined);
});
test('pull-to-refresh moves the content immediately, holds one request and settles on completion',async()=>{
 const f=fixture();f.event('touchstart');assert(f.event('touchmove',150,240));f.frame();assert.equal(f.styles['--mail-pull-y'],'22px');assert.equal(f.label.textContent,'下拉刷新');assert.deepEqual(f.actions,[]);
 f.event('touchmove',150,300);f.frame();assert.equal(f.label.textContent,'松开刷新');f.event('touchend');await Promise.resolve();assert.deepEqual(f.actions,['refresh']);assert.equal(f.label.textContent,'正在刷新');f.swipe(0,100);assert.deepEqual(f.actions,['refresh']);f.finish({ok:true,message:'暂无新邮件'});await new Promise(setImmediate);assert.equal(f.label.textContent,'暂无新邮件');assert.equal(f.indicator.dataset.phase,'complete');assert.equal(f.styles['--mail-pull-y'],'44px');f.settle();assert.equal(f.styles['--mail-pull-y'],'0px');assert.equal(f.root.dataset.mailPull,'settling');f.settle();assert.equal(f.root.dataset.mailPull,undefined);
 for(const options of [{scroll:20},{pull:false}]){const g=fixture(options);g.swipe(0,150);assert.deepEqual(g.actions,[])}
});
test('pull completion keeps one inline result; leaving the surface prevents stale feedback resurrection',async()=>{
 const failed=fixture();failed.swipe(0,110);await Promise.resolve();failed.finish({ok:false,message:'刷新失败，请重试'});await new Promise(setImmediate);assert.equal(failed.label.textContent,'刷新失败，请重试');assert.equal(failed.indicator.hidden,false);failed.settle();failed.settle();assert.equal(failed.indicator.hidden,true);
 const changed=fixture();changed.swipe(0,110);await Promise.resolve();changed.event('mail:surface');assert.equal(changed.root.dataset.mailPull,undefined);changed.finish({ok:true,message:'旧页完成'});await new Promise(setImmediate);assert.equal(changed.indicator.hidden,true);assert.equal(changed.root.dataset.mailPull,undefined);
});
test('a below-threshold pull settles without a refresh or a stray click',()=>{
 const f=fixture();f.event('touchstart');f.event('touchmove',150,245);f.frame();assert(f.event('touchend'));assert.deepEqual(f.actions,[]);assert.equal(f.root.dataset.mailPull,'settling');f.settle();assert.equal(f.indicator.hidden,true);
});
test('a refresh completing after disposal cannot restore a removed drag surface',async()=>{
 const f=fixture();f.swipe(0,110);await Promise.resolve();f.binding.dispose();f.finish();await new Promise(setImmediate);assert.equal(f.root.dataset.mailPull,undefined);assert.equal(f.root.dataset.mailDrawerDrag,undefined);
});
test('browser edges, nested horizontal scroll, controls, selection and open modals keep ownership',()=>{
 for(const options of [{horizontal:true},{excluded:true},{selection:'selected text'}]){const f=fixture(options);f.swipe(100);assert.deepEqual(f.actions,[])}
 for(const x of [5,385]){const f=fixture();f.event('touchstart',x);f.event('touchmove',x+90);f.event('touchend');assert.deepEqual(f.actions,[])}
 const f=fixture();f.overlay(true);f.swipe(100);assert.deepEqual(f.actions,[]);
});
test('multitouch, changed page state and selection cancel the drag and its pending paints',()=>{
 for(const reason of ['second-touch','mode-change','selection']){const f=fixture();f.event('touchstart');f.event('touchmove',270);if(reason==='second-touch')f.event('touchmove',240,200,2);if(reason==='mode-change'){f.mode('navigation');f.event('touchmove',240)}if(reason==='selection'){f.select('text');f.event('touchmove',240)}f.frame();f.event('touchend');assert.deepEqual(f.actions,[]);assert.equal(f.root.dataset.mailDrawerDrag,undefined)}
});
test('a new drag supersedes the previous release frame and disposal cancels every paint',()=>{
 const f=fixture();f.swipe(120);f.event('touchstart');f.event('touchmove',50);f.frame();assert.equal(f.styles['--mail-drawer-x'],'-280px');f.binding.dispose();f.frame();assert.equal(f.root.dataset.mailDrawerDrag,undefined);assert.equal(f.root.dataset.mailPull,undefined);
});
test('pending pages reuse the real heading and row owners instead of an independently sized loading page',()=>{
 for(const kind of ['messages','contacts','settings','reader']){const markup=mailLoadingMarkup(kind,'标题 <example>');assert.doesNotMatch(markup,/<script|style="|animation:/);assert.match(markup,/role="status"/);assert.match(markup,/标题 &lt;example>/);assert.match(markup,kind==='settings'?/mail-settings-page/:kind==='reader'?/mail-reader-content/:/mail-workspace-title/)}
 assert.match(mailLoadingMarkup('messages'),/class="mail-row-content"/);assert.match(mailLoadingMarkup('contacts'),/class="mail mail-directory-row"/);
 assert.match(mailLoadingMarkup('reader'),/data-mail-pending-back/);
});

import {bindMailHoverPolicy,bindMailTouchFeedback,MAIL_MOBILE_CSS,mailMobileBrowserScript} from './src/mail-mobile-view.js';
function pressFixture(){
 const doc=new EventTarget(),win=new EventTarget();doc.documentElement={dataset:{}};win.getSelection=()=>({toString:()=>''});
 const rows=['A','B'].map(id=>({id,attrs:new Set(),setAttribute(k){this.attrs.add(k)},removeAttribute(k){this.attrs.delete(k)},matches:()=>false}));
 const root={contains:n=>rows.includes(n)};
 const binding=bindMailTouchFeedback({root,document:doc,window:win});
 const fire=(type,row=rows[0],extras={})=>{const e=new Event(type,{cancelable:true});Object.defineProperties(e,Object.fromEntries(Object.entries({target:{closest:s=>s.startsWith('#list')?row:null},pointerType:'touch',pointerId:1,isPrimary:true,button:0,clientX:100,clientY:100,...extras}).map(([k,value])=>[k,{value}])));(type==='blur'?win:doc).dispatchEvent(e);assert.equal(e.defaultPrevented,false,'feedback never consumes scrolling or activation');return e};
 return {doc,win,rows,binding,fire,pressed:()=>rows.filter(n=>n.attrs.has('data-mail-pressed')).map(n=>n.id)};
}
test('touch starts on A, crosses B and releases without leaving A or pressing B',()=>{
 const f=pressFixture();f.fire('pointerdown');assert.deepEqual(f.pressed(),['A']);
 f.fire('pointermove',f.rows[0],{clientX:102,clientY:105});assert.deepEqual(f.pressed(),['A']);
 f.fire('pointermove',f.rows[1],{clientY:160});assert.deepEqual(f.pressed(),[]);
 f.fire('pointerup',f.rows[1]);assert.deepEqual(f.pressed(),[]);
 f.fire('pointerdown',f.rows[1]);assert.deepEqual(f.pressed(),['B']);f.fire('pointerup',f.rows[1]);assert.deepEqual(f.pressed(),[]);
});
test('crossing the original row edge clears feedback even below the movement threshold',()=>{
 const f=pressFixture();f.fire('pointerdown');f.fire('pointermove',f.rows[1],{clientY:102});assert.deepEqual(f.pressed(),[]);
 const g=pressFixture();g.rows[0].getBoundingClientRect=()=>({left:0,right:200,top:0,bottom:101});g.fire('pointerdown');g.fire('pointermove',g.rows[0],{clientY:102});assert.deepEqual(g.pressed(),[],'implicit pointer capture can retain the old event target');
});
test('native scroll, cancellation, capture loss, surface change, blur, hidden and disposal clear press paint',()=>{
 for(const reason of ['scroll','pointercancel','lostpointercapture','mail:surface','blur','visibilitychange','dispose']){
  const f=pressFixture();f.fire('pointerdown');assert.deepEqual(f.pressed(),['A']);
  if(reason==='dispose')f.binding.dispose();else{if(reason==='visibilitychange')f.doc.hidden=true;f.fire(reason)}
  assert.deepEqual(f.pressed(),[],reason);
 }
 const f=pressFixture();f.fire('pointerdown');f.binding.dispose();f.fire('pointerdown');assert.deepEqual(f.pressed(),[]);
});
test('touch suppresses sticky hover until a real mouse returns; keyboard selection stays independent',()=>{
 const f=pressFixture();f.fire('pointerdown');assert.equal(f.doc.documentElement.dataset.mailPointer,'touch');f.fire('pointercancel');assert.equal(f.doc.documentElement.dataset.mailPointer,'touch');
 f.fire('pointermove',f.rows[1],{pointerType:'mouse'});assert.equal(f.doc.documentElement.dataset.mailPointer,'mouse');assert.deepEqual(f.pressed(),[]);
 f.fire('pointerdown',f.rows[0],{pointerType:'mouse'});assert.deepEqual(f.pressed(),[]);
 assert.match(MAIL_MOBILE_CSS,/html:not\(\[data-mail-pointer=touch\]\).*\.mail:not\(\.on\):hover/);
 assert.match(MAIL_MOBILE_CSS,/\[data-mail-pressed\]:not\(\.on\)/);
 assert.match(mailMobileBrowserScript(),/function bindMailTouchFeedback/);
});

test('Mail hover policy covers grouped controls and dynamic portal styles without changing selection or focus',()=>{
 const doc=new EventTarget(),row={selectorText:'.mail:hover'},group={selectorText:'.e-menu button:hover, .e-menu button[aria-checked=true]'},focus={selectorText:'.e-button:focus-visible'},nested={cssRules:[group,focus]};doc.styleSheets=[{cssRules:[row,nested]}];
 const policy=bindMailHoverPolicy({document:doc,window:{}});
 assert.match(row.selectorText,/:hover:where\(html:not\(\[data-mail-pointer=touch\]\)/);
 assert.equal(group.selectorText.split(', ')[1],'.e-menu button[aria-checked=true]');assert.equal(focus.selectorText,'.e-button:focus-visible');
 const late={selectorText:'.portal button:hover'};doc.styleSheets.push({cssRules:[late]});doc.dispatchEvent(new Event('load'));assert.match(late.selectorText,/data-mail-pointer/);
 group.selectorText='.owner-replaced';policy.dispose();assert.equal(row.selectorText,'.mail:hover');assert.equal(late.selectorText,'.portal button:hover');assert.equal(group.selectorText,'.owner-replaced');
});

test('directory full-row buttons share right-swipe navigation without excluding their text or avatar',()=>{
 for(const folder of ['contacts','important','subscriptions']){const f=fixture({directoryRow:true});f.swipe(125);assert.deepEqual(f.actions,['open-navigation'],folder);assert(f.click());f.event('pointerdown');assert.equal(f.click(),false)}
 const vertical=fixture({directoryRow:true,pull:false,scroll:120});vertical.swipe(4,180);assert.deepEqual(vertical.actions,[]);
});
test('a claimed row swipe bypasses shell refresh/navigation and consumes its compatibility click',()=>{
 const f=fixture({listActions:{start:()=>false,move:e=>{e.preventDefault();return true},end:e=>{e.preventDefault();return true},cancel(){}}});
 f.swipe(-140);assert.deepEqual(f.actions,[]);assert(f.click());f.event('pointerdown');assert.equal(f.click(),false);
});

test('native pinch can suppress its release click without preventing any touch default',()=>{
 const f=fixture({listActions:{start:()=>true,move:()=>false,end:()=> 'suppress-click',cancel(){}}});
 assert.equal(f.event('touchstart',150,200,2),false);assert.equal(f.event('touchmove',150,250,2),false);assert.equal(f.event('touchend',150,250,0),false);assert(f.click());f.event('pointerdown');assert.equal(f.click(),false);
});

test('native vertical scrolling never prevents touch defaults but isolates a release click',()=>{
 const f=fixture({scroll:120,pull:false,primaryRow:true});assert.equal(f.event('touchstart'),false);assert.equal(f.event('touchmove',154,380),false);assert.equal(f.event('touchend',154,380,0,2000),false);assert(f.click());f.event('pointerdown');assert.equal(f.click(),false);
});
test('consumed release clicks are stopped before earlier document capture dialog controllers',()=>{
 const f=fixture();let opens=0;f.earlyCapture(()=>opens++);f.swipe(120);assert(f.click());assert.equal(opens,0);f.event('pointerdown');assert.equal(f.click(),false);assert.equal(opens,1);
});

test('pull release and return retain one indicator through the shared settling geometry',async()=>{
 const f=fixture();f.event('touchstart');f.event('touchmove',150,340);f.frame();assert.equal(f.styles['--mail-pull-y'],'77px');
 f.event('touchend');await Promise.resolve();assert.equal(f.root.dataset.mailPull,'pending');assert.equal(f.styles['--mail-pull-y'],'44px');
 f.finish({ok:true});await new Promise(setImmediate);assert.equal(f.root.dataset.mailPull,'complete');f.settle();
 assert.equal(f.root.dataset.mailPull,'settling');assert.equal(f.indicator.hidden,false,'the indicator fades with the returning content');assert.equal(f.indicator.dataset.phase,'settling');
 f.settle();assert.equal(f.indicator.hidden,true);assert.equal(f.root.dataset.mailPull,undefined);
});
test('failure already presented in the list settles the pull without a second result',async()=>{
 const f=fixture();f.swipe(0,110);await Promise.resolve();f.finish({ok:false,presented:true});await new Promise(setImmediate);
 assert.equal(f.root.dataset.mailPull,'settling');assert.equal(f.label.textContent,'正在刷新');f.settle();assert.equal(f.indicator.hidden,true);
});
test('a fresh drag cancels the previous return timer and refreshes after failure',async()=>{
 const f=fixture();f.swipe(0,110);await Promise.resolve();f.finish({ok:false,message:'刷新失败，请重试'});await new Promise(setImmediate);
 f.settle();assert.equal(f.root.dataset.mailPull,'settling');f.event('touchstart');f.event('touchmove',150,310);f.frame();f.settle();
 assert.equal(f.root.dataset.mailPull,'dragging','old cleanup cannot erase the new gesture');f.event('touchend');await Promise.resolve();assert.equal(f.actions.filter(x=>x==='refresh').length,2);
 f.finish({ok:true});await new Promise(setImmediate);assert.equal(f.indicator.dataset.phase,'complete');
});

test('losing the window clears an in-flight pull and ignores its late visible completion',async()=>{
 const f=fixture();f.swipe(0,110);await Promise.resolve();f.blur();assert.equal(f.root.dataset.mailPull,undefined);
 f.finish({ok:true,message:'迟到结果'});await new Promise(setImmediate);assert.equal(f.indicator.hidden,true);assert.equal(f.root.dataset.mailPull,undefined);
 f.swipe(0,110);await Promise.resolve();assert.equal(f.actions.filter(x=>x==='refresh').length,2);
});

test('temporary diagnostics are opt-in, passive, local, and copy only gesture metadata',async()=>{
 const {bindMailGestureDiagnostic}=await import('./src/mail-mobile-view.js');let created=0,copied='';const events={},bubble={},jobs=new Map();let serial=0;
 const node=()=>({children:[],className:'',textContent:'',setAttribute(){},append(...n){this.children.push(...n)},remove(){this.removed=true}});
 const panelRoot=node(),doc={body:panelRoot,documentElement:{clientWidth:390,clientHeight:844},createElement(){created++;return node()},getElementById:()=>({scrollTop:3}),addEventListener(type,fn,options){assert.equal(options.passive,true);(options.capture?events:bubble)[type]=fn}};
 const root={contains:()=>true,dataset:{},hasAttribute:()=>false};const win={URLSearchParams,location:{search:''},performance:{now:()=>20},setTimeout:fn=>{jobs.set(++serial,fn);return serial},clearTimeout:id=>jobs.delete(id),navigator:{clipboard:{writeText:async value=>copied=value}}};
 bindMailGestureDiagnostic({root,document:doc,window:win});assert.equal(created,0);
 win.location.search='?gesture_check=1';const binding=bindMailGestureDiagnostic({root,document:doc,window:win});
 const e={type:'touchmove',target:{closest:()=>null},touches:[{identifier:1,clientX:100.2,clientY:200.6}],cancelable:false,defaultPrevented:false,isTrusted:true};events.touchmove(e);await Promise.resolve();assert.equal(jobs.size,1,'capture microtasks must not finalize before the root owner');e.mailGestureDecision='native-locked';e.defaultPrevented=true;bubble.touchmove(e);assert.equal(jobs.size,0);
 await panelRoot.children[0].children[1].onclick();const data=JSON.parse(copied);assert.equal(data.events[0].decision,'native-locked');assert.equal(data.events[0].prevented,true);assert.equal(data.events[0].cancelable,false);assert.deepEqual(data.events[0].points,[{id:1,x:100,y:201}]);assert.deepEqual(Object.keys(data).sort(),['events','format','viewport']);const end={...e,type:'touchend',touches:[]};events.touchend(end);bubble.touchend(end);const start={...e,type:'touchstart',touches:[{identifier:1,clientX:100,clientY:200},{identifier:2,clientX:150,clientY:201}],mailGestureDecision:undefined,defaultPrevented:false};events.touchstart(start);for(const job of [...jobs.values()])job();await panelRoot.children[0].children[1].onclick();const fresh=JSON.parse(copied);assert.equal(fresh.events.length,1,'a simultaneous pair starts a new trace');assert.equal(fresh.events[0].decision,'unhandled','a stopped bubble still finalizes in a later task');events.touchmove(e);assert.equal(jobs.size,1);binding.dispose();assert.equal(jobs.size,0);assert.equal(panelRoot.children[0].removed,true);
});

test('a top-list pull claims the first native small downward move and completes one refresh',async()=>{
 const f=fixture({nativePanModel:true});assert.equal(f.event('touchstart'),false);
 assert.equal(f.event('touchmove',153,204),true,'the first cancellable4px downward move cannot be discarded until16px');f.frame();
 assert.equal(f.event('touchmove',154,220),true);f.frame();assert.equal(f.root.dataset.mailPull,'dragging');
 assert.equal(f.event('touchmove',154,340),true);f.frame();assert.equal(f.styles['--mail-pull-y'],'77px');f.event('touchend',154,340,0);await Promise.resolve();assert.deepEqual(f.actions,['refresh']);assert.equal(f.root.dataset.mailPull,'pending');f.finish({ok:true,message:'暂无新邮件'});await new Promise(setImmediate);f.settle();f.settle();assert.equal(f.indicator.hidden,true);assert.equal(f.root.dataset.mailPull,undefined);
});
test('native small pulls cancel below threshold while native upward and scrolled lists stay available',()=>{
 const f=fixture({nativePanModel:true});f.event('touchstart');assert.equal(f.event('touchmove',151,204),true);f.frame();f.event('touchend',151,204,0);f.settle();assert.equal(f.indicator.hidden,true);assert.deepEqual(f.actions,[]);
 for(const options of [{pull:false,scroll:120},{pull:true,scroll:120},{pull:true,scroll:0}]){const f=fixture({...options,nativePanModel:true});f.event('touchstart');assert.equal(f.event('touchmove',151,196),false);assert.equal(f.event('touchmove',152,100),false);f.event('touchend',152,100,0);assert.deepEqual(f.actions,[])}
});

// Preventing the first small pull move is necessary on iOS; that reservation
// must not silently consume a tap with ordinary finger jitter.
test('a reserved pull with tap-sized jitter opens the original row exactly once',()=>{
 for(const row of [{primaryRow:true},{directoryRow:true}])for(const dy of [1,3,7]){
  const f=fixture({...row,nativePanModel:true});f.event('touchstart');
  assert(f.event('touchmove',150,200+dy));f.frame();f.event('touchend',150,200+dy,0);
  assert.deepEqual(f.actions,['activate']);assert(f.click(),'compatibility click stays consumed');assert.deepEqual(f.actions,['activate']);
 }
});
test('pull reservation cannot activate after a real drag, reversal, cancellation, or release outside the row',()=>{
 for(const variant of ['drag','reverse','cancel','outside','overlay']){
  const f=fixture({primaryRow:true,releaseInside:variant!=='outside'});f.event('touchstart');f.event('touchmove',150,variant==='reverse'?245:variant==='drag'?212:203);f.frame();
  if(variant==='reverse')f.event('touchmove',150,202);if(variant==='overlay')f.overlay(true);
  f.event(variant==='cancel'?'touchcancel':'touchend',150,203,0);assert.deepEqual(f.actions,[],variant);assert(f.click());
 }
});


test('height-only browser chrome and keyboard resizes do not cancel the current surface or gesture',()=>{
 const events={},doc={documentElement:{clientWidth:390}},calls=[];const binding=bindMailReaderSurface({document:doc,window:{addEventListener:(type,fn)=>events[type]=fn},sync:()=>calls.push('surface')});
 for(let i=0;i<180;i++)events.resize();assert.equal(calls.length,0);doc.documentElement.clientWidth=844;events.resize();events.resize();assert.deepEqual(calls,['surface']);binding.dispose();
});
