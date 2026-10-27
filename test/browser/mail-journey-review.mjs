// Loopback-only synthetic workspace harness. Never loaded by the product.
export function mailJourneyHarness() {
 const requests=[],faults=new Map(),delays=new Map();let serial=0,sends=0;
 const group=(method,path)=>path==='/api/routes'?'routes':/\/raw$|^\/api\/file$/.test(path)?'file':/\/send(?:\/|$)/.test(path)?'send':path.includes('/settings')?'settings':path.includes('/drafts')&&method!=='GET'?'draft':path.includes('/html')?'body':path.includes('/search/options')?'options':method==='GET'?'read':'write';
 return {
  async handle(req,res,url){
   if(url.pathname==='/journeys'){res.writeHead(200,{'content-type':'text/html'});res.end(mailJourneyPage);return true}
   if(url.pathname==='/__review/trace'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({requests,sends}));return true}
   if(url.pathname!=='/__review/control')return false;
   if(req.method!=='POST'){res.writeHead(405);res.end();return true}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=JSON.parse(Buffer.concat(chunks));
   if(!['read','write','body','options','settings','draft','send','file','routes'].includes(value.group)||!['normal','slow','fail-once','fail'].includes(value.mode)){res.writeHead(400);res.end();return true}
   if(value.delayMs!==undefined&&(!Number.isInteger(value.delayMs)||value.delayMs<0||value.delayMs>15000)){res.writeHead(400);res.end();return true}delays.set(value.group,value.delayMs??1200);faults.set(value.group,value.mode);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({group:value.group,mode:value.mode}));return true;
  },
  async before(method,url){
   if(!url.pathname.startsWith('/api/'))return {};
   const item={id:++serial,method,path:url.pathname,query:url.search,start:Date.now(),group:group(method,url.pathname)};requests.push(item);if(requests.length>500)requests.shift();
   const mode=faults.get(item.group);
   if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,delays.get(item.group)??1200));
   if(mode==='fail-once'||mode==='fail'){if(mode==='fail-once')faults.delete(item.group);item.status=503;item.end=Date.now();return {item,response:new Response(JSON.stringify({error:'隔离验收：读取或保存暂时失败，请重试。'}),{status:503,headers:{'content-type':'application/json'}})}}
   return {item};
  },
  after(item,response){if(item){item.status=response.status;item.end=Date.now()}},
  async send(_owner,message){sends++;return {accepted:[...message.to,...(message.cc||[]),...(message.bcc||[])].map(p=>p.address),rejected:[]}},
  probe:'<script>('+mailJourneyProbe.toString()+')();</script>'
 };
}

