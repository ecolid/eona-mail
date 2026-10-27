import test from 'node:test';
import assert from 'node:assert/strict';
import {bindMailReaderPan} from './src/mail-mobile-view.js';
import {setMailBodyInputAxes,chainMailReaderDisposers} from './src/mail-body-view.js';

class Surface {
 constructor(){this.events=new Map()}
 addEventListener(type,fn,{signal}={}){const list=this.events.get(type)||[];list.push(fn);this.events.set(type,list);signal?.addEventListener('abort',()=>this.events.set(type,(this.events.get(type)||[]).filter(f=>f!==fn)),{once:true})}
 emit(type,values={}){const e={type,cancelable:true,detail:1,pointerType:'touch',pointerId:1,isPrimary:true,button:0,clientX:160,clientY:80,preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.stopped=true},...values};for(const fn of [...this.events.get(type)||[]]){fn(e);if(e.stopped)break}return e}
}
function fixture(){
 const doc=new Surface(),child=new Surface(),win=new Surface(),query=new Surface(),styles={},frames=new Map(),allFrames=[];let id=0,now=0,mode='reader',selection='',backs=0,left=0;
 query.matches=true;doc.documentElement={clientWidth:390};doc.querySelector=()=>null;
 Object.assign(win,{PointerEvent:class{},performance:{now:()=>now},matchMedia:()=>query,getSelection:()=>({toString:()=>selection}),getComputedStyle:node=>({overflowX:node.horizontal?'auto':'visible'}),requestAnimationFrame(fn){allFrames.push(fn);frames.set(++id,fn);return id},cancelAnimationFrame(id){frames.delete(id)}});child.defaultView=win;
 win.setTimeout=fn=>{frames.set(++id,fn);return id};win.clearTimeout=id=>frames.delete(id);
 const root={dataset:{},style:{setProperty:(k,v)=>styles[k]=v,removeProperty:k=>delete styles[k]}},reader={style:root.style,contains:n=>n===shell,getBoundingClientRect:()=>({width:390,left:left+parseFloat(styles['--mail-reader-x']||0)})};
 const node=owner=>({ownerDocument:owner,parentElement:null,closest:()=>null,setPointerCapture(){this.captured=true},hasPointerCapture(){return this.captured},releasePointerCapture(){this.captured=false}}),shell=node(doc),text=node(child),frame={getBoundingClientRect:()=>({left:reader.getBoundingClientRect().left+12,top:300})};
 const binding=bindMailReaderPan({root,reader,document:doc,window:win,mode:()=>mode,back:()=>{backs++;mode='list';doc.emit('mail:surface')}}),disposeChild=binding.bindDocument(child,frame);
 const emit=(type,x=160,y=80,more={},source=child,target=text)=>{now+=20;return source.emit(type,{target,clientX:x,clientY:y,...more})},paint=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn())};
 return {doc,child,win,query,root,styles,reader,shell,text,frame,binding,disposeChild,emit,paint,allFrames,backs:()=>backs,mode:value=>mode=value,select:value=>selection=value,left:value=>left=value};
}
test('a pan starting inside HTML body returns through the same owner and releases input before back',()=>{
 const f=fixture();f.emit('pointerdown');assert(!f.emit('pointermove',163,81).defaultPrevented);f.emit('pointermove',300,82);f.paint();assert.equal(f.styles['--mail-reader-x'],'140px');
 f.emit('pointerup',300,82);assert.equal(f.backs(),1);assert.equal(f.root.dataset.mailReaderDrag,undefined);assert.equal(f.styles['--mail-reader-x'],undefined);assert.equal(f.text.captured,false);
 f.emit('pointermove',330,82);f.allFrames.forEach(fn=>fn());assert.equal(f.root.dataset.mailReaderDrag,undefined);assert.equal(f.backs(),1);
});
test('native vertical cancellation after horizontal jitter removes every pending paint and capture',()=>{
 for(const dx of [3,20,40]){const f=fixture();f.emit('pointerdown');f.emit('pointermove',160+dx,81);f.paint();f.emit('pointercancel',160+dx,160,{cancelable:false});f.allFrames.forEach(fn=>fn());assert.equal(f.root.dataset.mailReaderDrag,undefined);assert.equal(f.styles['--mail-reader-x'],undefined);assert(!f.text.captured);assert.equal(f.backs(),0)}
});
test('return accepted during a drag invalidates queued and late child events, including a new reader',()=>{
 const f=fixture();f.emit('pointerdown');f.emit('pointermove',200,81);f.paint();f.emit('pointermove',230,82);f.mode('list');f.doc.emit('mail:surface');f.mode('reader');f.emit('pointermove',300,82);f.emit('pointerup',300,82);f.allFrames.forEach(fn=>fn());assert.equal(f.styles['--mail-reader-x'],undefined);assert.equal(f.backs(),0);
 f.emit('pointerdown');f.emit('pointermove',300,82);f.emit('pointerup',300,82);assert.equal(f.backs(),1);
});
test('body replacement disposes its input binding before the next document is interactive',()=>{
 const f=fixture();f.emit('pointerdown');f.emit('pointermove',220,81);f.disposeChild();f.emit('pointerup',300,81);f.allFrames.forEach(fn=>fn());assert.equal(f.backs(),0);assert.equal(f.styles['--mail-reader-x'],undefined);f.binding.bindDocument(f.child,f.frame);f.emit('pointerdown');f.emit('pointermove',300,82);f.emit('pointerup',300,82);assert.equal(f.backs(),1);
});
test('vertical intent, selection, controls, horizontal scrollers, edge and pinch keep their native owner',()=>{
 for(const kind of ['vertical','selection','control','horizontal','edge','pinch']){const f=fixture();if(kind==='selection')f.select('selected');if(kind==='control')f.text.closest=()=>({});if(kind==='horizontal')Object.assign(f.text,{horizontal:true,scrollWidth:600,clientWidth:300});f.emit('pointerdown',kind==='edge'?1:160);if(kind==='pinch')f.emit('pointerdown',220,80,{isPrimary:false,pointerId:2});if(kind==='vertical')assert(!f.emit('pointermove',164,140).defaultPrevented);f.emit('pointermove',300,82);f.emit('pointerup',300,82);assert.equal(f.backs(),0,kind)}
});
test('the shell and child use physical coordinates while the frame follows the finger',()=>{
 const f=fixture();f.emit('pointerdown');f.emit('pointermove',200,81);f.paint();assert.equal(f.styles['--mail-reader-x'],'40px');f.emit('pointermove',220,81);f.paint();assert.equal(f.styles['--mail-reader-x'],'100px');f.binding.dispose();f.allFrames.forEach(fn=>fn());assert.equal(f.styles['--mail-reader-x'],undefined);
 const g=fixture();g.emit('pointerdown',160,80,{},g.doc,g.shell);g.emit('pointermove',300,81,{},g.doc,g.shell);g.emit('pointerup',300,81,{},g.doc,g.shell);assert.equal(g.backs(),1);
});
test('blur clears the drag and a new contact immediately clears only its compatibility click guard',()=>{
 const f=fixture();f.emit('pointerdown');f.emit('pointermove',220,81);f.paint();f.win.emit('blur');assert.equal(f.styles['--mail-reader-x'],undefined);f.emit('pointerdown');f.emit('pointermove',300,81);f.emit('pointerup',300,81);assert(f.child.emit('click').defaultPrevented);f.emit('pointerdown');assert(!f.doc.emit('click').defaultPrevented);
});
test('return input transfer and visual completion are separate; an old exit cannot complete a new reader',()=>{
 const f=fixture();f.paint();assert.equal(f.root.dataset.mailReaderPhase,'active');f.mode('list');f.doc.emit('mail:surface');assert.equal(f.root.dataset.mailReaderPhase,'leaving');f.left(180);f.paint();assert.equal(f.root.dataset.mailReaderPhase,'leaving');f.mode('reader');f.left(0);f.doc.emit('mail:surface');f.allFrames.slice().forEach(fn=>fn());assert.equal(f.root.dataset.mailReaderPhase,'active');f.mode('list');f.doc.emit('mail:surface');f.left(390);f.paint();assert.equal(f.root.dataset.mailReaderPhase,'list');f.binding.dispose();
});
test('a native horizontal body region keeps its complete ancestor path while adjacent text retains reader pan-y',()=>{
 const node=()=>({style:{setProperty(_key,value){this.axis=value}},children:[],querySelectorAll(){return this.children}}),body=node(),html=node(),content=node(),paragraph=node(),code=node(),span=node();content.parentElement=body;paragraph.parentElement=code.parentElement=content;span.parentElement=code;content.children=[paragraph,code,span];code.children=[span];Object.assign(code,{scrollWidth:600,clientWidth:300});const doc={body,documentElement:html,defaultView:{getComputedStyle:n=>({overflowX:n===code?'auto':'visible'})}},frame={dataset:{}};
 setMailBodyInputAxes(doc,content,frame);assert.equal(frame.dataset.mailNativeX,'true');for(const n of [html,body,content,code,span])assert.equal(n.style.axis,'auto');assert.equal(paragraph.style.axis,'pan-y pinch-zoom');code.scrollWidth=300;setMailBodyInputAxes(doc,content,frame);assert.equal(frame.dataset.mailNativeX,'false');for(const n of [html,body,content,code,span,paragraph])assert.equal(n.style.axis,'pan-y pinch-zoom');
});

