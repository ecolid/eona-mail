// The sticky heading is not part of the visible scroll track. Keep the viewport
// identity so history, pagination and touch range selection retain one owner.
export function mailScrollTrack(box,heading){
 const top=Math.min(box.bottom,Math.max(box.top,heading?.bottom||box.top));
 return {top,height:Math.max(0,box.bottom-top)};
}
// Preserve each existing scroll element: reader history and touch controllers own it.
export function installMailOverlayScrollbars(OverlayScrollbars){
 if(typeof OverlayScrollbars!=='function')return;
 const ports=new Map(),selector='#side,#list:not([data-mail-viewport]),#mail-list-scroll,#view,#mail-settings-form,.mail-settings-page>.mail-layout-settings,.mail-compose';let frame=0,active=false;const desktop=matchMedia('(min-width:861px) and (hover:hover) and (pointer:fine)');
 const place=(element,instance)=>{
  const box=element.getBoundingClientRect(),mobile=matchMedia('(max-width:860px)').matches;
  const obscured=mobile&&(element.id==='side'&&!document.body.classList.contains('sideopen')||['list','mail-list-scroll'].includes(element.id)&&document.body.classList.contains('viewing')||element.id==='view'&&!document.body.classList.contains('viewing'))||document.body.classList.contains('mail-composing')&&['list','mail-list-scroll','view'].includes(element.id);
  const bar=instance.elements().scrollbarVertical.scrollbar,heading=['list','mail-list-scroll'].includes(element.id)?element.querySelector('.mail-workspace-title,.mail-results-bar'):null,track=mailScrollTrack(box,heading?.getBoundingClientRect());
  bar.classList.add('mail-overlay-scrollbar');bar.dataset.mailScrollFor=element.id||'workspace';
  Object.assign(bar.style,{top:track.top+'px',left:(box.right-10)+'px',height:track.height+'px',width:'10px',zIndex:element.id==='side'&&mobile?'105':'65',visibility:!obscured&&box.width>0&&box.height>0&&box.right>0&&box.left<innerWidth?'visible':'hidden'});
 };
 const sync=()=>{frame=0;if(!active)return;
  for(const [element,instance] of ports)if(!element.isConnected||!element.matches(selector)){instance.destroy();ports.delete(element);sizes?.unobserve(element)}
  for(const element of document.querySelectorAll(selector)){
   if(!ports.has(element)&&element.getBoundingClientRect().width>0){
    const instance=OverlayScrollbars({target:element,elements:{viewport:element},scrollbars:{slot:document.body}},{overflow:{x:'hidden',y:'scroll'},scrollbars:{theme:'os-theme-eona',autoHide:'leave',autoHideDelay:450,dragScroll:true}});
    if(instance.elements().viewport!==element){instance.destroy();throw Error('Mail scroll owner changed')}
    ports.set(element,instance);sizes?.observe(element);
   }
  }
  for(const [element,instance] of ports)place(element,instance);
 };
 const schedule=()=>{if(active&&!frame)frame=requestAnimationFrame(sync)};
 const sizes=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
 const changes=new MutationObserver(records=>{if(records.some(record=>!record.target.closest?.('.os-scrollbar')))schedule()});
 // Native phone panning has no scrollbar portals or custom drag owner.
 const scrolled=event=>{if([...ports.keys()].some(node=>node!==event.target&&event.target.contains?.(node)))schedule()};
 const deactivate=()=>{active=false;changes.disconnect();sizes?.disconnect();cancelAnimationFrame(frame);frame=0;window.removeEventListener('resize',schedule);document.removeEventListener('scroll',scrolled,true);document.removeEventListener('transitionend',schedule);for(const instance of ports.values())instance.destroy();ports.clear()};
 const activate=()=>{deactivate();if(!desktop.matches)return;active=true;changes.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','data-mail-viewport']});window.addEventListener('resize',schedule);document.addEventListener('scroll',scrolled,true);document.addEventListener('transitionend',schedule);sync()};
 desktop.addEventListener('change',activate);activate();
 return {refresh:schedule,dispose(){desktop.removeEventListener('change',activate);deactivate()}};
}
