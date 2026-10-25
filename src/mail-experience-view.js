import {mailScrollTrack,installMailOverlayScrollbars} from './mail-scrollbars-view.js';
import {normalizeMailExperience,orderMailNavigation,moveMailNavigation,mailPanelSizes} from './mail-experience-model.js';
export function mailExperienceBrowserScript(){return [normalizeMailExperience,orderMailNavigation,moveMailNavigation,mailPanelSizes,mailScrollTrack,installMailOverlayScrollbars,openMailDialog].map(fn=>fn.toString()).join('\n')+';('+mailExperienceController.toString()+')();';}
// Business dialogs share Foundation timing; cleanup follows the real close event.
export function openMailDialog(dialog,{returnFocus=document.activeElement,dispose,onClosed,initialFocus}={}){
 let closing=false;
 const close=()=>{if(closing)return;closing=true;EonaUI.closeDialog(dialog)};
 dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
 dialog.addEventListener('close',()=>{dispose?.();dialog.remove();if(onClosed)onClosed();else if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true})},{once:true});
 EonaUI.openDialog(dialog);initialFocus?.focus({preventScroll:true});
 return {close,get closing(){return closing}};
}
function mailExperienceController(){
 const {Split,Sortable,animate}=MailExperienceLibraries,side=document.getElementById('side'),app=document.getElementById('app'),list=document.getElementById('list'),view=document.getElementById('view'),main=side.parentElement;
 const desktop=matchMedia('(min-width:861px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
 let owner='',prefs=normalizeMailExperience(),split=null,mode='',sorts=[],settingsHost=null,indicator=null,selectionMotion=null,pageMotion=null,blocked=false,saveQueued=false,sideDeferred=false,activeDrag=null;
 const segmentStates=new WeakMap();
 const segmentsChanged=root=>{
  if(!root?.isConnected)return;const selected=root.querySelector('[aria-pressed=true],[aria-selected=true]');if(!selected)return;
  let entry=segmentStates.get(root);if(!entry){const marker=document.createElement('span');marker.className='mail-segment-indicator';marker.setAttribute('aria-hidden','true');root.prepend(marker);entry={marker};segmentStates.set(root,entry)}
  const {marker}=entry,x=selected.offsetLeft,y=selected.offsetTop,width=selected.offsetWidth,height=selected.offsetHeight;if(!width)return;
  const left=root.scrollLeft;if(x<left)root.scrollLeft=x-3;else if(x+width>left+root.clientWidth)root.scrollLeft=x+width-root.clientWidth+3;
  const next=x+':'+y+':'+width+':'+height;if(entry.position===next)return;const initial=!entry.position;entry.position=next;entry.motion?.stop();
  const styles={transform:'translate('+x+'px,'+y+'px)',width:width+'px',height:height+'px'};
  if(initial||reduced.matches)Object.assign(marker.style,styles);else entry.motion=animate(marker,styles,{duration:.24,ease:[.22,1,.36,1]});
 };
 document.body.classList.add('mail-atlas');
 installMailOverlayScrollbars(MailExperienceLibraries.OverlayScrollbars);
 const storageKey=()=> 'eona-mail-experience-v1:'+owner;
 const save=()=>{if(!owner)return;try{localStorage.setItem(storageKey(),JSON.stringify(prefs))}catch{}};
 const announce=message=>{let status=document.getElementById('mail-layout-status');if(!status){status=document.createElement('span');status.id='mail-layout-status';status.className='mail-loading-sr';status.setAttribute('role','status');document.body.append(status)}status.textContent=message;};
 const stopSort=()=>{for(const sort of sorts)sort.destroy();sorts=[];};
 const saveOrder=root=>{prefs.orders[root.dataset.mailSort]=[...root.children].map(n=>n.dataset.navKey);save();state.sideMarkup=null;loadSide();announce('侧栏顺序已保存');};
 const indicatorUpdate=(instant=false)=>{
  const selected=side.querySelector('.item.on');if(!selected||!selected.offsetHeight){if(indicator)indicator.hidden=true;return;}
  if(!indicator){indicator=document.createElement('div');indicator.id='mail-nav-indicator';indicator.setAttribute('aria-hidden','true');}if(indicator.parentElement!==side)side.prepend(indicator);
  const y=selected.getBoundingClientRect().top-side.getBoundingClientRect().top+side.scrollTop,h=selected.offsetHeight;
  const previous=indicator.hidden||!indicator.dataset.position;indicator.hidden=false;
  if(indicator.dataset.position===y+':'+h)return;indicator.dataset.position=y+':'+h;
  selectionMotion?.stop();if(instant||previous||reduced.matches){indicator.style.transform='translateY('+y+'px)';indicator.style.height=h+'px';}else selectionMotion=animate(indicator,{transform:'translateY('+y+'px)',height:h+'px'},{duration:.22,ease:[.22,1,.36,1]});
 };
 side.addEventListener('click',()=>queueMicrotask(()=>indicatorUpdate()));
 const mountSettings=host=>{
  stopSort();settingsHost=host;if(!host)return;
  host.innerHTML='<div class="mail-settings-section-head"><h2>侧栏与布局</h2><button type="button" class="e-button" data-reset-width>'+I.reset+'恢复默认分栏</button></div><div class="mail-order-groups"></div><div class="mail-order-footer"><span>拖动手柄调整顺序，或聚焦手柄后按 Alt + 上下方向键。</span><button type="button" class="e-button" data-reset-order>恢复默认顺序</button></div>';
  const groups=host.querySelector('.mail-order-groups');
  for(const root of side.querySelectorAll('[data-mail-sort]')){
   const details=document.createElement('details');details.open=root.dataset.mailSort==='folders';details.innerHTML='<summary><span>'+({folders:'导航',categories:'分类',mailboxes:'邮箱'}[root.dataset.mailSort])+'</span><small>'+root.children.length+'</small>'+I.caret+'</summary><div class="mail-order-list" data-mail-sort="'+root.dataset.mailSort+'"></div>';groups.append(details);
   const target=details.querySelector('.mail-order-list');
   for(const row of root.children){const copy=document.createElement('div');copy.className='mail-order-row';copy.dataset.navKey=row.dataset.navKey;copy.innerHTML='<span class="mail-order-icon">'+(row.querySelector('.mail-nav-action>svg')?.outerHTML||row.querySelector('svg')?.outerHTML||'')+'</span><span class="mail-order-label">'+esc(row.querySelector('.t')?.textContent||row.dataset.navKey)+'</span><button type="button" class="mail-order-handle" data-mail-sort-handle aria-label="调整'+esc(row.querySelector('.t')?.textContent||row.dataset.navKey)+'的顺序">'+I.grip+'</button>';target.append(copy);}
   sorts.push(Sortable.create(target,{draggable:'.mail-order-row',dataIdAttr:'data-nav-key',handle:'[data-mail-sort-handle]',animation:180,forceFallback:true,fallbackOnBody:true,ghostClass:'mail-sort-ghost',chosenClass:'mail-sort-chosen',fallbackClass:'mail-sort-fallback',onChoose(){activeDrag={root:target,keys:[...target.children].map(n=>n.dataset.navKey)}},onStart(){blocked=true;document.body.classList.add('mail-sorting')},onEnd(){saveOrder(target);activeDrag=null;document.body.classList.remove('mail-sorting');if(sideDeferred){sideDeferred=false;loadSide()}}}));
  }
  host.querySelector('[data-reset-width]').onclick=()=>{prefs.side=216;prefs.list=360;save();rebuild(true);mailToast('分栏宽度已恢复',{tone:'success'})};
  host.querySelector('[data-reset-order]').onclick=()=>{prefs.orders={};save();state.sideMarkup=null;stopSort();loadSide().then(()=>mountSettings(host));mailToast('侧栏顺序已恢复',{tone:'success'})};
  host.onkeydown=event=>{const handle=event.target.closest('[data-mail-sort-handle]');if(!handle||!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const row=handle.closest('.mail-order-row'),root=row.parentElement,keys=[...root.children].map(n=>n.dataset.navKey),next=moveMailNavigation(keys,row.dataset.navKey,event.key==='ArrowUp'?-1:1);for(const key of next)root.append([...root.children].find(n=>n.dataset.navKey===key));saveOrder(root);handle.focus();announce(row.querySelector('.mail-order-label').textContent+'，第 '+(next.indexOf(row.dataset.navKey)+1)+' 项')};
 };
 document.addEventListener('click',event=>{if(event.target.closest('[data-mail-sort-handle]')||blocked){event.preventDefault();event.stopImmediatePropagation();blocked=false}},true);
 document.addEventListener('pointerdown',()=>{if(!document.body.classList.contains('mail-sorting'))blocked=false},true);
 document.addEventListener('keydown',event=>{if(event.key!=='Escape'||!activeDrag||!document.body.classList.contains('mail-sorting'))return;event.preventDefault();event.stopImmediatePropagation();const {root,keys}=activeDrag;Sortable.get(root)?.sort(keys,false);stopSort();activeDrag=null;document.body.classList.remove('mail-sorting');blocked=true;mountSettings(settingsHost);announce('已取消排序');if(sideDeferred){sideDeferred=false;loadSide()}},true);
 const cleanSplit=()=>{split?.destroy();split=null;delete app.dataset.mailSplit;for(const node of [side,list,view]){node.style.removeProperty('width');node.style.removeProperty('flex-basis');}document.body.classList.remove('mail-resizing');};
 const updateSeparators=()=>{for(const [i,g] of [...main.querySelectorAll('.mail-split-gutter')].entries()){const before=i?list:side,next=i?view:list;g.setAttribute('aria-valuemin',String(i?260:184));g.setAttribute('aria-valuemax',String(Math.min(i?640:360,Math.round(before.offsetWidth+next.offsetWidth-(i||mode==='two'?320:260)))));g.setAttribute('aria-valuenow',String(Math.round(before.getBoundingClientRect().width)));}};
 const rememberSize=()=>{prefs.side=Math.round(side.getBoundingClientRect().width);if(mode==='three')prefs.list=Math.round(list.getBoundingClientRect().width);save();updateSeparators();};
 function rebuild(force=false){
  const next=!desktop.matches?'mobile':document.body.classList.contains('mail-composing')?'compose':document.body.classList.contains('mail-settings')?'two':'three';if(mode===next&&!force)return;cleanSplit();mode=next;
  if(next==='mobile'){indicatorUpdate(true);return;}if(next==='compose'){side.style.width=prefs.side+'px';return;}
  const nodes=next==='two'?[side,list]:[side,list,view],minimum=next==='two'?[184,320]:[184,260,320];app.dataset.mailSplit='true';
  split=Split(nodes,{sizes:mailPanelSizes(main.clientWidth,prefs.side,prefs.list,nodes.length),minSize:minimum,maxSize:next==='two'?[360,Infinity]:[360,640,Infinity],gutterSize:4,snapOffset:0,expandToMin:true,
   gutter(index){const g=document.createElement('div');g.className='mail-split-gutter';g.tabIndex=0;g.setAttribute('role','separator');g.setAttribute('aria-orientation','vertical');g.setAttribute('aria-label',index===1?'调整导航栏宽度':'调整邮件列表宽度');g.dataset.mailGestureLock='';g.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();if(event.key==='Home'){prefs.side=216;prefs.list=360;save();rebuild(true);main.querySelectorAll('.mail-split-gutter')[index-1]?.focus();return;}const sizes=split.getSizes(),i=index-1,available=main.clientWidth,delta=(event.shiftKey?50:10)*(event.key==='ArrowLeft'?-1:1)/available*100,bound=Math.max((minimum[i]+(i?4:2))/available*100,sizes[i]+sizes[i+1]-(i===0&&nodes.length===3?644:Infinity)/available*100,Math.min(sizes[i]+delta,((i?640:360)+(i?4:2))/available*100,sizes[i]+sizes[i+1]-(minimum[i+1]+(i+1===nodes.length-1?2:4))/available*100));sizes[i+1]+=sizes[i]-bound;sizes[i]=bound;split.setSizes(sizes);rememberSize();g.setAttribute('aria-valuenow',String(Math.round(nodes[i].getBoundingClientRect().width)));indicatorUpdate(true);});return g;},
   onDragStart(){document.body.classList.add('mail-resizing');EonaUI.dismissPopovers();},onDrag(){indicatorUpdate(true);updateSeparators();},onDragEnd(){document.body.classList.remove('mail-resizing');rememberSize();indicatorUpdate(true);}});updateSeparators();
 }
 new MutationObserver(()=>rebuild()).observe(document.body,{attributes:true,attributeFilter:['class']});desktop.addEventListener('change',()=>rebuild(true));
 window.addEventListener('resize',()=>{clearTimeout(saveQueued);saveQueued=setTimeout(()=>{rebuild(true);indicatorUpdate(true);for(const root of document.querySelectorAll('.mail-segments'))segmentsChanged(root)},100);});
 window.MailExperience={
  acceptSideUpdate(){if(document.body.classList.contains('mail-sorting')){sideDeferred=true;return false;}return true;},
  setOwner(value){owner=String(value||'password-owner');try{prefs=normalizeMailExperience(JSON.parse(localStorage.getItem(storageKey())||'{}'));}catch{prefs=normalizeMailExperience();}stopSort();settingsHost=null;state.sideMarkup=null;rebuild(true);},
  sideRendered(){for(const row of side.querySelectorAll('.item')){row.removeAttribute('role');row.removeAttribute('tabindex');const handle=row.querySelector('[data-mail-sort-handle]'),action=document.createElement('button');action.type='button';action.className='mail-nav-action';for(const child of [...row.childNodes])if(child!==handle)action.append(child);row.prepend(action);if(row.classList.contains('on'))action.setAttribute('aria-current','page');}indicatorUpdate();},
  mountSettings,
  segmentsChanged,
  refreshStarted(button){if(reduced.matches)return;button.dataset.spinning='true';if(!button.dataset.spinBound){button.dataset.spinBound='true';button.addEventListener('animationiteration',()=>{if(button.getAttribute('aria-busy')!=='true')delete button.dataset.spinning})}},
  refreshFinished(button){if(reduced.matches||!button.querySelector('svg')?.getAnimations().length)delete button.dataset.spinning},
  navigationChanged(){indicatorUpdate();},
  order(group,rows){return orderMailNavigation(rows,prefs.orders[group]||[]);},
  pageChanged(key,restored=false){rebuild();pageMotion?.stop();document.dispatchEvent(new CustomEvent('mail:page-visible',{detail:{key}}));},
 };
}