test('desktop geometry settles without a phone exit animation or a recurring frame loop',()=>{const f=fixture();f.query.matches=false;f.left(600);f.doc.emit('mail:surface');f.paint();assert.equal(f.root.dataset.mailReaderPhase,'active');f.mode('list');f.doc.emit('mail:surface');f.paint();assert.equal(f.root.dataset.mailReaderPhase,'list');f.binding.dispose()});

test('an overlaid navigation surface changes input mode without changing the reader visual identity',()=>{const f=fixture();f.doc.body={classList:{contains:()=>true}};f.mode('navigation');f.doc.emit('mail:surface');f.paint();assert.equal(f.root.dataset.mailReaderPhase,'active');f.binding.dispose()});

test('body coordinates stay stable through reversal without per-move frame geometry',()=>{
 const f=fixture();let reads=0;const original=f.frame.getBoundingClientRect;f.frame.getBoundingClientRect=()=>{reads++;return original()};
 f.emit('pointerdown',160,80,{screenX:500,screenY:400});const before=reads;
 f.emit('pointermove',200,80,{screenX:540,screenY:400});f.paint();assert.equal(f.styles['--mail-reader-x'],'40px');
 f.emit('pointermove',180,80,{screenX:560,screenY:400});f.paint();assert.equal(f.styles['--mail-reader-x'],'60px');
 f.emit('pointermove',130,80,{screenX:530,screenY:400});f.paint();assert.equal(f.styles['--mail-reader-x'],'30px');assert.equal(reads,before);f.emit('pointercancel');assert.equal(f.styles['--mail-reader-x'],undefined);
});
test('retirement preserves outgoing content until offscreen, then releases exactly once',()=>{
 const f=fixture(),released=[];f.emit('pointerdown');f.emit('pointermove',300,81);f.paint();f.emit('pointerup',300,81);f.binding.retire(()=>released.push('old'));assert.deepEqual(released,[]);f.paint();assert.deepEqual(released,[]);f.left(390);f.paint();assert.deepEqual(released,['old']);f.paint();f.binding.dispose();assert.deepEqual(released,['old']);
});
test('a new reading flushes only the previous retirement and has no recurring settlement loop',()=>{
 const f=fixture();let disposed=0;f.mode('list');f.doc.emit('mail:surface');f.binding.retire(()=>disposed++);f.paint();f.mode('reader');f.left(0);f.doc.emit('mail:surface');assert.equal(disposed,1);f.paint();const callbacks=f.allFrames.length;for(let i=0;i<30;i++)f.paint();assert.equal(f.allFrames.length,callbacks);assert.equal(f.root.dataset.mailReaderPhase,'active');
});

test('sent and draft composite bodies suspend once and dispose each old resource once',()=>{
 const calls=[],body=Object.assign(()=>calls.push('body-dispose'),{suspend:()=>calls.push('body-pause')}),contacts=()=>calls.push('contacts');const combined=chainMailReaderDisposers(body,contacts);combined.suspend();combined.suspend();assert.deepEqual(calls,['body-pause','contacts']);combined();combined();combined.suspend();assert.deepEqual(calls,['body-pause','contacts','body-dispose']);
});
