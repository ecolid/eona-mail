export function translationBrowserScript(){return '('+mailTranslationController.toString()+')();';}
function mailTranslationController(){
 let current=null;
 const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.translationAction=action;return b;};
 window.installMailTranslation=function(mail){
  if(current?.abort)current.abort.abort();current=null;
  if(!mailCanTranslate(mail))return;
  const bar=document.createElement('div');bar.id='vtrans';bar.innerHTML=I.lang+'<span role="status">邮件可翻译为中文</span>';
  bar.append(button('全文翻译','translate'));
  const slot=document.querySelector('[data-mail-translation-slot]');if(slot)slot.append(bar);else document.querySelector('#vbody').before(bar);
  current={id:Number(mail.id),mail,bar,originalSubject:mail.subject,nodes:null,translated:null,showing:false,busy:false};
 };
 async function sourceNodes(c){
  const frame=document.querySelector('#vbody iframe');let root;
  if(frame){
   if(!frame.contentDocument?.body||frame.contentDocument.URL==='about:blank')await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('原邮件尚未加载，请稍后重试。')),10000);frame.addEventListener('load',()=>{clearTimeout(timer);resolve();},{once:true});});
   if(current!==c)throw Error('mail_changed');root=frame.contentDocument.body;
  }else root=document.querySelector('#vbody pre');
  if(!root)throw Error('原邮件尚未加载，请稍后重试。');
  const view=root.ownerDocument.defaultView;const walk=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];let node;
  while((node=walk.nextNode())){
   const p=node.parentElement,text=node.textContent.trim();
   if(!text||p.closest('script,style,noscript,svg,code,[hidden],[aria-hidden="true"]'))continue;
   const style=view?.getComputedStyle(p);if(style&&(style.display==='none'||style.visibility==='hidden'))continue;
   nodes.push({node,original:node.textContent,text});
  }
  return nodes;
 }
 function status(c,text){const s=c.bar.querySelector('[role=status]');if(s)s.textContent=text;}
 function controls(c,error){
  c.bar.toggleAttribute('data-translation-busy',c.busy);c.bar.toggleAttribute('data-translation-error',!!error);
  c.bar.querySelectorAll('button').forEach(x=>x.remove());
  c.bar.append(button(c.busy?'翻译中…':c.translated?(c.showing?'显示原文':'显示译文'):error?'重试':'全文翻译',c.translated?'toggle':'translate'));
  c.bar.querySelector('button').disabled=c.busy;
  if(c.busy){const close=button('取消','dismiss');close.className='translation-close';close.setAttribute('aria-label','取消翻译');c.bar.append(close)}
 }
 function toggle(c,show){
  if(!c.translated)return;
  const title=document.querySelector('#vhead h2');if(title)title.textContent=show?c.translated[0]:c.originalSubject;
  c.nodes.forEach((x,i)=>{x.node.textContent=show?x.original.replace(x.text,c.translated[i+1]):x.original;});
  const frame=document.querySelector('#vbody iframe');if(frame)frame.title=show?'邮件中文译文':'邮件原文';
  c.showing=show;status(c,show?'邮件已翻译为中文':'邮件可翻译为中文');controls(c);
 }
 async function translate(c){
  if(c.busy)return;c.busy=true;status(c,'正在翻译…');controls(c);c.abort=new AbortController();
  try{
   c.nodes=await sourceNodes(c);if(current!==c)return;
   const chunks=[];let chunk=[],size=0;for(const x of c.nodes){if(chunk.length&&(size+x.text.length>2000||chunk.length>=40)){chunks.push(chunk);chunk=[];size=0;}chunk.push(x.text);size+=x.text.length;}if(chunk.length)chunks.push(chunk);
   if(!chunks.length)throw Error('没有可翻译的正文。');
   const result=[];
   for(let i=0;i<chunks.length;i++){
    status(c,chunks.length>1?'正在翻译 '+(i+1)+' / '+chunks.length:'正在翻译…');
    const segments=chunks[i],abort=new AbortController();let expired=false;
    const cancel=()=>abort.abort();c.abort.signal.addEventListener('abort',cancel,{once:true});
    const timer=setTimeout(()=>{expired=true;abort.abort();},55000);
    let r;try{r=await api('/api/email/'+c.id+'/translate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({format:'inline-v1',segments}),signal:abort.signal});}catch(e){if(expired)throw Error('翻译等待超时，请重试。原邮件已保留。');throw e;}finally{clearTimeout(timer);c.abort.signal.removeEventListener('abort',cancel);}
    if(current!==c||c.abort.signal.aborted)return;
    if(!r.ok||r.version!==1||!Array.isArray(r.translated)||r.translated.length!==segments.length+1)throw Error(r.error||'翻译暂时不可用，请重试。');
    if(!i)result.push(r.translated[0]);result.push(...r.translated.slice(1));
   }
   c.translated=result;c.busy=false;toggle(c,true);
  }catch(error){
   if(current!==c||c.abort.signal.aborted)return;c.busy=false;status(c,error.message==='mail_changed'?'请选择当前邮件。':error.message||'翻译暂时不可用，请重试。');controls(c,true);
  }
 }
 document.addEventListener('click',event=>{
  const b=event.target.closest('[data-translation-action]');if(!b||!current)return;const c=current;
  if(b.dataset.translationAction==='translate')translate(c);
  else if(b.dataset.translationAction==='toggle')toggle(c,!c.showing);
  else if(b.dataset.translationAction==='dismiss'){if(c.abort)c.abort.abort();c.busy=false;status(c,'翻译已取消');controls(c);}
 });
}
