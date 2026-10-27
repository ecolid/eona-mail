// One list owner arbitrates row actions and range selection with shell navigation.
// No message is changed until an explicit action is activated.
export function mailRangeSelection(ids,base,anchor,current,value=true){
 const a=ids.indexOf(anchor),b=ids.indexOf(current),next=new Set(base);
 if(a<0||b<0)return next;
 for(const id of ids.slice(Math.min(a,b),Math.max(a,b)+1))value?next.add(id):next.delete(id);
 return next;
}
export function mailTwoFingerIntent(start,points,active=false){
 if(points.length!==2)return 'cancel';
 const ordered=start.map((p,i)=>p.identifier===undefined?points[i]:points.find(q=>q.identifier===p.identifier));
 if(ordered.some(p=>!p))return 'cancel';
 const moves=ordered.map((p,i)=>({x:p.clientX-start[i].clientX,y:p.clientY-start[i].clientY}));
 const [a,b]=moves,travel=(Math.hypot(a.x,a.y)+Math.hypot(b.x,b.y))/2;
 const difference=Math.hypot(a.x-b.x,a.y-b.y),dx=(a.x+b.x)/2,dy=(a.y+b.y)/2;
 const opposite=a.x*b.x+a.y*b.y<0&&Math.min(Math.hypot(a.x,a.y),Math.hypot(b.x,b.y))>1.5;
 // Once selection owns the stream, compare recent motion rather than total
 // displacement. Unequal finger travel is normal; a separation can pause a
 // frame without permanently preventing the same gesture from continuing.
 if(active)return opposite&&difference>Math.max(12,Math.hypot(dx,dy)*2)?'hold':'select';
 // Track both contact vectors, not merely their midpoint or distance. Opposite
 // vertical motion and rotation can otherwise look like a translated range.
 if(opposite)return 'cancel';
 // Tiny common diagonal jitter is not a horizontal gesture. Keep the first
 // cancellable move while enough parallel travel accumulates to decide.
 if(Math.max(Math.abs(dx),Math.abs(dy))<8&&difference<12)return '';
 // Contact updates arrive separately. Wait through a bounded lead by either
 // finger before testing coherence; elapsed time between landings is irrelevant.
 // A stream already committed to native scrolling is rejected by the controller.
 if(Math.min(Math.hypot(a.x,a.y),Math.hypot(b.x,b.y))<2)return travel<18?'':'cancel';
 if(Math.abs(a.x-b.x)>Math.max(12,Math.abs(dy)*.45))return 'cancel';
 if(difference>Math.max(24,travel*1.25))return 'cancel';
 if(a.y*b.y<=0||Math.abs(dx)>Math.abs(dy)/1.4)return 'cancel';
 if(Math.min(Math.abs(a.y),Math.abs(b.y))<8)return '';
 return 'select';
}
export async function mailRemoveRows(ids){
 const keys=new Set(ids.map(String)),nodes=[...document.querySelectorAll('#list [data-mail-id]')].filter(n=>keys.has(n.dataset.mailId)).map(n=>n.closest('.mail-action-row')||n);
 await Promise.all(nodes.map(n=>new Promise(resolve=>{const finish=()=>{n.remove();resolve()};n.inert=true;if(matchMedia('(prefers-reduced-motion:reduce)').matches||!n.animate){finish();return}const height=n.getBoundingClientRect().height;n.style.overflow='hidden';const motion=n.animate([{height:height+'px',opacity:1},{height:'0px',opacity:0}],{duration:180,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});motion.onfinish=finish;motion.oncancel=finish})));
}
// Preserve the identity of surviving rows; the operation owns one visible commit.
export function mailReconcileList(host,markup){
 const next=document.createElement('div');next.innerHTML=markup;
 const current=new Map([...host.querySelectorAll('[data-mail-id]')].map(row=>[row.dataset.mailId,row]));
 for(const row of next.querySelectorAll('[data-mail-id]')){const old=current.get(row.dataset.mailId);if(!old)continue;old.className=row.className;if(old.innerHTML!==row.innerHTML)old.innerHTML=row.innerHTML;row.replaceWith(old.closest('.mail-action-row')||old)}
 host.replaceChildren(...next.childNodes);
}
export async function mailAnimateListCommit(host,commit){
 const motions=host.mailCommitMotions||[];for(const motion of motions)motion.cancel();
 const rows=()=>[...host.querySelectorAll('[data-mail-id]')].map(row=>({id:row.dataset.mailId,node:row.closest('.mail-action-row')||row}));
 const before=new Map(rows().map(({id,node})=>[id,node.getBoundingClientRect().top]));const scroll=host.scrollTop;
 commit();host.scrollTop=scroll;document.dispatchEvent(new Event('mail:list-actions'));
 host.mailCommitMotions=[];if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
 for(const {id,node} of rows()){const rect=node.getBoundingClientRect();if(rect.bottom<0||rect.top>document.documentElement.clientHeight)continue;const previous=before.get(id),delta=previous===undefined?-8:previous-rect.top;if(previous!==undefined&&Math.abs(delta)<.5||!node.animate)continue;
  const motion=node.animate([{transform:'translateY('+delta+'px)',opacity:previous===undefined?0:1},{transform:'translateY(0)',opacity:1}],{duration:240,easing:'cubic-bezier(.16,1,.3,1)'});host.mailCommitMotions.push(motion);
 }
 await Promise.all(host.mailCommitMotions.map(m=>m.finished.catch(()=>{})));
}
export function mailItemActions(item,value,{selectable=true,sourceIncluded=false}={}){
 if(!value)return [];
 if(item.kind==='received')return [
  {key:'open',label:'打开邮件',icon:'open'},
  {key:'reply',label:'回复',icon:'reply'},{key:'forward',label:'转发',icon:'forward'},
  {key:value.is_read?'unread':'read',label:value.is_read?'标为未读':'标为已读',icon:'read'},
  {key:value.is_starred?'unstar':'star',label:value.is_starred?'取消星标':'设为星标',icon:value.is_starred?'unstar':'star'},
  ...(selectable?[{key:'select',label:'选择邮件',icon:'check'}]:[]),
  {key:'download',label:'下载原始邮件',icon:'download'},
  {key:'block',label:'拉黑发件人',icon:'block',danger:true},
  {key:value.folder==='trash'?'restore':'trash',label:value.folder==='trash'?'恢复到收件箱':'移入垃圾箱',icon:value.folder==='trash'?'restore':'trash',danger:value.folder!=='trash'}];
 if(item.kind==='sent')return [{key:'open',label:'打开邮件',icon:'open'},{key:'forward',label:'转发',icon:'forward'},...(selectable?[{key:'select',label:'选择邮件',icon:'check'}]:[])];
 if(item.kind==='draft')return [{key:'edit',label:'继续编辑',icon:'edit'},...(selectable?[{key:'select',label:'选择草稿',icon:'check'}]:[]),{key:'discard',label:'丢弃草稿',icon:'trash',danger:true}];
 return [{key:'open',label:'查看往来邮件',icon:'open'},...(selectable?[{key:'select',label:item.kind==='contact'?'选择联系人':'选择订阅来源',icon:'check'}]:[]),...(item.kind==='contact'?[{key:'write',label:'写邮件',icon:'write'},{key:'important',label:value.important?'取消重要联系人':'设为重要联系人',icon:'important'}]:[]),{key:'source',label:sourceIncluded?'移出订阅列表':'加入订阅列表',icon:'source'}];
}
export function mailBatchActions(kind,values=[],folder='inbox'){
 if(kind==='received')return [{key:values.length&&values.every(v=>v?.is_read)?'unread':'read',label:values.length&&values.every(v=>v?.is_read)?'未读':'已读',icon:'read'},{key:'star',label:'星标',icon:'star'},{key:folder==='trash'?'restore':'trash',label:folder==='trash'?'恢复':'删除',icon:folder==='trash'?'restore':'trash',danger:folder!=='trash'}];
 if(kind==='sent')return [{key:'forward',label:'转发',icon:'forward'}];
 if(kind==='draft')return [{key:'discard',label:'丢弃',icon:'trash',danger:true}];
 if(kind==='source')return [{key:'exclude-source',label:'移出订阅',icon:'source'}];
 const important=values.length&&values.every(v=>v?.important);
 return [{key:important?'unimportant':'important',label:important?'取消重要':'设为重要',icon:'important'},{key:'include-source',label:'加入订阅',icon:'source'}];
}
export function mailActionBackdrop(event,dialog,close){
 if(event.target!==dialog)return false;const r=dialog.getBoundingClientRect();
 if(event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom)return false;
 close();return true;
}
// Native vertical panning is declared in CSS. Pointer cancellation releases the
// same row state used by touch range selection, without reserving tiny jitter.
export function bindMailRowPointerInput({list,readGesture,move,cancel,window:win=window}){
 if(!win.PointerEvent)return {primary:()=>undefined,reset(){},dispose(){}};
 const contacts=new Set(),abort=new AbortController();let primary;
 list.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;contacts.add(e.pointerId);primary=contacts.size===1?e.pointerId:undefined},{passive:true,signal:abort.signal});
 list.addEventListener('pointermove',e=>{const g=readGesture();if(contacts.size!==1||g?.two||g?.pointer!==e.pointerId)return;move({mailPointer:true,target:e.target,touches:[{clientX:e.clientX,clientY:e.clientY}],cancelable:e.cancelable,preventDefault:()=>e.preventDefault()})},{passive:false,signal:abort.signal});
 const release=e=>{contacts.delete(e.pointerId);if(!contacts.size)primary=undefined;if(e.type==='pointercancel'&&readGesture()?.pointer===e.pointerId)cancel()};
 for(const type of ['pointerup','pointercancel'])list.addEventListener(type,release,{passive:true,signal:abort.signal});
 return {primary:()=>primary,reset(){contacts.clear();primary=undefined},dispose(){abort.abort();contacts.clear();primary=undefined}};
}
export function mailListActionsBrowserScript(){return [bindMailRowPointerInput,mailRangeSelection,mailTwoFingerIntent,mailRemoveRows,mailReconcileList,mailAnimateListCommit,mailItemActions,mailBatchActions,mailActionBackdrop,installMailListActions].map(fn=>fn.toString()).join('\n');}
export function installMailListActions(){
 const list=document.getElementById('list'),root=document.getElementById('app');
 const selector='.mail[data-mail-id],.mail[data-sent-open],.mail[data-draft-open],.mail[data-directory-open]';
 const selected=new Set();let selecting=false,opened=null,gesture=null,sheet=null,busy=false,scrollFrame=0,range=null,scope='',multiContact=false,contactStart=null,selectionVisible=false,selectionMotion=null;
 const icons={check:EonaUI.icon('check'),close:EonaUI.icon('close'),more:I.more,star:I.star,unstar:I.starOn,trash:I.trash,restore:I.undo,open:I.mail,reply:I.back,forward:I.send,edit:I.edit,download:I.down,write:I.edit,important:I.star,source:I.mail,read:I.mail,block:I.block};
 const rows=()=>[...list.querySelectorAll(selector)];
 const kind=()=>identity(rows()[0])?.kind||(['contacts','important'].includes(state.folder)?'contact':state.folder==='subscriptions'?'source':state.folder==='drafts'?'draft':state.folder==='sent'?'sent':'received');
 const unit=()=>kind()==='contact'?'位':kind()==='source'?'个':'封';
 const identity=row=>row?.dataset.mailId!==undefined?{kind:'received',id:row.dataset.mailId}:row?.dataset.sentOpen?{kind:'sent',id:row.dataset.sentOpen}:row?.dataset.draftOpen?{kind:'draft',id:row.dataset.draftOpen}:row?.dataset.directoryOpen?{kind:state.folder==='subscriptions'?'source':'contact',id:row.dataset.directoryOpen}:null;
 const valueFor=item=>item.kind==='received'?(String(state.cur)===String(item.id)&&state.curMail)||activeMailPage?.readerPreviews?.get(String(item.id))||api.peek('/api/email/'+encodeURIComponent(item.id))?.email:item.kind==='sent'?MailWorkspace.row('sent',item.id):item.kind==='draft'?MailWorkspace.row('draft',item.id):item.kind==='source'?MailWorkspace.data.sources.find(m=>m.key===item.id):MailWorkspace.data.directory.find(m=>m.address===item.id);
 const button=(label,icon,action,danger=false)=>{const n=document.createElement('button');n.type='button';n.className='e-button';n.innerHTML=(icons[icon]||'')+'<span>'+esc(label)+'</span>';n.dataset.listAction=action;if(danger)n.dataset.danger='';return n};
 const paintQuick=(control,action)=>{const label={star:'星标',unstar:'取消星标',trash:'删除',restore:'恢复',edit:'编辑',important:action.label.startsWith('取消')?'取消重要':'设为重要',source:action.label.startsWith('移出')?'移出订阅':'加入订阅'}[action.key]||action.label;control.dataset.listAction=action.key;control.innerHTML='<span class="mail-quick-icon" aria-hidden="true">'+(icons[action.icon]||'')+'</span><span>'+esc(label)+'</span>';control.setAttribute('aria-label',action.label)};
 const rowLimit=wrap=>Math.min(Number(wrap.dataset.trayWidth)||232,document.documentElement.clientWidth*.62);
 const closeRow=()=>{if(!opened)return;opened.style.removeProperty('--mail-row-x');opened.removeAttribute('data-open');opened.querySelector('.mail-row-tray').inert=true;opened=null};
 const clearFeedback=()=>{for(const n of list.querySelectorAll('[data-mail-pressed]'))n.removeAttribute('data-mail-pressed')};
 const toolbar=document.createElement('div');toolbar.className='mail-selection-toolbar';toolbar.hidden=true;toolbar.setAttribute('aria-label','批量邮件操作');
 const read=button('已读','read','read');const all=button('全选','','all'),star=button('星标','star','star'),remove=button('删除','trash','trash',true),done=button('取消','close','done');const allLabel=document.createElement('span');all.innerHTML=icons.check;const allCopy=document.createElement('span');allCopy.className='mail-selection-all-copy';allCopy.append(allLabel);all.append(allCopy);done.hidden=true;toolbar.append(all,read,star,remove,done);list.parentElement.append(toolbar);
 const paintSelection=()=>{
  root.toggleAttribute('data-mail-selecting',selecting);document.body.toggleAttribute('data-mail-selecting',selecting);
  if(selectionVisible!==selecting){const current=toolbar.hidden?{opacity:0,transform:'translateY(24px) scale(.98)'}:{opacity:getComputedStyle(toolbar).opacity||1,transform:getComputedStyle(toolbar).transform||'none'};selectionVisible=selecting;selectionMotion?.cancel();selectionMotion=null;toolbar.inert=!selecting;if(selecting)toolbar.hidden=false;const finish=()=>{if(!selectionVisible)toolbar.hidden=true};if(!matchMedia('(prefers-reduced-motion:reduce)').matches&&toolbar.animate){const motion=toolbar.animate([current,selecting?{opacity:1,transform:'translateY(0) scale(1)'}:{opacity:0,transform:'translateY(16px) scale(.98)'}],{duration:selecting?280:160,easing:'cubic-bezier(.16,1,.3,1)'});selectionMotion=motion;motion.onfinish=()=>{if(selectionMotion===motion){selectionMotion=null;finish()}}}else finish()}
  toolbar.style.setProperty('--mail-selection-left',list.offsetLeft+12+'px');toolbar.style.setProperty('--mail-selection-width',Math.min(440,Math.max(240,list.clientWidth-24))+'px');
  const received=rows();
  for(const row of rows()){const id=identity(row),wrap=row.parentElement,check=wrap.querySelector('.mail-row-check');if(!check)continue;const on=selected.has(id.id);check.hidden=!selecting;check.setAttribute('aria-checked',String(on));check.setAttribute('aria-label',(on?'取消选择：':'选择：')+(row.querySelector('.subj,.mail-directory-name')?.textContent||valueFor(id)?.name||valueFor(id)?.address||'项目'));wrap.toggleAttribute('data-selected',on)}
  const allSelected=received.length&&received.every(r=>selected.has(identity(r).id));allLabel.textContent=allSelected?'全不选':'全选';all.setAttribute('aria-pressed',String(!!allSelected));all.setAttribute('aria-label',(allSelected?'取消全选':'全选')+'已加载的 '+received.length+' '+unit()+(kind()==='contact'?'联系人':kind()==='source'?'订阅来源':'邮件'));all.title=all.getAttribute('aria-label');done.textContent='取消';done.setAttribute('aria-label','取消选择，已选 '+selected.size+' '+unit());done.disabled=busy;
  const specs=mailBatchActions(kind(),[...selected].map(id=>valueFor({kind:kind(),id})),state.folder),controls=[read,star,remove];toolbar.style.setProperty('--mail-bulk-columns',String(specs.length+1));toolbar.setAttribute('aria-label',kind()==='contact'?'批量联系人操作':kind()==='source'?'批量订阅操作':'批量邮件操作');
  for(let i=0;i<controls.length;i++){const n=controls[i],spec=specs[i];n.hidden=!spec;if(!spec)continue;n.dataset.listAction=spec.key;n.innerHTML=(icons[spec.icon]||'')+'<span>'+esc(spec.label)+'</span>';n.toggleAttribute('data-danger',!!spec.danger);n.disabled=busy||!selected.size}all.disabled=busy;
  toolbar.dataset.compact=String(toolbar.clientWidth<280);if(selecting){const inset=Math.ceil(toolbar.offsetHeight+(parseFloat(getComputedStyle(toolbar).bottom)||0)+12);document.body.style.setProperty('--mail-selection-toast-bottom',inset+'px');list.style.setProperty('--mail-selection-inset',inset+'px')}else{document.body.style.removeProperty('--mail-selection-toast-bottom');list.style.removeProperty('--mail-selection-inset')}
  const toggle=list.querySelector('[data-mail-select-toggle]');if(toggle){const label=selecting?'取消':'选择';if(toggle.dataset.label!==label){toggle.dataset.label=label;toggle.innerHTML='<span class="mail-header-action-face">'+(selecting?icons.close:icons.check)+'<span data-mail-header-label>'+label+'</span></span>'}toggle.hidden=false;toggle.setAttribute('aria-label',selecting?'取消选择':'选择');toggle.setAttribute('aria-pressed',String(selecting));toggle.disabled=busy||(!received.length&&!selecting)}
  const resultHead=list.querySelector('.mail-results-bar');if(resultHead){let label=resultHead.querySelector('.mail-selection-title');if(selecting){if(!label){label=document.createElement('strong');label.className='mail-selection-title';label.setAttribute('role','status');resultHead.prepend(label)}label.textContent='已选 '+selected.size+' '+unit()}else label?.remove()}
  const title=list.querySelector('.mail-workspace-title h1');if(title){if(selecting){title.dataset.mailSelectionTitle??=title.textContent;title.setAttribute('aria-live','polite');title.textContent='已选 '+selected.size+' '+unit()}else if(title.dataset.mailSelectionTitle!==undefined){title.textContent=title.dataset.mailSelectionTitle;delete title.dataset.mailSelectionTitle;title.removeAttribute('aria-live')}}
 };
 const exitSelection=()=>{selecting=false;selected.clear();paintSelection();return selectionMotion?.finished?.catch(()=>{})||Promise.resolve()};
 const startSelection=()=>{EonaUI.dismissPopovers?.();closeRow();selecting=true;paintSelection()};
 const actions=item=>mailItemActions(item,valueFor(item),{selectable:!!rows().length,sourceIncluded:!!MailWorkspace.data.sources?.find(s=>s.key===(item.kind==='source'?item.id:'sender:'+item.id))?.included});
 const run=async(item,key,trigger)=>{
  const value=valueFor(item),generation=MailWorkspace.identityGeneration;if(!value)throw Error('此项目已更新，请重新打开。');closeRow();
  if(key==='open')return item.kind==='received'?openMail(item.id):item.kind==='sent'?openMailSent(item.id):item.kind==='draft'?openMailWorkspaceDetail(item.id,'drafts'):openMailWorkspaceDetail(item.id,state.folder);
  if(key==='select'){if(document.body.classList.contains('viewing'))returnToMailList();startSelection();selected.add(item.id);paintSelection();return}
  if(key==='edit')return openMailDraft(item.id);
  if(key==='write')return openMailCompose({address:value.address});
  if(key==='important')return MailWorkspace.important(value,!MailWorkspace.isImportant(value.address));
  if(key==='source'){const sourceKey=item.kind==='source'?item.id:'sender:'+item.id,source=MailWorkspace.data.sources.find(s=>s.key===sourceKey);return MailWorkspace.sourcePreference(sourceKey,!source?.included)}
  if(key==='discard'){if(await EonaUI.confirm({title:'丢弃草稿',description:'此草稿将被删除。',action:'丢弃草稿',danger:true})&&generation===MailWorkspace.identityGeneration){await MailWorkspace.remove(value);mailToast('草稿已丢弃',{tone:'success'});return renderMailWorkspace()}return}
  if(key==='download')return downloadMailResource(trigger,'/api/email/'+encodeURIComponent(item.id)+'/raw',{name:'mail-'+item.id+'.eml',label:'原始邮件'});
  if(key==='block')return blockSender(value.from_addr);
  if(['trash','restore','star','unstar','read','unread'].includes(key))return act(item.id,key);
  if(key==='reply'||key==='forward'){
   const result=await api(item.kind==='sent'?'/api/mail-workspace/sent/'+encodeURIComponent(item.id):'/api/email/'+encodeURIComponent(item.id));if(generation!==MailWorkspace.identityGeneration)return;
   const mail=result.email||result.message,subject=mail.subject||'',body=mail.text_body||mail.body||'',from=mail.from_addr||mail.from?.address||'';
   return openMailCompose({address:key==='reply'?from:'',subject:(key==='reply'?/^re:/i:/^fwd?:/i).test(subject)?subject:(key==='reply'?'Re: ':'Fwd: ')+subject,body:'\n\n'+(key==='reply'?'原邮件：':'转发邮件：')+'\n'+body});
  }
 };
 const showMore=(row,returnFocus,requested)=>{
  if(busy)return;if(sheet){sheet.close();return}const item=requested||identity(row),value=valueFor(item);if(!value)return;closeRow();
  const mobile=matchMedia('(max-width:860px)').matches,dialog=document.createElement(mobile?'dialog':'div');dialog.className=mobile?'e-dialog mail-action-sheet':'e-menu mail-action-popover';dialog.setAttribute('aria-label','邮件操作');
  const head=document.createElement('header'),copy=document.createElement('div'),title=document.createElement('h2'),sub=document.createElement('p');title.textContent=value.subject||value.name||value.address||'邮件操作';sub.textContent=item.kind==='received'?value.from_name||value.from_addr:item.kind==='sent'?'已发送':item.kind==='draft'?'草稿':value.address||value.addresses?.join('、')||'';copy.append(title,sub);const close=button('关闭','','close');close.classList.add('mail-sheet-close');close.setAttribute('aria-label','关闭操作抽屉');close.innerHTML=I.close;head.append(copy,close);if(mobile)dialog.append(head);
  const body=document.createElement('div');body.className='mail-sheet-actions';for(const action of actions(item))body.append(button(action.label,action.icon,action.key,action.danger));dialog.append(body);
  const error=document.createElement('p');error.className='mail-sheet-error';error.setAttribute('role','alert');error.hidden=true;dialog.append(error);document.body.append(dialog);
  const generation=MailWorkspace.identityGeneration,trigger=(returnFocus?.closest('.mail-row-tray')?row?.querySelector('.mail-open')||row:returnFocus)||row?.querySelector('.mail-open')||row;let closed;
  if(mobile){const previousOverflow=list.style.overflowY;list.style.overflowY='hidden';sheet=openMailDialog(dialog,{returnFocus:trigger,initialFocus:close,onClosed:()=>{sheet=null;list.style.overflowY=previousOverflow;if(trigger?.isConnected)trigger.focus({preventScroll:true})}});close.onclick=()=>sheet?.close();dialog.addEventListener('click',event=>mailActionBackdrop(event,dialog,()=>sheet?.close()));closed=()=>new Promise(resolve=>{dialog.addEventListener('close',resolve,{once:true});sheet?.close()})}
  else{const binding=EonaUI.bindPopover(trigger,dialog);dialog.showPopover();EonaUI.positionPopover(trigger,dialog);trigger.setAttribute('aria-expanded','true');row?.parentElement.setAttribute('data-menu-open','');let disposed=false;const cleanup=()=>{if(disposed)return;disposed=true;binding.dispose();dialog.remove();sheet=null;row?.parentElement.removeAttribute('data-menu-open');trigger.blur?.()};dialog.addEventListener('toggle',()=>{if(!dialog.matches(':popover-open'))cleanup()});sheet={close:cleanup};closed=async()=>cleanup()}
  body.onclick=async event=>{const control=event.target.closest('[data-list-action]');if(!control||control.disabled)return;if(generation!==MailWorkspace.identityGeneration){sheet?.close();return}const key=control.dataset.listAction;
   if(key!=='download'){await closed();run(item,key,control).catch(e=>mailToast(e.message,{tone:'error'}));return}
   control.disabled=true;try{await run(item,key,control)}catch(e){error.textContent=e.message;error.hidden=false}finally{control.disabled=false}
  };
 };
 const enhance=()=>{
  const next=mailPageKey()+':'+MailWorkspace.identityGeneration;if(scope!==next){scope=next;cancel();closeRow();if(selecting)exitSelection();sheet?.close()}
  for(const wrap of list.querySelectorAll('.mail-action-row'))if(!wrap.querySelector(selector))wrap.remove();
  const actual=rows();for(const row of actual){if(row.parentElement.classList.contains('mail-action-row')){const item=identity(row),tray=row.parentElement.querySelector('.mail-row-tray'),star=tray?.querySelector('[data-list-action=star],[data-list-action=unstar]'),value=valueFor(item);if(star&&value)paintQuick(star,{key:value.is_starred?'unstar':'star',icon:value.is_starred?'unstar':'star',label:value.is_starred?'取消星标':'设为星标'});continue;}const item=identity(row),wrap=document.createElement('div');wrap.className='mail-action-row';row.before(wrap);wrap.append(row);
   const check=button('','','select-row');check.className='mail-row-check';check.setAttribute('role','checkbox');check.innerHTML='<span aria-hidden="true">'+(EonaUI.icon('check')||'')+'</span>';check.hidden=true;wrap.append(check);
   const menu=button('更多操作','more','more');menu.className='mail-row-menu';menu.innerHTML=I.more;menu.setAttribute('aria-label','更多操作');menu.setAttribute('aria-haspopup','menu');wrap.append(menu);
   const tray=document.createElement('div');tray.className='mail-row-tray';tray.setAttribute('aria-label','快捷操作');tray.inert=true;
   const moreQuick=button('更多','more','more');paintQuick(moreQuick,{key:'more',icon:'more',label:'更多'});tray.append(moreQuick);const quick=actions(item).filter(a=>item.kind==='received'?['star','unstar','trash','restore'].includes(a.key):item.kind==='draft'?a.key==='edit':item.kind==='sent'?a.key==='forward':['important','source'].includes(a.key));for(const action of quick.slice(0,2)){const control=button(action.label,action.icon,action.key,action.danger);paintQuick(control,action);tray.append(control)}wrap.dataset.trayWidth=String(tray.children.length*64+(tray.children.length-1)*8+24);wrap.style.setProperty('--mail-tray-width',wrap.dataset.trayWidth+'px');wrap.append(tray);
  }
  const head=list.querySelector('.mail-workspace-title,.mail-results-bar');if(head&&!head.closest('.mail-page-skeleton')&&!head.querySelector('[data-mail-select-toggle]')){const toggle=button('选择','','toggle');toggle.dataset.mailSelectToggle='';toggle.onclick=()=>selecting?exitSelection():startSelection();head.append(toggle)}
  if(selecting){const available=new Set(actual.map(r=>identity(r).id));for(const id of selected)if(!available.has(id))selected.delete(id)}paintSelection();
 };
 const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&(n.matches?.(selector+',.mail-workspace-title,.mail-results-bar,.mail-action-row')||n.querySelector?.(selector+',.mail-workspace-title,.mail-results-bar')))))enhance()});observer.observe(list,{childList:true,subtree:true});
 const setOffset=(wrap,x)=>{wrap.style.setProperty('--mail-row-x',x+'px');wrap.querySelector('.mail-row-tray').inert=x>-25};
 const cancel=()=>{const consumed=!!(gesture?.owned||gesture?.reserved);if(gesture?.two&&gesture.owned){selected.clear();for(const id of gesture.base)selected.add(id);selecting=gesture.wasSelecting;paintSelection()}gesture=null;range=null;contactStart=null;cancelAnimationFrame(scrollFrame);scrollFrame=0;if(opened?.hasAttribute('data-dragging')){opened.removeAttribute('data-dragging');closeRow()}clearFeedback();return consumed};
 // Check controls are siblings of the row; both surfaces resolve one identity.
 const rowAt=(x,y)=>{const hit=document.elementFromPoint(x,y);return hit?.closest(selector)||hit?.closest('.mail-action-row')?.querySelector(selector)};
 const updateRange=()=>{if(!gesture?.two||!range)return;const visible=rows(),r=list.getBoundingClientRect(),hit=rowAt(range.x,Math.max(r.top+2,Math.min(r.bottom-2,range.y))),item=identity(hit);if(item&&item.kind===kind())gesture.last=item.id;const next=mailRangeSelection(visible.map(r=>identity(r).id),gesture.base,gesture.anchor,gesture.last,true);selected.clear();for(const id of next)selected.add(id);paintSelection();const delta=range.y<r.top+48?-10:range.y>r.bottom-56?10:0;if(delta){list.scrollTop+=delta;scrollFrame=requestAnimationFrame(updateRange)}};
 const pointerInput=bindMailRowPointerInput({list,readGesture:()=>gesture,move:event=>binding.move(event),cancel:()=>cancel()});
 const binding={
  get selecting(){return selecting},
  start(event,mode){
   const firstId=gesture?.firstId??contactStart?.firstId,previousContact=contactStart;cancel();multiContact=false;if(mode!=='list'||busy){event.mailGestureDecision=busy?'list-busy':'surface-'+mode;return false}const points=[...event.touches],row=event.target.closest?.(selector)||event.target.closest?.('.mail-action-row')?.querySelector(selector)||(points.length===2&&list.contains(event.target)?rowAt(points[0].clientX,points[0].clientY):null);if(!row){event.mailGestureDecision='outside-row';return false}const item=identity(row);multiContact=points.length>1;contactStart=points.length>1?previousContact:{top:list.scrollTop,firstId:points[0]?.identifier,anchor:item.id};
   // Vertical intent is not proof of native ownership: the shell may own an
   // uncommitted pull. A joining finger can take that cancellable stream over.
   // Passive touchstart can be non-cancellable even when the first move is
   // available. Admit the pair here; only a move proves native ownership.
   if(points.length===2){if(previousContact&&Math.abs(list.scrollTop-previousContact.top)>1){event.mailGestureDecision='native-scroll';return false;}const first=points.find(p=>firstId!==undefined&&p.identifier===firstId)||points[0],anchor=rows().find(r=>identity(r).id===previousContact?.anchor)||rowAt(first.clientX,first.clientY);if(!anchor||identity(anchor)?.kind!==item.kind||points.some(p=>identity(rowAt(p.clientX,p.clientY))?.kind!==item.kind)){event.mailGestureDecision='outside-pair-scope';return false;}const id=identity(anchor).id;gesture={two:true,firstId:first.identifier,start:points.map(p=>({identifier:p.identifier,clientX:p.clientX,clientY:p.clientY})),anchor:id,last:id,base:new Set(selected),wasSelecting:selecting,owned:false,reserved:false};event.mailGestureDecision='pair-pending';return true}
   if(points.length!==1||event.target.closest('.mail-row-menu,[data-copy]')||!selecting&&event.target.closest('.mail-row-check'))return false;
   const p=points[0],width=document.documentElement.clientWidth;if(p.clientX<20||p.clientX>width-20)return false;gesture={row,wrap:row.parentElement,pointer:pointerInput.primary(),firstId:p.identifier,selectionOnly:selecting,x:p.clientX,y:p.clientY,start:opened===row.parentElement?-rowLimit(row.parentElement):0,owned:false};return false;
  },
  move(event){
   const g=gesture;if(!g)return false;
   // Waiting for 16px before cancelling lets iOS own the first small pan.
   if(g.two){if(event.touches.length!==2){cancel();return false}const points=[...event.touches],intent=mailTwoFingerIntent(g.owned?g.previous:g.start,points,g.owned);event.mailGestureDecision='pair-'+(intent||'pending');if(g.owned)g.previous=points.map(p=>({identifier:p.identifier,clientX:p.clientX,clientY:p.clientY}));if(intent==='native')return false;if(intent==='hold'){cancelAnimationFrame(scrollFrame);scrollFrame=0;if(event.cancelable)event.preventDefault();clearFeedback();return true}if(intent==='cancel'){const owned=cancel();if(owned&&event.cancelable)event.preventDefault();return owned}if(!event.cancelable){event.mailGestureDecision='pair-native-locked';cancel();return false}event.preventDefault();g.reserved=true;clearFeedback();if(!g.owned&&!intent)return true;if(!g.owned){g.owned=true;g.previous=points.map(p=>({identifier:p.identifier,clientX:p.clientX,clientY:p.clientY}));closeRow();selecting=true}clearFeedback();const p=points;range={x:(p[0].clientX+p[1].clientX)/2,y:(p[0].clientY+p[1].clientY)/2};cancelAnimationFrame(scrollFrame);updateRange();return true}
   if(g.selectionOnly)return false;if(g.pointer!==undefined&&!event.mailPointer)return !!g.owned;if(event.touches.length!==1){cancel();return false}const p=event.touches[0],dx=p.clientX-g.x,dy=p.clientY-g.y;
   if(!g.owned){if(Math.max(Math.abs(dx),Math.abs(dy))<16)return false;if(Math.abs(dy)>Math.abs(dx)/1.6||dx>0&&!g.start){gesture=null;closeRow();return false}if(!event.cancelable){cancel();return false}closeRow();opened=g.wrap;g.owned=true;g.wrap.setAttribute('data-dragging','');clearFeedback()}
   event.preventDefault();const limit=rowLimit(g.wrap);g.offset=Math.max(-limit,Math.min(0,g.start+dx));g.dx=dx;setOffset(g.wrap,g.offset);return true;
  },
  end(event){const g=gesture,wasMulti=multiContact;multiContact=false;if(!event.touches.length)contactStart=null;if(!g)return wasMulti?'suppress-click':false;gesture=null;range=null;cancelAnimationFrame(scrollFrame);scrollFrame=0;if(!g.owned)return wasMulti?'suppress-click':false;event.preventDefault();clearFeedback();if(g.two){paintSelection();return true}g.wrap.removeAttribute('data-dragging');const keepOpen=g.start<0?g.dx<32:g.offset<=-56;if(keepOpen){g.wrap.setAttribute('data-open','');setOffset(g.wrap,-rowLimit(g.wrap));opened=g.wrap}else closeRow();return true},
  cancel(){pointerInput.reset();return cancel()},
 };
 document.addEventListener('click',event=>{const more=event.target.closest('[data-mail-more]');if(!more||!state.cur)return;event.preventDefault();event.stopImmediatePropagation();showMore(rows().find(r=>r.dataset.mailId===String(state.cur)),more,{kind:'received',id:String(state.cur)})},true);
 list.addEventListener('click',event=>{
  const row=event.target.closest('.mail-action-row')?.querySelector(selector),trigger=event.target.closest('[data-list-action]');
  if(!row)return;row.parentElement.removeAttribute('data-row-hover');const item=identity(row);if(busy){event.preventDefault();event.stopImmediatePropagation();return}if(trigger){event.preventDefault();event.stopImmediatePropagation();const key=trigger.dataset.listAction;if(key==='more')showMore(row,trigger);else if(key==='select-row'){selected.has(item.id)?selected.delete(item.id):selected.add(item.id);paintSelection()}else run(item,key,trigger).catch(e=>mailToast(e.message,{tone:'error'}));return}
  if(selecting){event.preventDefault();event.stopImmediatePropagation();selected.has(item.id)?selected.delete(item.id):selected.add(item.id);paintSelection();return}if(opened){event.preventDefault();event.stopImmediatePropagation();closeRow()}
 },true);
 list.addEventListener('keydown',event=>{const row=event.target.closest(selector);if(event.key==='Escape'){if(opened){closeRow();event.preventDefault();event.stopPropagation()}else if(selecting){exitSelection();event.preventDefault();event.stopPropagation()}}if(row&&(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){event.preventDefault();showMore(row,event.target)}});
 list.addEventListener('contextmenu',event=>{const row=event.target.closest(selector);if(!row||window.getSelection()?.toString())return;event.preventDefault();showMore(row,event.target)});
 list.addEventListener('pointermove',event=>{for(const n of list.querySelectorAll('[data-row-hover]'))n.removeAttribute('data-row-hover');if(event.pointerType==='mouse')event.target.closest('.mail-action-row')?.setAttribute('data-row-hover','')},{passive:true});
 list.addEventListener('pointerleave',()=>{for(const n of list.querySelectorAll('[data-row-hover]'))n.removeAttribute('data-row-hover')});
 list.addEventListener('scroll',()=>{for(const n of list.querySelectorAll('[data-row-hover]'))n.removeAttribute('data-row-hover');if(!gesture?.owned)closeRow()},{passive:true});
 document.addEventListener('pointerdown',event=>{if(opened&&!opened.contains(event.target))closeRow()},{capture:true,passive:true});
 document.addEventListener('mail:list-actions',enhance);
 document.addEventListener('mail:surface',()=>{binding.cancel();closeRow();if(document.body.classList.contains('viewing'))exitSelection();enhance()});
 window.addEventListener('blur',()=>{binding.cancel();closeRow()});document.addEventListener('visibilitychange',()=>{if(document.hidden){binding.cancel();closeRow()}});
 toolbar.onclick=async event=>{const trigger=event.target.closest('[data-list-action]');if(!trigger||busy)return;const op=trigger.dataset.listAction;if(op==='done'){cancel();exitSelection();list.querySelector('[data-mail-select-toggle]')?.focus?.({preventScroll:true});return}if(op==='all'){const ids=rows().map(r=>identity(r).id),on=ids.every(id=>selected.has(id));selected.clear();if(!on)for(const id of ids)selected.add(id);paintSelection();return}
  if(kind()!=='received'){
   const type=kind(),generation=MailWorkspace.identityGeneration,ids=[...selected],values=new Map(ids.map(id=>[id,valueFor({kind:type,id})]));
   if(op==='discard'&&!await EonaUI.confirm({title:'丢弃 '+ids.length+' 封草稿',description:'仅丢弃选中的已保存草稿。未保存或版本已变化的草稿会保留。',action:'丢弃草稿',danger:true}))return;
   busy=true;paintSelection();const completed=[],failed=[],before=new Map();
   try{
    if(op==='forward'){
     const parts=[];for(const id of ids){const result=await api('/api/mail-workspace/sent/'+encodeURIComponent(id));if(generation!==MailWorkspace.identityGeneration)return;const m=result.message;if(!m)throw Error('邮件内容未能读取，请重试。');parts.push('主题：'+(m.subject||'无主题')+'\n'+(m.text_body||m.body||''))}
     await exitSelection();return openMailCompose({subject:ids.length===1?'Fwd: '+(values.get(ids[0])?.subject||''):'转发 '+ids.length+' 封邮件',body:parts.join('\n\n────────\n\n')});
    }
    for(const id of ids){if(generation!==MailWorkspace.identityGeneration)return;const value=values.get(id);try{
     if(!value)throw Error('项目已变化');let result;
     if(op==='discard'){if(value.unsaved||value.conflict)throw Error('草稿有未保存更改');result=await MailWorkspace.remove(value)}
     else if(op==='important'||op==='unimportant'){before.set(id,!!value.important);result=await MailWorkspace.important(value,op==='important',{quiet:true,undoable:false})}
     else{const key=type==='source'?id:'sender:'+id;before.set(id,!!MailWorkspace.data.sources.find(s=>s.key===key)?.included);result=await MailWorkspace.sourcePreference(key,op==='include-source',{quiet:true,undoable:false})}
     if(result===false||result?.ok===false)throw Error('操作未完成');completed.push(id);selected.delete(id);
    }catch{failed.push(id)}}
    if(generation!==MailWorkspace.identityGeneration)return;let refreshFailed=false;try{await MailWorkspace.load(true)}catch{refreshFailed=true}if(!failed.length)await exitSelection();renderMailWorkspace();loadSide();
    const feedbackId='mail-batch:'+generation+':'+op+':'+completed.join(','),remaining=new Set(completed),verb={discard:'已丢弃',important:'已设为重要联系人',unimportant:'已取消重要联系人','include-source':'已加入订阅列表','exclude-source':'已移出订阅列表'}[op];
    mailToast((completed.length?verb+' '+completed.length+' '+(type==='contact'?'位':type==='source'?'个':'封'):'操作未完成')+(failed.length?'，'+failed.length+' 项未完成，请重试':'')+(refreshFailed?'，列表刷新失败，请刷新核对':''),{id:feedbackId,tone:failed.length||refreshFailed?'error':'success',...(completed.length&&op!=='discard'?{action:{label:'撤销',run:async()=>{if(generation!==MailWorkspace.identityGeneration)throw Error('账号已变化，请重新操作。');for(const id of [...remaining]){const result=op==='important'||op==='unimportant'?await MailWorkspace.important(values.get(id),before.get(id),{quiet:true,undoable:false}):await MailWorkspace.sourcePreference(type==='source'?id:'sender:'+id,before.get(id),{quiet:true,undoable:false});if(result!==false)remaining.delete(id)}await MailWorkspace.load(true);renderMailWorkspace();loadSide();if(remaining.size)throw Error('还有 '+remaining.size+' 项未恢复，请重试。');mailToast('已撤销',{id:feedbackId,tone:'success'})}}}:{})});
   }catch(error){mailToast(error.message,{tone:'error'})}finally{busy=false;paintSelection()}return;
  }
  busy=true;paintSelection();const generation=MailWorkspace.identityGeneration,ids=[...selected],previousStars=new Map(ids.map(id=>[id,!!valueFor({kind:'received',id})?.is_starred])),done=[],failed=[];
  try{for(const id of ids){if(generation!==MailWorkspace.identityGeneration)break;const result=await act(id,op,{quiet:true,deferRemoval:true});if(result?.ok===false||result===false)failed.push(id);else{done.push(id);selected.delete(id)}}if(generation!==MailWorkspace.identityGeneration)return;if(op==='trash'||op==='restore')await mailRemoveRows(done);if(!failed.length){await exitSelection();await loadList({fresh:true,transition:true})}MailWorkspace.load(true).then(()=>loadSide()).catch(()=>{});
   if(!failed.length)exitSelection();const feedbackId='mail-batch:'+generation+':'+op+':'+done.join(','),undoRemaining=new Set(done);const message=!done.length?'未能处理 '+failed.length+' 封，请重试':(op==='trash'?'已移入垃圾箱 ':op==='restore'?'已恢复 ':op==='read'?'已标为已读 ':op==='unread'?'已标为未读 ':'已加星标 ')+done.length+' 封'+(failed.length?'，'+failed.length+' 封未完成，请重试':'');
   mailToast(message,{id:feedbackId,tone:failed.length?'error':'success',...(op==='star'&&done.length?{action:{label:'恢复原星标',pending:'正在恢复星标…',run:async()=>{if(generation!==MailWorkspace.identityGeneration)throw Error('账号已变化，请重新操作。');for(const id of [...undoRemaining]){const result=await act(id,previousStars.get(id)?'star':'unstar',{quiet:true});if(result!==false&&result?.ok!==false)undoRemaining.delete(id)}if(undoRemaining.size)throw Error('还有 '+undoRemaining.size+' 封星标未恢复，请重试。');mailToast('已恢复原星标',{id:feedbackId,tone:'success'})}}}:op==='trash'&&done.length?{action:{get label(){return '恢复这 '+undoRemaining.size+' 封'},pending:'正在恢复邮件…',run:async()=>{if(generation!==MailWorkspace.identityGeneration)throw Error('账号已变化，请重新操作。');for(const id of [...undoRemaining]){const result=await act(id,'restore',{quiet:true});if(result!==false&&result?.ok!==false)undoRemaining.delete(id)}await loadList({fresh:true,transition:true});MailWorkspace.load(true).then(()=>loadSide()).catch(()=>{});if(undoRemaining.size)throw Error('还有 '+undoRemaining.size+' 封邮件未恢复，请重试。');mailToast('已恢复 '+done.length+' 封',{id:feedbackId,tone:'success'})}}}:{})});
  }catch(error){mailToast(error.message,{tone:'error'})}finally{busy=false;paintSelection()}
 };
 const sizes=new ResizeObserver(()=>paintSelection());sizes.observe(list);sizes.observe(toolbar);enhance();return binding;
}

