// The parent owns all interactive hit areas. WebKit does not dispatch parent
// listeners attached inside a script-disabled iframe (WebKit issue 218086).
// Email scripts, forms, popups and top navigation stay disabled.
export function mailBodyBrowserScript(){return makeMailResponsive.toString()+'\n('+mailBodyController.toString()+')();';}
// Widen email layout shells, not images or every cell in an invoice table.
export function makeMailResponsive(doc,content) {
 const view=doc.defaultView,wide=[];
 for(const node of content.querySelectorAll('table,div,td')){
  const style=view.getComputedStyle(node),explicit=[node.getAttribute('width'),node.style.width,style.maxWidth,style.minWidth].some(v=>/^\d+(?:\.\d+)?(?:px)?$/.test(v||'')&&parseFloat(v)>=480);
  if(!explicit)continue;
  if(node.tagName==='TD'&&[...node.parentElement.children].filter(c=>c.innerText.trim()||c.querySelector('img,video')).length>1)continue;
  wide.push(node);
 }
 const primary=wide.find(n=>!wide.some(other=>other!==n&&other.contains(n)));
 // Decorative gutters live outside the principal message, never in its brand banner.
 const neutral=color=>{const m=/^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);return m&&Math.max(...m.slice(1).map(Number))-Math.min(...m.slice(1).map(Number))<8&&Number(m[1])>=220};
 for(let parent=primary?.parentElement;parent&&parent!==doc.body;parent=parent.parentElement){if(neutral(view.getComputedStyle(parent).backgroundColor))parent.style.setProperty('background','#fff','important')}
 for(const node of wide){node.style.setProperty('width','100%','important');node.style.setProperty('max-width','100%','important');node.style.setProperty('min-width','0','important');node.style.boxSizing='border-box';node.dataset.mailFluid='true'}
 doc.documentElement.style.setProperty('background','#fff','important');doc.body.style.setProperty('background','#fff','important');
 return wide.length;
}
function mailBodyController(){
 function followMailLink(event,doc,source){
  const link=source||event.target.closest?.('a[href]');if(!link)return;
  event.preventDefault();if(!event.isTrusted)return;
  const trigger=event.currentTarget?.tagName==='BUTTON'?event.currentTarget:link;
  const raw=(link.dataset.mailOriginalHref||link.getAttribute('href'))?.trim();if(!raw)return;
  if(raw.startsWith('#')){try{doc.getElementById(decodeURIComponent(raw.slice(1)))?.scrollIntoView({block:'start'})}catch{}return;}
  let url;try{url=new URL(raw,doc.baseURI||doc.URL)}catch{mailToast('链接地址无法识别',{tone:'error'});return;}
  if(!['https:','http:','mailto:','tel:'].includes(url.protocol)||url.username||url.password){mailToast('此链接无法打开',{tone:'error'});return;}
  if(url.protocol==='mailto:'){
   let address;try{address=decodeURIComponent(url.pathname)}catch{mailToast('邮件地址无法识别',{tone:'error'});return}
   const parts=mailAddressParts(address);if(parts.length!==1||!parts[0].searchable){mailToast('邮件地址无法识别',{tone:'error'});return}
   showMailContact(trigger,parts[0]);return;
  }
  EonaUI.dismissPopovers();document.querySelector('[data-mail-link-dialog]')?.remove();
  const dialog=document.createElement('dialog');dialog.className='e-dialog mail-link-dialog';dialog.dataset.mailLinkDialog='';dialog.setAttribute('aria-labelledby','mail-external-link-title');
  const surface=document.createElement('section');surface.className='e-modal-surface';
  const title=document.createElement('h2');title.id='mail-external-link-title';title.textContent='打开邮件链接';
  const address=document.createElement('p');address.className='mail-link-address';address.textContent=url.href;
  const actions=document.createElement('div');actions.className='e-dialog-actions';
  const cancel=document.createElement('button');cancel.className='e-button';cancel.type='button';cancel.textContent='取消';
  const open=document.createElement('a');open.className='e-button mail-dialog-primary';open.textContent='在浏览器打开';open.href=url.href;open.target='_blank';open.rel='noopener noreferrer';open.referrerPolicy='no-referrer';
  actions.append(cancel,open);surface.append(title,address,actions);dialog.append(surface);document.body.append(dialog);
  const {close}=openMailDialog(dialog,{returnFocus:trigger,initialFocus:cancel});cancel.onclick=close;
  open.addEventListener('click',()=>{setTimeout(close,0)});
 }
 function linkify(root){
  const doc=root.ownerDocument,walker=doc.createTreeWalker(root,4),nodes=[];let node;
  while((node=walker.nextNode()))if(!node.parentElement.closest('a,style,script,title,textarea,code')&&/https?:\/\//i.test(node.data))nodes.push(node);
  for(const node of nodes){
   const text=node.data,fragment=doc.createDocumentFragment();let end=0;
   for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)){
    const url=match[0].replace(/[.,;!?]+$/,'');fragment.append(text.slice(end,match.index));const link=doc.createElement('a');link.href=url;link.textContent=url;fragment.append(link,text.slice(match.index+url.length,match.index+match[0].length));end=match.index+match[0].length;
   }
   fragment.append(text.slice(end));node.replaceWith(fragment);
  }
 }
 window.installMailTextLinks=function(root){
  linkify(root);const abort=new AbortController();root.addEventListener('click',event=>followMailLink(event,document),{signal:abort.signal});return()=>abort.abort();
 };
 window.installMailBodyFrame=function(frame,{reload}={}){
  const abort=new AbortController();let resize,mutation,poll=0,pending=0,connected=null,timer=0,observedDoc=null,feedbackTimer=0,phase='rendering',retrying=false;
  const holder=frame.parentElement,hitAreas=new Map();
  const status=document.createElement('div');status.className='mail-body-status';status.setAttribute('role','status');status.textContent='正在读取邮件正文…';status.hidden=true;feedbackTimer=setTimeout(()=>{if(frame.dataset.mailReady!=='true'&&!abort.signal.aborted)status.hidden=false},500);holder.prepend(status);
  const layer=document.createElement('div');layer.className='mail-body-links';layer.setAttribute('role','group');layer.setAttribute('aria-label','邮件链接');holder.append(layer);
  frame.style.visibility='hidden';frame.dataset.mailReady='false';
  const clearHits=()=>{for(const entry of hitAreas.values())for(const button of entry.buttons){button.mailContactDispose?.();button.remove()}hitAreas.clear()};
  const failure=(error,source=false)=>{
   if(abort.signal.aborted||frame.dataset.mailReady==='true'||!source&&phase!=='rendering')return;
   phase='failed';cancelAnimationFrame(poll);clearTimeout(timer);status.hidden=false;clearTimeout(feedbackTimer);status.setAttribute('role','alert');status.textContent=(typeof error==='string'?error:error?.message)||'邮件正文未能加载。';
   const retry=document.createElement('button');retry.className='btn';retry.textContent='重试';retry.onclick=async()=>{
    if(retrying||abort.signal.aborted)return;retrying=true;connected=null;clearHits();
    try{if(reload)await reload();else{status.setAttribute('role','status');status.textContent='正在读取邮件正文…';phase='rendering';if(frame.srcdoc)frame.srcdoc=frame.srcdoc;else frame.src=frame.src;start()}}finally{retrying=false}
   };status.append(retry);
  };
  const updateHits=doc=>{
   const sources=[...doc.querySelectorAll('a[href],a[data-mail-original-href]')],live=new Set(sources),outer=holder.getBoundingClientRect(),bounds=frame.getBoundingClientRect();
   for(const [link,entry] of hitAreas)if(!live.has(link)){for(const b of entry.buttons){b.mailContactDispose?.();b.remove()};hitAreas.delete(link)}
   for(const link of sources){
    if(link.hasAttribute('href')){const look=doc.defaultView.getComputedStyle(link);link.style.color=look.color;link.style.textDecoration=look.textDecoration;link.dataset.mailOriginalHref=link.getAttribute('href');link.removeAttribute('href');link.tabIndex=-1;}
    const rects=[...link.getClientRects()].filter(r=>r.width>0&&r.height>0);
    let entry=hitAreas.get(link);if(!entry){entry={buttons:[]};hitAreas.set(link,entry)}
    while(entry.buttons.length>rects.length){const old=entry.buttons.pop();old.mailContactDispose?.();old.remove()}
    const label=link.textContent.trim()||link.querySelector('img')?.alt||link.dataset.mailOriginalHref;
    rects.forEach((rect,i)=>{
     let button=entry.buttons[i];if(!button){button=document.createElement('button');button.type='button';button.className='mail-body-link-hit';button.addEventListener('click',event=>followMailLink(event,doc,link),{signal:abort.signal});layer.append(button);entry.buttons.push(button)}
     button.setAttribute('aria-label',label);button.tabIndex=i===0?0:-1;if(i)button.setAttribute('aria-hidden','true');else button.removeAttribute('aria-hidden');
     Object.assign(button.style,{left:(bounds.left-outer.left+rect.left)+'px',top:(bounds.top-outer.top+rect.top)+'px',width:rect.width+'px',height:rect.height+'px'});
    });
   }
  };
  const connect=()=>{
   if(abort.signal.aborted||!frame.isConnected)return false;
   let doc;try{doc=frame.contentDocument}catch{return false}
   if(!doc?.body||doc.URL==='about:blank')return false;
   if(doc!==observedDoc){observedDoc=doc;doc.addEventListener('error',event=>{if(event.target.matches?.('link[rel=stylesheet]'))event.target.dataset.mailStyleFailed='true'},{capture:true,signal:abort.signal});}
   if(doc.readyState==='loading')return false;if(doc===connected)return true;
   if(doc.readyState!=='complete'&&[...doc.querySelectorAll('link[rel=stylesheet]')].some(link=>!link.sheet&&!link.dataset.mailStyleFailed))return false;
   connected=doc;resize?.disconnect();mutation?.disconnect();clearHits();
   const meta=doc.createElement('meta');meta.name='viewport';meta.content='width=device-width,initial-scale=1';doc.head.append(meta);
   const style=doc.createElement('style');style.textContent='html{-webkit-text-size-adjust:100%;text-size-adjust:100%;overflow-x:hidden}body{margin:0!important;min-width:0!important;width:auto!important;height:auto!important;min-height:0!important;max-height:none!important;overflow-x:hidden;overflow-wrap:anywhere}img,video{max-width:100%;height:auto}';doc.head.append(style);
   const content=doc.createElement('div');content.dataset.eMailContent='';content.style.display='flow-root';while(doc.body.firstChild)content.append(doc.body.firstChild);doc.body.append(content);linkify(content);
   makeMailResponsive(doc,content);
   let fittedWidth=0,fittedHeight=0,fittedGeometry='';
   const fit=()=>{
    pending=0;if(abort.signal.aborted||!frame.isConnected)return;
    const width=frame.clientWidth;if(!width)return;
    content.style.zoom='1';content.style.width='auto';const natural=Math.max(width,content.scrollWidth),scale=Math.min(1,width/natural);
    if(scale<1)content.style.width=natural+'px';content.style.zoom=String(scale);frame.dataset.mailScale=String(scale);
    const contentHeight=content.getBoundingClientRect().height,height=Math.ceil(Math.max(contentHeight,doc.body.getBoundingClientRect().height));if(frame.style.height!==height+'px')frame.style.height=height+'px';
    fittedWidth=width;fittedHeight=contentHeight/scale;const geometry=width+':'+scale+':'+height;if(phase!=='ready'&&geometry!==fittedGeometry){fittedGeometry=geometry;schedule();return}updateHits(doc);phase='ready';frame.dataset.mailReady='true';frame.style.visibility='visible';status.hidden=true;clearTimeout(timer);clearTimeout(feedbackTimer);
   };
   const schedule=()=>{if(!pending)pending=requestAnimationFrame(fit)};
   resize=new ResizeObserver(entries=>{if(entries.some(e=>e.target===holder?Math.abs(e.contentRect.width-fittedWidth)>.5:Math.abs(e.contentRect.height-fittedHeight)>.5))schedule()});resize.observe(holder);resize.observe(content);
   mutation=new MutationObserver(schedule);mutation.observe(content,{childList:true,subtree:true,characterData:true});
   doc.addEventListener('load',schedule,{capture:true,signal:abort.signal});doc.fonts?.ready.then(()=>{if(!abort.signal.aborted)schedule()});
   fit();return true;
  };
  const watch=()=>{if(abort.signal.aborted||!frame.isConnected)return;if(!connect())poll=requestAnimationFrame(watch)};
  const start=()=>{phase='rendering';cancelAnimationFrame(poll);clearTimeout(timer);timer=setTimeout(failure,15000);poll=requestAnimationFrame(watch)};
  frame.addEventListener('load',()=>{if(phase==='rendering'&&frame.dataset.mailReady!=='true')connect()},{signal:abort.signal});frame.addEventListener('error',failure,{signal:abort.signal});if(!reload)start();
  const dispose=()=>{abort.abort();resize?.disconnect();mutation?.disconnect();cancelAnimationFrame(pending);cancelAnimationFrame(poll);clearTimeout(timer);clearTimeout(feedbackTimer);clearHits();layer.remove();status.remove();document.querySelector('[data-mail-link-dialog]')?.remove()};
  return Object.assign(dispose,{sourceLoading(){if(abort.signal.aborted)return;phase='source';frame.dataset.mailReady='false';cancelAnimationFrame(poll);clearTimeout(timer);clearTimeout(feedbackTimer);status.hidden=true;status.setAttribute('role','status');status.textContent='正在读取邮件正文…';feedbackTimer=setTimeout(()=>{if(phase==='source'&&!abort.signal.aborted)status.hidden=false},500)},sourceLoaded(){if(!abort.signal.aborted)start()},sourceFailed(error){failure(error,true)}});
 };
}