function mailJourneyProbe(){
 const events=[],network=[],feedbackIds=new WeakMap();let feedbackSerial=0;const feedbackId=n=>{if(!feedbackIds.has(n))feedbackIds.set(n,++feedbackSerial);return feedbackIds.get(n)};let sampling=false,until=0,last=0;
 const visible=n=>!!n&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).display!=='none'&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0;
 const text=n=>n?.textContent?.trim().slice(0,160)||'';
 const box=selector=>{const n=document.querySelector(selector);if(!visible(n))return null;const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scrollTop:n.scrollTop,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth}};
 const read=()=>({at:Math.round(performance.now()),width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,
  headerControls:[...document.querySelectorAll('#list .mail-workspace-title button,#list .mail-results-bar button')].filter(visible).map(n=>({text:text(n),height:n.getBoundingClientRect().height,font:getComputedStyle(n).font})),selection:{active:document.body.hasAttribute('data-mail-selecting'),items:[...document.querySelectorAll('.mail-action-row[data-selected] .mail')].map(n=>({...n.dataset}))},
  heading:text(document.querySelector('#list h1,#list h2')),readerTitle:text(document.querySelector('#view h1,#view h2')),query:document.querySelector('#q')?.value||'',
  selected:[...document.querySelectorAll('#side .item.on')].map(n=>({folder:n.dataset.folder||'',mailbox:n.dataset.mailbox||'',label:text(n)})),
  rows:[...document.querySelectorAll('#list [data-mail-id],#list [data-draft-open],#list [data-sent-open],#list [data-directory-open],#list [data-source-open]')].slice(0,12).map(n=>({...n.dataset})),
  inputs:[...document.querySelectorAll('input,textarea,[contenteditable=true]')].filter(visible).map(n=>({key:n.id||n.name||n.getAttribute('aria-label')||n.getAttribute('data-placeholder')||n.className,value:(n.value??n.textContent??'').slice(0,500)})),
  dialogs:[...document.querySelectorAll('dialog[open]')].filter(visible).map(n=>text(n.querySelector('h1,h2,h3'))),popovers:[...document.querySelectorAll(':popover-open')].filter(visible).map(n=>({label:n.getAttribute('aria-label')||'',text:text(n)})),
  feedback:[...document.querySelectorAll('[role=alert],[role=status],.e-toast-message')].filter(visible).map(text),pressed:document.querySelectorAll('[data-mail-pressed]').length,
  focus:document.activeElement?.id||document.activeElement?.getAttribute('aria-label')||document.activeElement?.name||document.activeElement?.tagName,
  layout:{list:box('#list'),view:box('#view'),settings:box('.mail-settings-page'),editor:box('#compose'),header:box('#app>header')},
  busy:[...document.querySelectorAll('[aria-busy=true]')].filter(visible).map(n=>n.id||n.className),bodyClasses:document.body.className,
  motion:[...document.getAnimations()].filter(a=>a.playState==='running').map(a=>({target:a.effect?.target?.className||'',time:Math.round(a.currentTime||0),duration:a.effect?.getTiming().duration})),toasts:[...document.querySelectorAll('.e-toast[data-variant=card]')].map(n=>({node:feedbackId(n),text:text(n),remaining:n.dataset.remainingSeconds,paused:n.dataset.timerPaused,rect:n.getBoundingClientRect().toJSON(),lifetimeDisplay:n.querySelector('.e-toast-lifetime')?getComputedStyle(n.querySelector('.e-toast-lifetime')).display:null,action:n.querySelector('.e-toast-action')?.textContent||'',actionRect:n.querySelector('.e-toast-action')?.getBoundingClientRect().toJSON()||null,progressRect:n.querySelector('.e-toast-time-track')?.getBoundingClientRect().toJSON()||null,disabled:n.querySelector('.e-toast-action')?.disabled||false})),batch:[...document.querySelectorAll('.mail-action-row[data-selected] [data-mail-id]')].map(n=>n.dataset.mailId),
  editorImages:document.querySelectorAll('[contenteditable=true] img').length,editorLinks:document.querySelectorAll('[contenteditable=true] a').length});
 const publish=()=>{document.documentElement.dataset.journeyState=JSON.stringify(read());document.documentElement.dataset.journeyTrace=JSON.stringify(events);document.documentElement.dataset.journeyNetwork=JSON.stringify(network)};
 const compact=()=>{const s=read();return {at:s.at,heading:s.heading,readerTitle:s.readerTitle,query:s.query,bodyClasses:s.bodyClasses,busy:s.busy,pressed:s.pressed,dialogs:s.dialogs,popovers:s.popovers,layout:s.layout,motion:s.motion,toasts:s.toasts,batch:s.batch,headerControls:s.headerControls,selection:s.selection}};
 const sample=now=>{if(now-last>=120){last=now;events.push({kind:'frame',state:compact()});if(events.length>60)events.shift();publish()}if(now<until)requestAnimationFrame(sample);else sampling=false};
 const wake=()=>{until=performance.now()+1600;if(!sampling){sampling=true;requestAnimationFrame(sample)}};
 const originalFetch=window.fetch;
 window.fetch=async(...args)=>{const entry={path:String(args[0]),method:args[1]?.method||'GET',start:Math.round(performance.now())};network.push(entry);if(network.length>100)network.shift();wake();try{const response=await originalFetch(...args);entry.status=response.status;response.clone().arrayBuffer().then(()=>{entry.end=Math.round(performance.now());wake()},()=>{entry.bodyFailed=true;wake()});return response}catch(error){entry.failed=true;throw error}finally{wake()}};
 const record=event=>{const n=event.target.closest?.('button,a,input,select,textarea,[data-mail-id],[data-draft-open],[data-directory-open]');events.push({kind:event.type,target:n?.id||n?.getAttribute('aria-label')||text(n),key:event.key||'',state:compact()});if(events.length>60)events.shift();wake()};
 for(const type of ['click','input','change','keydown','pointercancel','touchcancel'])document.addEventListener(type,record,true);
 document.addEventListener('DOMContentLoaded',wake);
 window.MailJourneyReview={read,events,reset:()=>{events.length=0}};
}

