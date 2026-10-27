// Browser history contains bounded view identity, never message bodies or credentials.
export function normalizeMailNavigation(value,owner){
 if(!value||value.version!==1||value.owner!==owner||!value.route)return null;
 const text=(v,max=512)=>typeof v==='string'?v.slice(0,max):'',optional=v=>text(v)||null;
 const folder=['inbox','trash','sent','drafts','contacts','important','subscriptions','settings','routes'].includes(value.route.folder)?value.route.folder:'inbox';
 const route={folder,starred:!!value.route.starred,alias:optional(value.route.alias),box:optional(value.route.box),origin:optional(value.route.origin),category:optional(value.route.category),actionOnly:!!value.route.actionOnly,q:text(value.route.q,4000),searchOrder:value.route.searchOrder==='relevance'?'relevance':'recent',directoryGroup:text(value.route.directoryGroup,40)};
 const reader=v=>v&&['inbox','sent','drafts','contacts','important','subscriptions','workspace-message'].includes(v.kind)&&text(v.id,512)?{id:text(v.id,512),kind:v.kind,messageKind:v.messageKind==='sent'?'sent':'received',parent:v.parent&&['contacts','important','subscriptions'].includes(v.parent.kind)?{id:text(v.parent.id,512),kind:v.parent.kind}:null}:null;
 const number=(v,max)=>Number.isFinite(v)?Math.max(0,Math.min(max,v)):0;
 return {version:1,owner,route,reader:reader(value.reader),listScroll:number(value.listScroll,1e8),readerScroll:number(value.readerScroll,1e8),loaded:number(value.loaded,100000),depth:number(value.depth,10000)};
}
export function mailNavigationKey(route){return JSON.stringify([route.folder,route.starred,route.alias,route.box,route.origin,route.category,route.actionOnly,route.q,route.searchOrder,route.directoryGroup||''])}
export function createMailNavigation({owner,history,url,readRoute,readScroll,readReader,applyRoute,restoreList,openReader,applyScroll,closeReader,onError,canReuseList=()=>false}){
 // The same owner restores both scroll viewports. Browser traversal must not
 // perform a second restoration after popstate and overwrite a fresh pan.
 try{if('scrollRestoration'in history)history.scrollRestoration='manual'}catch{}
 const initial=normalizeMailNavigation(history.state?.eonaMailPage,owner);let current=initial||normalizeMailNavigation({version:1,owner,route:readRoute()},owner),applying=!!initial,epoch=0,awaitingBack=false,deferredWrite=false,inputEpoch=0,backInput=0,lastWritten='',historyBlocked=false;const localParents=[];
 const write=(push=false,parent=null)=>{
  if(awaitingBack){deferredWrite=true;return true}
  const key=JSON.stringify(current);if(!push&&key===lastWritten)return true;
  try{history[push?'pushState':'replaceState']({...history.state,eonaMail:current.reader?.id||null,eonaMailKind:current.reader?.kind||null,eonaMailPage:current},'',url);lastWritten=key;historyBlocked=false;if(push)localParents.length=0;return true}
  catch(error){if(error.name!=='SecurityError')throw error;historyBlocked=true;if(push&&parent)localParents.push(parent);return false}
 };
 // Live scroll is UI state. Browser history is a bounded persistence sink,
 // never the per-frame event bus or a prerequisite for opening a message.
 const scroll=()=>{if(!applying)Object.assign(current,readScroll())};
 if(!initial)write();else applyRoute(current.route,current.reader);
 const restore=async(snapshot,ticket,input=inputEpoch,immediate=false)=>{
  applying=true;closeReader({immediate});applyRoute(snapshot.route,snapshot.reader);
  try{await restoreList(snapshot,()=>ticket===epoch);if(ticket!==epoch)return;if(input===inputEpoch)applyScroll(snapshot,false);else snapshot.listScroll=readScroll().listScroll;if(snapshot.reader){await openReader(snapshot.reader);if(ticket!==epoch)return;if(input===inputEpoch)applyScroll(snapshot,true);else Object.assign(snapshot,readScroll())}if(ticket===epoch){current=snapshot;write()}}
  catch(error){if(ticket===epoch){if(input!==inputEpoch){snapshot.listScroll=readScroll().listScroll;current=snapshot;write()}onError(error)}}finally{if(ticket===epoch)applying=false}
 };
 return {
  get hasInitial(){return !!initial},get restoring(){return applying},get snapshot(){return current},get historyBlocked(){return historyBlocked},
  visit(){const route=normalizeMailNavigation({version:1,owner,route:readRoute()},owner).route;if(mailNavigationKey(route)===mailNavigationKey(current.route))return;
   epoch++;applying=false;Object.assign(current,readScroll());write();const sameFolder=route.folder===current.route.folder,parent=normalizeMailNavigation(current,owner);current={version:1,owner,route,reader:sameFolder?readReader():null,listScroll:0,readerScroll:0,loaded:0,depth:current.depth+1};write(true,parent);
  },
  open(id,kind,push=true,parent=null,messageKind='received'){
   // A deliberate new open supersedes pending history restoration. Internal
   // replay uses push=false and retains the restoration's own epoch.
   if(applying){if(!push)return;epoch++;applying=false}this.visit();const prior=current.reader;Object.assign(current,readScroll());write();const previous=normalizeMailNavigation(current,owner),next={id:String(id),kind,parent,messageKind},changed=prior?.id!==next.id||prior?.kind!==next.kind;
   current={...current,reader:next,readerScroll:changed?0:current.readerScroll,depth:current.depth+(push&&changed?1:0)};write(push&&changed,previous);
  },
  surface(){if(!applying&&!readReader()&&current.reader){current={...current,reader:null,readerScroll:0};write()}},
  save:scroll,persist(){if(!applying)write()},
  input(){inputEpoch++;if(applying&&current.reader&&!readReader()){
   // The exposed list has accepted a new intent. A historical reader waiting
   // for data must not reopen after this pan, even if its request succeeds.
   epoch++;applying=false;current={...current,...readScroll(),reader:null,readerScroll:0};closeReader();write();
  }},
  back(){if(!current.reader)return false;if(applying){epoch++;applying=false}backInput=inputEpoch;scroll();write();applying=true;closeReader();if(awaitingBack){current={...current,reader:null,readerScroll:0};deferredWrite=true;applying=false;return true}if(localParents.length){this.pop({eonaMailPage:localParents.pop()},true);return true}if(current.depth>0&&history.length>1){awaitingBack=true;try{history.back();return true}catch(error){if(error.name!=='SecurityError')throw error;historyBlocked=true;awaitingBack=false}}applying=false;current={...current,reader:null,readerScroll:0};write();return true},
  pop(value,local=false,hasUAVisualTransition=false){
   const next=normalizeMailNavigation(value?.eonaMailPage,owner);if(!next)return false;if(!local)localParents.length=0;lastWritten='';
   const returning=!!current.reader&&!next.reader,input=awaitingBack?backInput:inputEpoch;
   if(awaitingBack){awaitingBack=false;if(deferredWrite){deferredWrite=false;epoch++;applying=false;const sameList=!current.reader&&mailNavigationKey(current.route)===mailNavigationKey(next.route);current=sameList?{...next,...readScroll(),reader:null,readerScroll:0}:{...current,depth:next.depth+1};write(!sameList);return true}}
   // Reading never unmounts its list. Reveal that live viewport directly; a
   // second asynchronous restore could overwrite the user's first scroll.
   if(returning&&mailNavigationKey(next.route)===mailNavigationKey(normalizeMailNavigation({version:1,owner,route:readRoute()},owner).route)&&canReuseList(next)){epoch++;applying=true;closeReader({immediate:hasUAVisualTransition});current={...next,...readScroll(),reader:null,readerScroll:0};applying=false;write();return true}
   current=next;restore(next,++epoch,input,hasUAVisualTransition&&!next.reader);return true;
  },
  restoreInitial(){if(!initial)return Promise.resolve();return restore(initial,++epoch)},
 };
}
export function createMailScrollPersistence({save,persist,now=()=>performance.now(),schedule=setTimeout,cancel=clearTimeout}){
 let timer=0,last=-Infinity;
 const flush=()=>{cancel(timer);timer=0;save();persist();last=now()};
 return {update(){save();if(!timer)timer=schedule(flush,Math.max(180,1000-(now()-last)))},flush,dispose(){cancel(timer);timer=0}};
}
export function installMailNavigation(owner){
 const list=document.getElementById('list'),view=document.getElementById('view');let pendingScroll=null;
 const route=()=>Object.fromEntries(['folder','starred','alias','box','origin','category','actionOnly','q','searchOrder','directoryGroup'].map(k=>[k,state[k]]));
 const readReader=()=>!document.body.classList.contains('viewing')?null:state.workspaceMail?{id:String(state.workspaceMailKind==='sent'?state.sentSelected:state.cur),kind:'workspace-message',parent:state.workspaceSelected,messageKind:state.workspaceMailKind}:state.workspaceSelected?{id:state.workspaceSelected.id,kind:state.workspaceSelected.kind}:state.sentSelected?{id:state.sentSelected,kind:'sent'}:state.cur?{id:String(state.cur),kind:'inbox'}:null;
 const closeReader=({immediate=false}={})=>{pendingScroll?.();pendingScroll=null;clearMailReader();if(immediate)window.MailReaderPan?.finishReturn()};
 const nav=createMailNavigation({owner,history,url:location.href,readRoute:route,readReader,
  canReuseList:snapshot=>activeMailPage?.key===mailPageKey()&&list.getAttribute('aria-busy')!=='true'&&!list.querySelector('.mail-page-skeleton,.mail-list-error')&&!!list.querySelector('.mail-workspace-title,.mail-results-bar')&&(['contacts','important','subscriptions'].includes(state.folder)?activeMailPage?.directoryLimit||80:listMore.offset||100)>=snapshot.loaded,
  readScroll:()=>({listScroll:mailListScrollElement(list).scrollTop,readerScroll:view.scrollTop,loaded:['contacts','important','subscriptions'].includes(state.folder)?activeMailPage?.directoryLimit||80:listMore.offset||100}),
  applyRoute:(next,reader)=>{pendingScroll?.();pendingScroll=null;invalidateMailSearch();Object.assign(state,next);state.queryScope=['drafts','contacts','important','subscriptions','sent'].includes(state.folder)?state.folder:'mail';state.queries||={};state.queries[state.queryScope]=next.q;document.getElementById('q').value=next.q;state.cur=reader?.kind==='inbox'?reader.id:null;state.curMail=null;state.sentSelected=reader?.kind==='sent'?reader.id:null;state.readerFolder=state.queryScope;activateMailQueryScope()},
  restoreList:async(snapshot,current)=>{
   mailDrawer.close();EonaUI.dismissPopovers?.();for(const dialog of [...document.querySelectorAll('dialog[open]')].reverse()){const cancel=new Event('cancel',{cancelable:true});dialog.dispatchEvent(cancel);if(!cancel.defaultPrevented)EonaUI.closeDialog(dialog)}if(document.body.classList.contains('mail-composing'))await closeMailComposer();
   if(!current())return;updateMailNavigation();loadSide().catch(()=>{});const entry=activateMailPage();if(['contacts','important','subscriptions'].includes(state.folder))entry.directoryLimit=Math.max(80,snapshot.loaded);
   const result=await loadList();if(result?.ok===false)throw Error('列表恢复失败，请重试。');if(snapshot.reader?.kind==='inbox'&&!state.cur)snapshot.reader=null;while(current()&&!['sent','drafts','contacts','important','subscriptions','settings','routes'].includes(state.folder)&&!listMore.done&&listMore.offset<snapshot.loaded){const before=listMore.offset;await loadMore();if(before===listMore.offset)break}
  },
  openReader:async reader=>{if(reader.kind==='workspace-message'&&reader.parent){await openMailWorkspaceDetail(reader.parent.id,reader.parent.kind,false);await openMailDirectoryMessage(reader.id,reader.messageKind,false)}else if(['drafts','contacts','important','subscriptions'].includes(reader.kind))await openMailWorkspaceDetail(reader.id,reader.kind,false);else if(reader.kind==='sent')await openMailSent(reader.id,false);else await openMail(reader.id,false)},
  applyScroll:(snapshot,reading)=>{
   mailListScrollElement(list).scrollTop=snapshot.listScroll;mailListScroll=snapshot.listScroll;if(!reading)return;view.scrollTop=snapshot.readerScroll;
   const ready=()=>{const frame=view.querySelector('iframe');return !view.querySelector('.mail-page-skeleton')&&(!frame||frame.dataset.mailReady==='true')};if(ready())return;
   const abort=new AbortController(),observer=new MutationObserver(()=>{if(ready()){view.scrollTop=snapshot.readerScroll;stop()}}),stop=()=>{observer.disconnect();abort.abort();if(pendingScroll===stop)pendingScroll=null};pendingScroll=stop;observer.observe(view,{subtree:true,childList:true,attributes:true,attributeFilter:['data-mail-ready']});for(const type of ['pointerdown','touchstart','wheel','keydown'])document.addEventListener(type,stop,{capture:true,passive:true,signal:abort.signal});
  },closeReader,onError:error=>mailToast(error.message||'页面恢复失败，请重试。',{tone:'error'})});
 const scrollPersistence=createMailScrollPersistence({save:()=>nav.save(),persist:()=>nav.persist()});const save=()=>scrollPersistence.update();
 // Native input takes ownership before its default scroll, even while the
 // previous history read is pending. Do not synthesize a scroll to prove it.
 for(const type of ['pointerdown','touchstart','wheel','keydown'])list.addEventListener(type,()=>nav.input(),{capture:true,passive:true});
 list.addEventListener('scroll',save,{capture:true,passive:true});view.addEventListener('scroll',save,{passive:true});window.addEventListener('pagehide',()=>scrollPersistence.flush());
 window.addEventListener('popstate',event=>{try{window.MailReturnDiagnostic?.navigation?.(event,'before')}catch{}const handled=nav.pop(event.state,false,event.hasUAVisualTransition===true);try{window.MailReturnDiagnostic?.navigation?.(event,'after')}catch{}if(handled)event.stopImmediatePropagation()},{capture:true});
 document.addEventListener('mail:surface',()=>nav.surface());return nav;
}
export function mailNavigationBrowserScript(){return [normalizeMailNavigation,mailNavigationKey,createMailNavigation,createMailScrollPersistence,installMailNavigation].map(fn=>fn.toString()).join('\n');}