export const MAIL_LIST_ACTIONS_CSS=`
.mail-action-row{touch-action:pan-y pinch-zoom;position:relative;overflow:hidden;isolation:isolate;background:var(--e-ui-surface)}
.mail-action-row>.mail{z-index:2;transform:translate3d(var(--mail-row-x,0px),0,0);transition:transform 240ms cubic-bezier(.16,1,.3,1),border-radius 180ms; background:var(--e-ui-surface)}
.mail-action-row[data-open]>.mail,.mail-action-row[data-dragging]>.mail{border-radius:0 16px 16px 0}
.mail-action-row[data-dragging]>.mail-row-tray,.mail-action-row[data-open]>.mail-row-tray{visibility:visible;transition-delay:0s}
.mail-action-row[data-dragging]>.mail{transition:none;will-change:transform}
#app #list .mail-action-row>.mail{background:var(--e-ui-surface)}
#app #list .mail-action-row>.mail.on{background:var(--e-ui-selected)}
.mail-row-menu{position:absolute;z-index:3;right:8px;top:8px;width:32px;height:32px;border:0;border-radius:10px;background:var(--e-ui-soft);color:var(--e-ui-muted);cursor:pointer;opacity:0;pointer-events:none;transition:opacity 120ms}
@media(hover:hover) and (pointer:fine){html[data-mail-pointer=mouse] .mail-action-row[data-row-hover]:not([data-menu-open])>.mail-row-menu,.mail-row-menu:focus-visible{opacity:1;pointer-events:auto}}
.mail-action-popover svg,.mail-row-menu svg,.mail-row-tray svg,.mail-selection-toolbar svg,.mail-action-sheet svg{width:18px;height:18px;flex:none}
.mail-action-row[data-open]>.mail-row-menu,.mail-action-row[data-dragging]>.mail-row-menu{visibility:hidden}
.mail-row-tray{visibility:hidden;transition:visibility 0s 240ms;position:absolute;z-index:1;inset:0 0 0 auto;width:min(var(--mail-tray-width,232px),62vw);display:flex;align-items:center;gap:8px;padding:12px;box-sizing:border-box;background:var(--e-ui-soft)}
#app .mail-row-tray>.e-button{display:flex;flex:1;height:76px;min-height:76px;flex-direction:column;gap:6px;justify-content:center;align-items:center;min-width:0;padding:4px 0;border:0;border-radius:12px;white-space:nowrap;font:500 12px/18px var(--e-ui-font);color:var(--e-ui-ink);background:transparent}
.mail-row-tray .mail-quick-icon{display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:14px;background:var(--e-ui-surface);transition:background 140ms,transform 180ms var(--e-ui-ease)}
#app .mail-row-tray>.e-button[data-danger]{color:var(--e-ui-danger)}
#app .mail-row-tray>.e-button[data-danger] .mail-quick-icon{background:color-mix(in srgb,var(--e-ui-danger) 10%,var(--e-ui-surface))}
#app .mail-row-tray>.e-button:active .mail-quick-icon{transform:scale(.94)}
.mail-row-check{position:absolute;left:9px;top:6px;z-index:4;width:44px;height:44px;border:0;background:transparent;color:var(--e-ui-accent);padding:10px;cursor:pointer;opacity:1;transform:scale(1);transition:opacity 140ms,transform 180ms var(--e-ui-ease),display 180ms allow-discrete;animation:mail-check-enter 180ms var(--e-ui-ease)}
body[data-mail-density=comfortable] .mail-row-check{top:11px}
.mail-row-check>span{display:flex;width:22px;height:22px;align-items:center;justify-content:center;border:1px solid var(--e-ui-muted);border-radius:50%}
.mail-row-check svg{width:16px;height:16px;visibility:hidden}
.mail-row-check[aria-checked=true]>span{background:var(--e-ui-accent);border-color:var(--e-ui-accent);color:white}.mail-row-check[aria-checked=true] svg{visibility:visible}
#app[data-mail-selecting] .mail-action-row>.mail>:is(.av,.mail-workspace-avatar){opacity:0;transform:scale(.8)}
#app #list .mail-action-row>.mail>:is(.av,.mail-workspace-avatar){transition:opacity 140ms,transform 180ms var(--e-ui-ease)}
#app[data-mail-selecting] #list .mail-action-row:not([data-selected])>.mail.on{background:var(--e-ui-surface)}
#app #list .mail-action-row[data-selected]>.mail{background:var(--e-ui-selected)}
#app[data-mail-selecting] #list{padding-bottom:var(--mail-selection-inset,100px)}
#app[data-mail-selecting] .mail-list-filter,#app[data-mail-selecting] .mail-row-menu{display:none!important}
#app #list :is([data-mail-select-toggle],.mail-list-filter){display:inline-flex;align-items:center;justify-content:center;width:64px;min-width:64px;flex:0 0 64px;margin-left:auto;padding:0;height:34px;min-height:34px;border:0;border-radius:10px;background:transparent;color:var(--e-ui-ink);font:500 12px/20px var(--e-ui-font);box-shadow:none}
#app:not([data-mail-selecting]) #list .mail-list-filter+[data-mail-select-toggle]{margin-left:0}
#app #list .mail-header-action-face{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;width:64px;min-width:64px;height:32px;padding:0 8px;font:500 12px/20px var(--e-ui-font);border:1px solid var(--e-ui-line);border-radius:10px;background:var(--e-ui-surface);color:inherit;pointer-events:none;transition:background-color 120ms,color 120ms,border-color 120ms,transform 100ms}
#app #list .mail-header-action-face svg{width:14px;height:14px;flex:none}
#app #list :is([data-mail-select-toggle],.mail-list-filter):is(:hover,:active,:focus){background:transparent;transform:none;box-shadow:none}
#app #list :is([data-mail-select-toggle][aria-pressed=true],.mail-list-filter[data-active=true],.mail-list-filter[aria-expanded=true])>.mail-header-action-face{background:var(--e-ui-selected);border-color:transparent;color:var(--e-ui-accent)}
#app #list :is([data-mail-select-toggle],.mail-list-filter):focus-visible{outline:none}
#app #list :is([data-mail-select-toggle],.mail-list-filter):focus-visible>.mail-header-action-face{outline:2px solid var(--e-ui-accent);outline-offset:2px}
#app #list :is([data-mail-select-toggle],.mail-list-filter):not(:disabled):active>.mail-header-action-face{transform:scale(.97)}
@media(hover:hover) and (pointer:fine){html[data-mail-pointer=mouse] #app #list :is([data-mail-select-toggle][aria-pressed=false],.mail-list-filter:not([data-active=true]):not([aria-expanded=true])):not(:disabled):hover>.mail-header-action-face{background:var(--e-ui-soft)}}
@media(prefers-reduced-motion:reduce){#app #list .mail-header-action-face{transition:none}}
.mail-selection-toolbar{position:absolute;z-index:15;bottom:16px;left:var(--mail-selection-left,252px);width:var(--mail-selection-width,400px);box-sizing:border-box;display:grid;grid-template-columns:repeat(var(--mail-bulk-columns,4),minmax(0,1fr));align-items:center;gap:4px;max-width:calc(100% - 32px);min-height:var(--mail-float-min,64px);padding:8px;font:13px/20px var(--e-ui-font)}
#app .mail-selection-toolbar>.e-button{display:flex;min-width:0;flex-direction:row;align-items:center;justify-content:center;gap:5px;height:44px;min-height:44px;padding:4px;border:0;border-radius:14px;background:var(--e-ui-soft);color:var(--e-ui-ink);font:500 13px/20px var(--e-ui-font);white-space:nowrap}
#app .mail-selection-toolbar>.e-button svg{flex:none;width:18px;height:18px}
.mail-selection-all-copy{display:flex;align-items:center}#app .mail-selection-toolbar>[data-list-action=all][aria-pressed=true]{background:var(--e-ui-selected);color:var(--e-ui-accent)}#app .mail-selection-toolbar>.e-button:not(:disabled):active{transform:scale(.97);filter:brightness(.94)}
#app .mail-selection-toolbar>.e-button[data-danger]{color:var(--e-ui-danger);background:color-mix(in srgb,var(--e-ui-danger) 8%,var(--e-ui-surface))}
#app .mail-selection-toolbar[data-compact=true]>.e-button{flex-direction:column;gap:2px;font-size:12px;line-height:16px}
@media(max-width:360px){#app .mail-selection-toolbar>.e-button{gap:3px;font-size:12px}#app .mail-selection-toolbar>.e-button svg{width:16px;height:16px}}
#app .mail-selection-toolbar>.e-button[data-list-action=done]{background:var(--e-ui-accent);color:var(--mail-on-primary,#fff);font-size:13px;font-weight:600;margin-left:4px}
#app .mail-selection-toolbar>.e-button:disabled{opacity:.4;cursor:default}
@media(hover:hover) and (pointer:fine){html[data-mail-pointer=mouse] #app .mail-selection-toolbar>.e-button:not(:disabled):not(:active):hover{filter:brightness(.97)}html[data-mail-pointer=mouse] #app .mail-selection-toolbar>.e-button[data-list-action=done]:hover{filter:brightness(.96)}}
#app[data-mail-selecting] .mail-workspace-title>span,#app[data-mail-selecting] .mail-results-bar>:not(.mail-selection-title):not([data-mail-select-toggle]){display:none}.mail-selection-title{font:600 13px/20px var(--e-ui-font)}
body[data-mail-selecting] .e-toast-region{bottom:var(--mail-selection-toast-bottom,calc(88px + env(safe-area-inset-bottom)))}

.mail-selection-toolbar>[hidden],.mail-selection-toolbar[hidden],.mail-row-check[hidden],[data-mail-select-toggle][hidden]{display:none!important}.mail-row-check[hidden]{opacity:0;transform:scale(.75);pointer-events:none}
body.mail-atlas dialog.mail-action-sheet.e-modal{box-sizing:border-box;width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 40px);padding:0;overflow:hidden;border:1px solid var(--e-ui-line);color:var(--e-ui-ink);background:var(--e-ui-surface);border-radius:var(--mail-float-radius,24px)}
body.mail-atlas dialog.mail-action-sheet.e-modal[open]{display:flex;flex-direction:column}
.mail-action-sheet>header{flex:none;display:flex;align-items:flex-start;gap:16px;padding:20px;border-bottom:1px solid var(--e-ui-line)}
.mail-action-sheet>header>div{min-width:0;flex:1}body.mail-atlas dialog.mail-action-sheet h2{margin:0;font:600 16px/24px var(--e-ui-font);overflow-wrap:anywhere;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.mail-action-sheet header p{margin:4px 0 0;font:13px/20px var(--e-ui-font);color:var(--e-ui-muted);overflow-wrap:anywhere}
body.mail-atlas dialog.mail-action-sheet .mail-sheet-close{min-width:44px;height:44px;padding:10px;border:0;border-radius:50%;background:var(--e-ui-soft);margin:-8px -8px 0 0}
.mail-sheet-actions{min-height:0;flex:1;display:flex;flex-direction:column;gap:6px;padding:8px;max-height:calc(100dvh - 200px);overflow-y:auto;overscroll-behavior:contain}
body.mail-atlas dialog.mail-action-sheet .mail-sheet-actions>.e-button{display:flex;justify-content:flex-start;gap:12px;min-height:48px;width:100%;padding:10px 12px;border:0;border-radius:12px;background:var(--e-ui-soft);font-size:14px;text-align:left}
body.mail-atlas dialog.mail-action-sheet .mail-sheet-actions>.e-button:hover{background:var(--e-ui-soft)}body.mail-atlas dialog.mail-action-sheet .mail-sheet-actions>.e-button[data-danger]{color:var(--e-ui-danger);margin-top:4px;background:color-mix(in srgb,var(--e-ui-danger) 9%,var(--e-ui-surface));border:0;border-radius:12px}
.mail-sheet-error{padding:0 20px 16px;color:var(--e-ui-danger);font-size:13px}
@media(max-width:860px){
 #app #list :is([data-mail-select-toggle],.mail-list-filter){height:44px;min-height:44px}
 .mail-row-menu{display:none}
 body.mail-atlas dialog.mail-action-sheet.e-modal{position:fixed;inset:auto 0 calc(var(--mail-float-gap,16px) + env(safe-area-inset-bottom));margin:0 auto;width:calc(100% - 2 * var(--mail-float-gap,16px));max-width:480px;max-height:calc(100dvh - 2 * var(--mail-float-gap,16px) - env(safe-area-inset-bottom));border-radius:var(--mail-float-radius,24px);padding-bottom:8px;animation:mail-sheet-enter 280ms var(--e-ui-ease)}
 body.mail-atlas dialog.mail-action-sheet.e-modal[data-e-closing=true]{animation:mail-sheet-exit 160ms ease-in forwards}
 .mail-action-sheet>header{padding:20px 20px 14px}body.mail-atlas dialog.mail-action-sheet .mail-sheet-actions>.e-button{min-height:48px}
 .mail-selection-toolbar{left:var(--mail-float-gap,16px);right:var(--mail-float-gap,16px);width:auto;bottom:calc(var(--mail-float-gap,16px) + env(safe-area-inset-bottom));max-width:var(--mail-float-width,480px);margin-inline:auto;gap:6px;padding:8px}
}
@keyframes mail-sheet-enter{from{opacity:.7;transform:translateY(48px)}to{opacity:1;transform:translateY(0)}}
@keyframes mail-check-enter{from{opacity:0;transform:scale(.7)}to{opacity:1;transform:scale(1)}}
@keyframes mail-sheet-exit{to{opacity:0;transform:translateY(32px)}}
@media(prefers-reduced-motion:reduce){.mail-row-tray,.mail-quick-icon,.mail-row-check,.mail-action-row>.mail,.mail-action-row>.mail>:is(.av,.mail-workspace-avatar),.mail-action-sheet,body.mail-atlas dialog.mail-action-sheet.e-modal[data-e-closing=true]{animation:none;transition:none}}
`;

export const MAIL_ACTION_POPOVER_CSS=`
body.mail-atlas .mail-action-popover{width:224px;padding:6px;max-height:min(520px,calc(100dvh - 24px));overflow:auto;border-radius:14px}
body.mail-atlas .mail-action-popover .mail-sheet-actions{padding:0;gap:2px;max-height:none;overflow:visible}
body.mail-atlas .mail-action-popover .e-button{display:flex;align-items:center;justify-content:flex-start;gap:10px;width:100%;height:36px;min-height:36px;padding:6px 10px;border:0;border-radius:8px;background:transparent;font:500 13px/20px var(--e-ui-font);color:var(--e-ui-ink);text-align:left}
body.mail-atlas .mail-action-popover .e-button[data-danger]{color:var(--e-ui-danger)}
body.mail-atlas .mail-action-popover .e-button:hover{background:var(--e-ui-soft)}
#app #list :is(.mail-workspace-title,.mail-results-bar){position:sticky;top:0;z-index:6}
`;