export const mailJourneyPage=`<!doctype html><meta charset="utf-8"><title>Mail 完整流程验收</title><style>body{margin:0;background:#f4f5f7;color:#172033;font:13px/1.5 system-ui}nav{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:8px}button,input,select{font:inherit;padding:6px 8px}iframe{display:block;margin:0 auto;width:390px;height:844px;border:1px solid #dce1e8;background:white}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px;max-height:250px;overflow:auto}</style><nav><strong>合成数据 · 完整业务源码 · 发送仅写隔离回执</strong><button data-width="320">320</button><button data-width="390">390</button><button data-width="1440">桌面</button><button id="theme">深浅切换</button><button id="keyboard">键盘高度</button><button id="history-back">浏览器后退</button><button id="history-forward">浏览器前进</button><select id="fault-group" aria-label="故障范围"><option value="read">列表读取</option><option value="routes">邮箱来源</option><option value="body">正文</option><option value="file">原文及附件</option><option value="write">操作保存</option><option value="settings">设置保存</option><option value="draft">草稿保存</option><option value="send">发送接口</option><option value="options">搜索选项</option></select><button data-mode="normal">正常</button><button data-mode="slow">延迟</button><button data-mode="fail-once">下次失败</button><button data-mode="fail">持续失败</button><input id="checkpoint" aria-label="记录名称" placeholder="流程及阶段"><button id="capture">记录状态</button><button id="clear-trace">清空过程</button></nav><iframe id="screen" title="Mail 合成工作区" src="/"></iframe><pre id="result" role="status"></pre><script>
const frame=document.getElementById('screen'),out=document.getElementById('result'),captures=[];let short=false;
document.querySelector('nav').onclick=async event=>{const b=event.target,d=frame.contentDocument,w=frame.contentWindow;if(b.dataset.width){frame.style.width=b.dataset.width+'px';return}if(b.id==='theme'){w.EonaUI.setAppearance(w.EonaUI.getAppearance()==='dark'?'light':'dark');return}if(b.id==='history-back'){w.history.back();return}if(b.id==='history-forward'){w.history.forward();return}if(b.id==='keyboard'){short=!short;frame.dataset.keyboardModel=String(short);frame.style.height=short?'400px':'844px';return}if(b.dataset.mode){const response=await fetch('/__review/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({group:document.getElementById('fault-group').value,mode:b.dataset.mode})});out.textContent=await response.text();return}if(b.id==='clear-trace'){captures.length=0;w.MailJourneyReview.reset();out.textContent='过程已清空';return}if(b.id==='capture'){captures.push({label:document.getElementById('checkpoint').value,state:w.MailJourneyReview.read(),events:[...w.MailJourneyReview.events]});const network=await(await fetch('/__review/trace')).json();out.textContent=JSON.stringify({captures:captures.slice(-1),network},null,2);document.documentElement.dataset.journeyEvidence=out.textContent}};
frame.addEventListener('load',()=>{const d=frame.contentDocument;const setKeyboard=height=>{if(short)frame.style.height=height+'px'};d.addEventListener('focusin',event=>{if(event.target.matches('input,textarea'))setKeyboard(400)});d.addEventListener('focusout',event=>{if(event.target.matches('input,textarea')&&!event.relatedTarget?.matches('input,textarea'))setKeyboard(844)});d.addEventListener('pointerdown',event=>{if(event.target.closest('.mail-search-sheet-close,.e-search-clear,[data-reset-search],[type=submit],.mail-search-filter-toggle'))requestAnimationFrame(()=>{frame.dataset.searchPointerEvidence=JSON.stringify({defaultPrevented:event.defaultPrevented,focused:d.activeElement?.getAttribute('name'),button:event.target.closest('button')?.getAttribute('aria-label'),height:frame.clientHeight})})},true)});
</script>`;
