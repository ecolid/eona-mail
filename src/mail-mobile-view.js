// Gesture ownership stays in the trusted shell. Email scripts remain disabled.
export function mailGestureIntent(dx,dy,mode,canRefresh) {
 // A resting finger jitters before scrolling. Do not cancel that native stream.
 const x=Math.abs(dx),y=Math.abs(dy);
 if(Math.max(x,y)<16)return '';
 if(x>y*1.6){
  if(mode==='navigation')return dx<0?'close-navigation':'ignore';
  if(mode==='reader')return dx>0?'back-reader':'ignore';
  return mode==='list'&&dx>0?'open-navigation':'ignore';
 }
 if(y>x*1.2)return mode==='list'&&dy>0&&canRefresh?'refresh':'ignore';
 return '';
}
// Mail has both legacy rows and Foundation portals. Gate only their hover
// selectors in the browser CSSOM; selected, expanded and focus rules stay intact.
export function bindMailHoverPolicy({document:doc=document,window:win=window}) {
 const changed=new Map(),guard=':where(html:not([data-mail-pointer=touch]) *)';
 const visit=rules=>{for(const rule of rules){
  if(rule.selectorText?.includes(':hover')&&!rule.selectorText.includes('data-mail-pointer')){
   const before=rule.selectorText,after=before.replace(/:hover\b/g,':hover'+guard);
   try{rule.selectorText=after;changed.set(rule,{before,after:rule.selectorText})}catch{}
  }
  if(rule.cssRules)visit(rule.cssRules);
 }};
 const refresh=()=>{for(const sheet of doc.styleSheets||[])try{visit(sheet.cssRules)}catch{}};
 const abort=new AbortController();doc.addEventListener('load',refresh,{capture:true,passive:true,signal:abort.signal});
 const observer=win.MutationObserver&&doc.documentElement?new win.MutationObserver(records=>{if(records.some(r=>r.type==='characterData'?r.target.parentElement?.tagName==='STYLE':[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('style,link[rel=stylesheet]')||n.querySelector?.('style,link[rel=stylesheet]')))))refresh()}):null;
 observer?.observe(doc.documentElement,{subtree:true,childList:true,characterData:true});refresh();
 return {refresh,dispose(){abort.abort();observer?.disconnect();for(const [rule,{before,after}]of changed)try{if(rule.selectorText===after)rule.selectorText=before}catch{}changed.clear()}};
}
// Transient feedback is separate from mouse hover and business selection.
export function bindMailTouchFeedback({root,document:doc=document,window:win=window}) {
 const hoverPolicy=bindMailHoverPolicy({document:doc,window:win});
 const abort=new AbortController(),signal=abort.signal;let contact=null;
 if(win.matchMedia?.('(hover: none)').matches)doc.documentElement.dataset.mailPointer='touch';
 const clear=()=>{contact?.node.removeAttribute('data-mail-pressed');contact=null};
 const listen=(target,type,fn)=>target.addEventListener(type,fn,{capture:true,passive:true,signal});
 listen(doc,'pointerdown',event=>{
  clear();if(event.pointerType==='mouse'){doc.documentElement.dataset.mailPointer='mouse';return}
  if(!['touch','pen'].includes(event.pointerType))return;
  doc.documentElement.dataset.mailPointer='touch';
  if(event.isPrimary===false||event.button>0)return;
  const node=event.target.closest?.('#list .mail,#side .item,.mail-workspace-mail,.mail-directory-message');
  if(!node||!root.contains(node)||node.matches(':disabled,[aria-disabled=true]')||win.getSelection()?.toString())return;
  const action=event.target.closest?.('button,a,input,textarea,select,[contenteditable=true]');
  if(action&&action!==node&&!action.matches?.('.mail-open'))return;
  contact={node,id:event.pointerId,x:event.clientX,y:event.clientY};node.setAttribute('data-mail-pressed','');
 });
 listen(doc,'pointermove',event=>{
  if(event.pointerType==='mouse'){clear();doc.documentElement.dataset.mailPointer='mouse';return}
  if(!contact)return;
  const over=event.target.closest?.('#list .mail,#side .item,.mail-workspace-mail,.mail-directory-message'),rect=contact.node.getBoundingClientRect?.();
  if(event.pointerId!==contact.id||Math.hypot(event.clientX-contact.x,event.clientY-contact.y)>=8||over&&over!==contact.node||rect&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))clear();
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture','scroll','mail:surface'])listen(doc,type,clear);
 listen(doc,'visibilitychange',()=>{if(doc.hidden)clear()});listen(win,'blur',clear);
 return {dispose(){clear();abort.abort();hoverPolicy.dispose();delete doc.documentElement.dataset.mailPointer}};
}
// Preserve the scroll element and heading identity; only the content moves.
export function bindMailPullSurface({list,document:doc=document,window:win=window}){
 let clip=null,content=null;
 const heading=()=>list.querySelector?.('.mail-workspace-title,.mail-results-bar')||[...(list?.children||[])].find(n=>n.matches?.('.mail-workspace-title,.mail-results-bar'));
 const arrange=()=>{
  const head=heading();if(!head)return;const host=head.parentElement;
  if(!clip||clip.parentElement!==host){const cached=[...host.children].find(n=>n.matches?.('.mail-pull-clip'));clip=cached||doc.createElement('div');clip.className='mail-pull-clip';content=cached?.children[0]||doc.createElement('div');content.className='mail-pull-content';if(!cached)clip.append(content)}
  const outside=[...host.children].filter(n=>n!==head&&n!==clip);
  if(outside.length){const ordered=[...host.children].filter(n=>n!==head).flatMap(n=>n===clip?[...content.children]:[n]),scroll=list.scrollTop;content.replaceChildren(...ordered);if(clip.parentElement!==host)host.append(clip);list.scrollTop=scroll}
  const rect=head.getBoundingClientRect();list.style?.setProperty('--mail-pull-heading-height',rect.height+'px');if(Number.isFinite(list.clientHeight))clip.style.setProperty('min-height',Math.max(0,list.clientHeight-rect.height)+'px');
 };
 const observer=win.MutationObserver&&list?.children?new win.MutationObserver(arrange):null;observer?.observe(list,{childList:true,subtree:true});arrange();
 return {top:()=>heading()?.getBoundingClientRect().bottom??list.getBoundingClientRect().top,dispose(){observer?.disconnect();if(clip?.parentElement){const scroll=list.scrollTop;clip.before(...content.children);clip.remove();list.scrollTop=scroll}list.style?.removeProperty('--mail-pull-heading-height')}};
}
// Safari browser chrome changes height during a pan. Only geometry that
// changes the horizontal surface may invalidate the current input owner.
export function bindMailReaderSurface({window:win=window,document:doc=document,sync}){
 let width=doc.documentElement.clientWidth;const abort=new AbortController();
 win.addEventListener('resize',()=>{const next=doc.documentElement.clientWidth;if(next===width)return;width=next;sync(true)},{passive:true,signal:abort.signal});
 return {dispose(){abort.abort()}};
}
// One owner covers the shell and every trusted, script-blocked body document.
// Native pan-y/pinch-zoom may cancel a pointer at any point; it never waits for
// a touchmove threshold or for the reader's visual exit to finish.
export function bindMailReaderPan({root,reader,mode,back,document:doc=document,window:win=window}){
 const lifetime=new AbortController(),bindings=new Map(),query=win.matchMedia('(max-width:860px)');let tracking=null,paint=0,serial=0,suppressUntil=0,phaseFrame=0,phaseSerial=0;
 const clear=()=>{const t=tracking;tracking=null;serial++;win.cancelAnimationFrame(paint);paint=0;delete root.dataset.mailReaderDrag;root.style.removeProperty('--mail-reader-x');try{if(t?.capture?.hasPointerCapture?.(t.id))t.capture.releasePointerCapture(t.id)}catch{}};
 const selected=source=>!!(win.getSelection?.()?.toString()||source.defaultView?.getSelection?.()?.toString());
 const listen=(source,frame=null)=>{
  const abort=new AbortController(),signal=abort.signal,point=event=>{const rect=frame?.getBoundingClientRect();return {x:event.clientX+(rect?.left||0),y:event.clientY+(rect?.top||0)}};
  const allowed=target=>{if(!target?.closest||target.closest('input,textarea,select,label,[contenteditable]:not([contenteditable=false]),[data-mail-gesture-lock],dialog,[popover]'))return false;if(!frame&&!reader.contains(target))return false;if(!frame&&target.closest('button,a')&&!target.closest('.mail-body-link-hit,#vbody a'))return false;for(let at=target;at&&at!==reader;at=at.parentElement){const css=(at.ownerDocument?.defaultView||win).getComputedStyle(at);if(/auto|scroll/.test(css.overflowX)&&at.scrollWidth>at.clientWidth+2)return false}return true};
  source.addEventListener('pointerdown',event=>{
   suppressUntil=0;if(tracking)clear();if(!query.matches||mode()!=='reader'||!['touch','pen'].includes(event.pointerType)||event.isPrimary===false||event.button>0||doc.querySelector('dialog[open],:popover-open')||selected(source)||!allowed(event.target))return;
   const p=point(event),width=doc.documentElement.clientWidth;if(p.x<20||p.x>width-20)return;
   const rect=reader.getBoundingClientRect();tracking={source,frame,id:event.pointerId,capture:event.target,x:p.x,y:p.y,lastX:p.x,lastAt:win.performance.now(),velocity:0,dx:0,dy:0,width:rect.width||width,start:Math.max(0,rect.left),dragging:false,serial:++serial};
  },{capture:true,passive:true,signal});
  source.addEventListener('pointermove',event=>{
   const t=tracking;if(!t||t.source!==source||t.id!==event.pointerId)return;if(mode()!=='reader'||selected(source)){clear();return}
   const p=point(event),now=win.performance.now();t.dx=p.x-t.x;t.dy=p.y-t.y;t.velocity=(p.x-t.lastX)/Math.max(1,now-t.lastAt);t.lastX=p.x;t.lastAt=now;
   if(!t.dragging){if(Math.abs(t.dy)>Math.max(8,Math.abs(t.dx)*1.2)||t.dx<-12){clear();return}if(t.dx<12||t.dx<Math.abs(t.dy)*1.6)return;t.dragging=true;try{t.capture.setPointerCapture?.(t.id)}catch{}}
   // Pointer cancellation, rather than touch preventDefault, hands a changed
   // vertical intent back to the browser's declared native axis.
   if(event.cancelable)event.preventDefault();if(!paint)paint=win.requestAnimationFrame(()=>{paint=0;if(tracking!==t||serial!==t.serial||mode()!=='reader')return;root.dataset.mailReaderDrag='';root.style.setProperty('--mail-reader-x',Math.max(0,Math.min(t.width,t.start+t.dx))+'px')});
  },{capture:true,passive:false,signal});
  const end=event=>{const t=tracking;if(!t||t.source!==source||t.id!==event.pointerId)return;const commit=event.type==='pointerup'&&t.dragging&&mode()==='reader'&&!selected(source)&&(t.start+t.dx>=t.width||t.dx>=Math.min(120,t.width*.28)||win.performance.now()-t.lastAt<100&&t.dx>=28&&t.velocity>=.4);if(t.dragging){suppressUntil=win.performance.now()+750;if(event.cancelable)event.preventDefault()}clear();if(commit)back()};
  for(const type of ['pointerup','pointercancel','lostpointercapture'])source.addEventListener(type,end,{capture:true,passive:false,signal});
  source.addEventListener('click',event=>{if(event.detail&&suppressUntil>win.performance.now()){event.preventDefault();event.stopImmediatePropagation()}},{capture:true,signal});
  const dispose=()=>{if(tracking?.source===source)clear();abort.abort();bindings.delete(source)};bindings.set(source,dispose);return dispose;
 };
 const visible=()=>doc.body?.classList?.contains('viewing')??mode()==='reader';const surface=()=>{clear();win.cancelAnimationFrame(phaseFrame);const ticket=++phaseSerial,reading=visible();root.dataset.mailReaderPhase=reading?'entering':'leaving';const settled=()=>{phaseFrame=0;if(ticket!==phaseSerial||reading!==visible())return;const x=reader.getBoundingClientRect().left;if(!query.matches||(reading?Math.abs(x)<.5:x>=doc.documentElement.clientWidth-.5)){root.dataset.mailReaderPhase=reading?'active':'list';return}phaseFrame=win.requestAnimationFrame(settled)};phaseFrame=win.requestAnimationFrame(settled)};
 listen(doc);const reset=()=>clear();doc.addEventListener('mail:surface',surface,{capture:true,signal:lifetime.signal});win.addEventListener('blur',reset,{signal:lifetime.signal});doc.addEventListener('visibilitychange',()=>{if(doc.hidden)reset()},{signal:lifetime.signal});query.addEventListener('change',surface,{signal:lifetime.signal});surface();
 return {bindDocument(source,frame){bindings.get(source)?.();return listen(source,frame)},dispose(){clear();phaseSerial++;win.cancelAnimationFrame(phaseFrame);delete root.dataset.mailReaderPhase;lifetime.abort();for(const dispose of [...bindings.values()])dispose()}};
}
export function bindMailMobileGestures({root,navigation,reader,mode,canRefresh,openNavigation,closeNavigation,back,refresh,listActions,document:doc=document,window:win=window}) {
 const feedbackBinding=bindMailTouchFeedback({root,document:doc,window:win}),pullSurface=bindMailPullSurface({list:doc.getElementById('list'),document:doc,window:win});
 const abort=new AbortController(),signal=abort.signal;let tracking=null,refreshing=false,paintFrame=0,finishFrame=0,pullTimer=0,paint=null,ownedTouch=false,suppressClickUntil=0,pullEpoch=0,nativeMovement=false;
 const indicator=doc.createElement('div');indicator.className='mail-pull-status';indicator.hidden=true;indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');
 indicator.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg><span></span>';root.append(indicator);
 const label=indicator.querySelector('span'),query=win.matchMedia('(max-width:860px)'),clamp=value=>Math.max(0,Math.min(1,value));
 const selected=()=>!!win.getSelection()?.toString();
 // A consumed swipe must not activate the control under its release point.
 // Capture before the drawer's target handlers and the mail/workspace delegates.
 // A fresh contact clears the guard immediately; keyboard activation stays intact.
 const freshContact=()=>{suppressClickUntil=0;nativeMovement=false;if(!tracking)ownedTouch=false};
 const finishContact=event=>{if(!ownedTouch){if(nativeMovement){nativeMovement=false;suppressClickUntil=win.performance.now()+750}return;}ownedTouch=false;suppressClickUntil=win.performance.now()+750;if(event.cancelable)event.preventDefault()};
 doc.addEventListener('pointerdown',freshContact,{capture:true,passive:true,signal});
 doc.addEventListener('touchstart',freshContact,{capture:true,passive:true,signal});
 doc.addEventListener('touchend',finishContact,{capture:true,passive:false,signal});
 doc.addEventListener('touchcancel',finishContact,{capture:true,passive:false,signal});
 win.addEventListener('click',event=>{
  if(signal.aborted||!query.matches||!event.detail||!suppressClickUntil||win.performance.now()>suppressClickUntil)return;
  event.preventDefault();event.stopImmediatePropagation();
 },{capture:true,signal});
 const clearPaint=()=>{win.cancelAnimationFrame(paintFrame);paintFrame=0;paint=null};
 const flushPaint=()=>{win.cancelAnimationFrame(paintFrame);paintFrame=0;const run=paint;paint=null;run?.()};
 const queuePaint=run=>{paint=run;if(!paintFrame)paintFrame=win.requestAnimationFrame(flushPaint)};
 const clearDrawer=()=>{win.cancelAnimationFrame(finishFrame);finishFrame=0;delete root.dataset.mailDrawerDrag;root.style.removeProperty('--mail-drawer-x');root.style.removeProperty('--mail-drawer-progress')};
 const settleReader=()=>{reader?.getBoundingClientRect();delete root.dataset.mailReaderDrag;root.style.removeProperty('--mail-reader-x')};
 const clearPull=()=>{pullEpoch++;win.clearTimeout(pullTimer);pullTimer=0;delete root.dataset.mailPull;root.style.removeProperty('--mail-pull-y');indicator.hidden=true;delete indicator.dataset.phase};
 const settlePull=()=>{win.clearTimeout(pullTimer);root.dataset.mailPull='settling';root.style.setProperty('--mail-pull-y','0px');indicator.dataset.phase='settling';pullTimer=win.setTimeout(clearPull,240)};
 const settleDrawer=()=>{navigation.getBoundingClientRect();finishFrame=win.requestAnimationFrame(clearDrawer)};
 const feedback=(height,text,phase='dragging')=>{indicator.hidden=height<24;indicator.dataset.phase=phase;if(label.textContent!==text)label.textContent=text};
 const drawDrawer=t=>{root.dataset.mailDrawerDrag='';root.style.setProperty('--mail-drawer-x',((t.progress-1)*t.width)+'px');root.style.setProperty('--mail-drawer-progress',String(t.progress))};
 const drawReader=t=>{root.dataset.mailReaderDrag='';root.style.setProperty('--mail-reader-x',Math.max(0,Math.min(t.width,t.readerStart+t.dx))+'px')};
 const drawPull=(distance,text)=>{win.clearTimeout(pullTimer);pullTimer=0;const height=Math.min(80,Math.max(0,distance*.55));root.dataset.mailPull='dragging';root.style.setProperty('--mail-pull-y',height+'px');feedback(height,text)};
 const completePull=(epoch,result)=>{refreshing=false;if(signal.aborted||epoch!==pullEpoch)return;if(result?.cancelled||mode()!=='list'){clearPull();return}if(result?.presented){settlePull();return}const ok=result?.ok!==false;root.dataset.mailPull='complete';feedback(44,result?.message||(ok?'刷新完成':'刷新失败，请重试'),'complete');pullTimer=win.setTimeout(settlePull,ok?700:1800)};
 const reset=()=>{const t=tracking;tracking=null;clearPaint();if(t?.intent?.includes('navigation'))settleDrawer();if(t?.intent==='back-reader')settleReader();if(!refreshing){if(root.dataset.mailPull)settlePull();else indicator.hidden=true}};
 const ancestors=(node,visit)=>{for(let at=node;at&&at!==root;at=at.parentElement)if(visit(at))return true;return false};
 root.addEventListener('touchstart',event=>{
  if(win.PointerEvent&&mode()==='reader')return;
  if(tracking)reset();const blocked=!query.matches?'desktop':doc.querySelector('dialog[open],:popover-open')?'overlay':selected()?'text-selection':'';if(blocked){event.mailGestureDecision='blocked-'+blocked;return;}
  if(listActions?.start(event,mode()))return;
  if(event.touches.length!==1)return;
  const target=event.target,current=mode();if(!target.closest||target.closest('input,textarea,select,label,[contenteditable]:not([contenteditable=false]),[data-mail-gesture-lock],dialog,[popover]'))return;
  if(current!=='navigation'&&target.closest('button,a')&&!target.closest('.mail-open,#list .mail-directory-row,#list .mail-workspace-mail,.mail-body-link-hit,#vbody a'))return;
  const point=event.touches[0],width=doc.documentElement.clientWidth;
  // Leave the browser's native back/forward edge gestures alone.
  if(point.clientX<20||point.clientX>width-20)return;
  if(ancestors(target,n=>{const css=win.getComputedStyle(n);return /auto|scroll/.test(css.overflowX)&&n.scrollWidth>n.clientWidth+2}))return;
  const panel=target.closest('#side,#view,#list,#mask');if(!panel&&current!=='navigation')return;
  const rect=navigation.getBoundingClientRect();if(!rect.width)return;clearDrawer();settleReader();if(!refreshing&&root.dataset.mailPull)settlePull();
  const atTop=!ancestors(target,n=>n.scrollTop>0),now=win.performance.now();if(!root.dataset.mailPull)indicator.style.setProperty('--mail-pull-top',pullSurface.top()+'px');
  const readerRect=current==='reader'?reader?.getBoundingClientRect():null;
  const tap=current==='list'?(target.closest('.mail-open,#list .mail-directory-row,#list .mail-workspace-mail')||target.closest('#list .mail')?.querySelector('.mail-open')):null;
  tracking={tap,maxTravel:0,x:point.clientX,y:point.clientY,dx:0,dy:0,at:now,lastAt:now,lastX:point.clientX,velocity:0,mode:current,pull:atTop&&!refreshing&&canRefresh(),intent:'',width:current==='reader'?(readerRect?.width||width):rect.width,readerStart:Math.max(0,readerRect?.left||0),start:clamp(rect.right/rect.width),progress:clamp(rect.right/rect.width)};
 },{passive:true,signal});
 root.addEventListener('touchmove',event=>{
  if(listActions?.move(event)){tracking=null;clearPaint();ownedTouch=true;return}
  const t=tracking;if(!t)return;if(event.touches.length!==1||selected()||mode()!==t.mode){reset();return}
  const point=event.touches[0],now=win.performance.now();t.velocity=(point.clientX-t.lastX)/Math.max(1,now-t.lastAt);t.lastX=point.clientX;t.lastAt=now;t.dx=point.clientX-t.x;t.dy=point.clientY-t.y;t.maxTravel=Math.max(t.maxTravel,Math.hypot(t.dx,t.dy));
  // At the list top, the first small downward pan is the refresh stream.
  // Waiting16px can hand that only cancellable move to native scrolling.
  if(!t.intent)t.intent=t.pull&&t.dy>0&&t.dy>Math.abs(t.dx)*1.2?'refresh':mailGestureIntent(t.dx,t.dy,t.mode,t.pull);
  if(t.intent==='ignore'){nativeMovement=true;reset();return}if(!t.intent)return;
  if(event.cancelable){event.preventDefault();ownedTouch=true;if(t.intent==='refresh')event.mailGestureDecision='pull-dragging'}else{if(t.intent==='refresh')event.mailGestureDecision='pull-native-locked';reset();return}
  if(t.intent==='refresh')queuePaint(()=>drawPull(t.dy,t.dy>=80?'松开刷新':'下拉刷新'));
  else if(t.intent==='back-reader')queuePaint(()=>drawReader(t));
  else{t.progress=clamp(t.start+t.dx/t.width);queuePaint(()=>drawDrawer(t))}
 },{passive:false,signal});
 root.addEventListener('touchend',event=>{
  const rowEnd=listActions?.end(event);if(rowEnd){tracking=null;clearPaint();ownedTouch=rowEnd===true;suppressClickUntil=win.performance.now()+750;return}
  const t=tracking;if(!t)return;
  if(mode()!==t.mode||selected()){reset();return}tracking=null;flushPaint();
  if(t.intent&&event.cancelable)event.preventDefault();
  if(t.intent==='refresh'){
   // Reserving iOS's first cancellable move is not yet a deliberate pull.
   // Complete a tap-sized contact on its original primary row exactly once;
   // the consumed stream's compatibility click remains suppressed.
   const end=event.changedTouches?.[0],x=end?.clientX??t.x+t.dx,y=end?.clientY??t.y+t.dy;
   const travel=Math.max(t.maxTravel,Math.hypot(x-t.x,y-t.y)),hit=doc.elementFromPoint?.(x,y);
   if(travel<8&&t.tap?.isConnected&&!t.tap.disabled&&!doc.querySelector('dialog[open],:popover-open')&&(hit===t.tap||t.tap.contains(hit))){clearPull();t.tap.click();return}
   if(t.dy<80||t.dy<Math.abs(t.dx)*1.4){settlePull();return}
   // Commit the dragged position before easing both content and indicator to
   // the same waiting slot. Their return uses the same geometry and duration.
   doc.getElementById('list').getBoundingClientRect();refreshing=true;root.dataset.mailPull='pending';root.style.setProperty('--mail-pull-y','44px');feedback(44,'正在刷新','pending');const epoch=pullEpoch;Promise.resolve().then(refresh).then(result=>completePull(epoch,result),()=>completePull(epoch,{ok:false,message:'刷新失败，请重试'}));return;
  }
  if(t.intent?.includes('navigation')){
   const recent=win.performance.now()-t.lastAt<100,quick=recent&&Math.abs(t.dx)>=28&&Math.abs(t.velocity)>=.4;
   if(t.intent==='open-navigation'&&(t.progress>=.28||quick&&t.velocity>0))openNavigation();
   if(t.intent==='close-navigation'&&(t.progress<=.72||quick&&t.velocity<0))closeNavigation();
   settleDrawer();
  }
  if(t.intent==='back-reader'){
   const recent=win.performance.now()-t.lastAt<100,quick=recent&&t.dx>=28&&t.velocity>=.4;
   const committed=t.readerStart+t.dx>=t.width||t.dx>=Math.min(120,t.width*.28)||quick;
   settleReader();if(committed)back();
  }
 },{passive:false,signal});
 root.addEventListener('touchcancel',()=>{listActions?.cancel();reset()},{passive:true,signal});query.addEventListener('change',()=>{listActions?.cancel();reset();clearDrawer();settleReader();if(!refreshing)clearPull()},{signal});
 doc.addEventListener('mail:surface',()=>{reset();clearPull()},{capture:true,signal});
 const suspend=()=>{listActions?.cancel();reset();clearPull()};win.addEventListener('blur',suspend,{signal});doc.addEventListener('visibilitychange',()=>{if(doc.hidden)suspend()},{capture:true,signal});
 return {dispose(){feedbackBinding.dispose();pullSurface.dispose();abort.abort();tracking=null;clearPaint();clearDrawer();settleReader();clearPull();indicator.remove()}};
}
// Explicit, temporary device diagnostics. Touch data stays in this page until
// the user presses Copy; no mailbox content, identity, URL or network is read.
export function bindMailGestureDiagnostic({root,document:doc=document,window:win=window}){
 if(!new win.URLSearchParams(win.location.search).has('gesture_check'))return {dispose(){}};
 const abort=new AbortController(),records=[],pending=new Map();let started=win.performance.now(),contacts=0;
 const panel=doc.createElement('aside');panel.className='mail-gesture-diagnostic';panel.setAttribute('aria-label','临时手势诊断');
 const label=doc.createElement('span');label.textContent='手势记录';const copy=doc.createElement('button');copy.className='btn';copy.textContent='复制诊断';const close=doc.createElement('button');close.className='btn';close.textContent='退出';panel.append(label,copy,close);doc.body.append(panel);
 // Native input can run a microtask checkpoint between capture and bubble.
 // Finalize after the root owners, with a task fallback for stopped propagation.
 const finish=event=>{const entry=pending.get(event);if(!entry)return;pending.delete(event);win.clearTimeout(entry.timer);const {item}=entry;item.prevented=event.defaultPrevented;item.decision=event.mailGestureDecision||'unhandled';item.scroll=doc.getElementById('list')?.scrollTop;item.pull=root.dataset.mailPull||'';item.selecting=root.hasAttribute('data-mail-selecting');if(!contacts)label.textContent='已记录 '+records.length+' 步'};
 const read=event=>{
  if(!root.contains(event.target)||event.target.closest?.('.mail-gesture-diagnostic'))return;
  if(event.type==='touchstart'&&contacts===0){for(const {timer}of pending.values())win.clearTimeout(timer);pending.clear();records.length=0;started=win.performance.now()}
  contacts=event.touches.length;
  const item={event:event.type,ms:Math.round(win.performance.now()-started),trusted:!!event.isTrusted,cancelable:event.cancelable,points:[...event.touches].map(p=>({id:p.identifier,x:Math.round(p.clientX),y:Math.round(p.clientY)}))};
  records.push(item);if(records.length>180)records.splice(24,1);pending.set(event,{item,timer:win.setTimeout(()=>finish(event),0)});
 };
 for(const type of ['touchstart','touchmove','touchend','touchcancel']){doc.addEventListener(type,read,{capture:true,passive:true,signal:abort.signal});doc.addEventListener(type,finish,{capture:false,passive:true,signal:abort.signal})}
 copy.onclick=async()=>{for(const event of pending.keys())finish(event);const text=JSON.stringify({format:'mail-touch-v1',viewport:{width:doc.documentElement.clientWidth,height:doc.documentElement.clientHeight},events:records},null,2);let field=panel.querySelector?.('textarea');if(!field){field=doc.createElement('textarea');field.readOnly=true;field.setAttribute('aria-label','手势诊断内容');panel.append(field)}field.value=text;try{await win.navigator.clipboard.writeText(text);copy.textContent='已复制'}catch{field.focus();field.select()}};
 const dispose=()=>{abort.abort();for(const {timer}of pending.values())win.clearTimeout(timer);pending.clear();panel.remove()};close.onclick=()=>{dispose();const url=new win.URL(win.location.href);url.searchParams.delete('gesture_check');win.history.replaceState(win.history.state,'',url)};
 return {dispose};
}
export function mailMobileBrowserScript(){return bindMailReaderSurface.toString()+'\n'+bindMailReaderPan.toString()+'\n'+bindMailGestureDiagnostic.toString()+'\n'+bindMailHoverPolicy.toString()+'\n'+bindMailTouchFeedback.toString()+'\n'+mailGestureIntent.toString()+'\n'+bindMailPullSurface.toString()+'\n'+bindMailMobileGestures.toString()+'\n('+installMailMobile.toString()+')();'}
function installMailMobile(){
 document.addEventListener('click',event=>{if(event.target.closest('[data-mail-pending-back]'))returnToMailList()});
 const mode=()=>document.body.classList.contains('sideopen')?'navigation':document.body.classList.contains('mail-composing')?'editor':document.body.classList.contains('viewing')?'reader':'list';
 if(window.PointerEvent)window.MailReaderPan=bindMailReaderPan({root:document.getElementById('app'),reader:document.getElementById('view'),mode,back:()=>returnToMailList()});
 const listActions=installMailListActions();bindMailGestureDiagnostic({root:document.getElementById('app')});
 bindMailMobileGestures({root:document.getElementById('app'),navigation:document.getElementById('side'),reader:document.getElementById('view'),mode,canRefresh:()=>mode()==='list'&&!listActions.selecting&&!['settings','routes'].includes(state.folder),openNavigation:()=>mailDrawer.open(),closeNavigation:()=>mailDrawer.close(),back:()=>returnToMailList(),refresh:()=>refresh(true,{feedback:'pull'}),listActions});
}
export const MAIL_MOBILE_CSS=`
/* The fixed heading stays in the original scroll viewport. */
.mail-pull-clip{display:flow-root;overflow:clip;min-height:calc(100% - var(--mail-pull-heading-height,56px))}.mail-pull-content{min-height:inherit}
/* One animated length keeps content and feedback on the same timeline. */
@property --mail-pull-y{syntax:"<length>";inherits:true;initial-value:0px}
/* Temporary opt-in diagnostic controls do not change the list scroll surface. */
.mail-gesture-diagnostic{flex-wrap:wrap;position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:200;display:flex;align-items:center;gap:8px;max-width:calc(100% - 24px);padding:6px 8px 6px 12px;border:1px solid var(--e-ui-line);border-radius:16px;background:var(--e-ui-surface);color:var(--ink);font:12px/20px var(--e-ui-font);box-shadow:0 8px 24px #0002}.mail-gesture-diagnostic span{min-width:68px}.mail-gesture-diagnostic textarea{flex-basis:100%;min-width:0;max-width:100%;height:120px}
/* Touch cannot leave mouse hover paint on the row where scrolling began. */
:is(#list .mail,#side .item,.mail-workspace-mail,.mail-directory-message){-webkit-tap-highlight-color:transparent}
:is(#list .mail,.mail-workspace-mail,.mail-directory-message)[data-mail-pressed]:not(.on),#side .item[data-mail-pressed]:not(.on){background:var(--e-ui-soft)}
@media(any-hover:hover) and (any-pointer:fine){
 html:not([data-mail-pointer=touch]) #list .mail:not(.on):hover{background:var(--bg)}
 html:not([data-mail-pointer=touch]) #side .item:not(.on):hover,
 html:not([data-mail-pointer=touch]) .mail-workspace-mail:not(.on):hover,
 html:not([data-mail-pointer=touch]) .mail-directory-message:not(.on):hover{background:var(--e-ui-soft)}
}

.mail-side-error{margin:8px 10px;color:var(--e-ui-danger);font:12px/20px var(--e-ui-font)}.mail-side-error .btn{margin-left:4px}
.mail-pull-status[hidden]{display:none}.mail-pull-status{position:fixed;top:var(--mail-pull-top,var(--e-ui-topbar));left:50%;height:var(--mail-pull-y,0px);overflow:hidden;transform:translateX(-50%);display:flex;align-items:center;justify-content:center;gap:6px;max-width:calc(100% - 32px);color:var(--sub);font:12px/20px var(--e-ui-font);z-index:44;pointer-events:none;white-space:nowrap}.mail-pull-status svg{width:14px;height:14px;flex:none}.mail-pull-status[data-phase=pending] svg{animation:mail-refresh-spin .8s linear infinite}.mail-pull-status[data-phase=complete] svg{display:none}.mail-pull-status[data-phase=settling]{opacity:0}@keyframes mail-refresh-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.mail-pull-status svg{animation:none!important}}
@media(max-width:860px){
 /* The exiting reader is visual only; the revealed list owns the next pan. */
 body:not(.viewing) #view,body:not(.viewing) #view *{pointer-events:none!important}
 #view{transition:transform 200ms var(--e-ui-ease),visibility 0s linear 200ms}
 body:not(.viewing) #view{visibility:hidden}
 body.viewing #view{visibility:visible;transition:transform 200ms var(--e-ui-ease),visibility 0s}
 body.viewing #view{pointer-events:auto;touch-action:pan-y pinch-zoom}
 body.viewing #view:has(iframe[data-mail-native-x=true]){touch-action:auto}
 #vhead{touch-action:pan-y pinch-zoom}
 #list,#view{overscroll-behavior-y:contain}
 #app[data-mail-drawer-drag] #side[data-e-drawer-mobile=true]{transform:translate3d(var(--mail-drawer-x),0,0)!important;visibility:visible!important;transition:none!important;will-change:transform}
 #app[data-mail-drawer-drag] #mask[data-e-drawer-mobile=true]{opacity:var(--mail-drawer-progress)!important;visibility:visible!important;pointer-events:auto!important;transition:none!important}
 body.viewing #app[data-mail-reader-drag] #view{transform:translate3d(var(--mail-reader-x),0,0)!important;transition:none!important;will-change:transform}
 #app[data-mail-pull]{transition:--mail-pull-y 240ms var(--e-ui-ease)}
 #app[data-mail-pull=dragging]{transition:none}
 #app[data-mail-pull] #list .mail-pull-content{transform:translate3d(0,var(--mail-pull-y),0);transition:none;will-change:transform}
 #app:not([data-mail-pull=dragging]) .mail-pull-status{transition:opacity 160ms var(--e-ui-ease)}
 @media(prefers-reduced-motion:reduce){#view,#app[data-mail-pull],#app[data-mail-pull] #list .mail-pull-content,.mail-pull-status{transition:none!important}}
}
`;
