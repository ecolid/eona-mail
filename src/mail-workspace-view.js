export function mailSyncNotice(sync,error){if(error)return '同步状态更新失败，已保留当前内容。';if(!sync?.configured)return '';return sync.source_error||sync.accounts?.some(a=>a.state!=='ok')?'原邮箱同步暂未完成，本站内容已保留。':sync.accounts?.length?'':'正在连接原邮箱同步…'}
export function mailWorkspaceBrowserScript(){return mailSyncNotice.toString()+';('+mailWorkspaceController.toString()+')();';}
function mailWorkspaceController(){
 let owner='',ownerEpoch=0,data={drafts:[],contacts:[],directory:[],sources:[],folders:[],senders:[],sent:[],outbox:[]},loaded=false,loadedAt=0,loading=null,lastError=null;
 const emit=()=>window.dispatchEvent(new Event('mail:workspace'));
 const backupKey=()=> 'eona-mail-unsaved-v2:'+owner;
 let backups={};
 const stash=draft=>{backups[draft.id]={...draft};try{sessionStorage.setItem(backupKey(),JSON.stringify(backups))}catch{}};
 const unstash=id=>{delete backups[id];try{sessionStorage.setItem(backupKey(),JSON.stringify(backups))}catch{}};
 const importantContacts=new Map();
 const patchImportant=(address,value)=>{
  const contact=data.directory.find(c=>c.address===address)||importantContacts.get(address)||{address,name:''};data.contacts=data.contacts.filter(c=>c.address!==address);if(value)data.contacts.push({...contact,important:true});contact.important=value;
  for(const node of document.querySelectorAll('[data-directory-important]'))if(node.dataset.directoryImportant===address){node.setAttribute('aria-pressed',String(value));node.setAttribute('aria-label',value?'取消重要联系人':'设为重要联系人');node.title=value?'取消重要联系人':'设为重要联系人';node.innerHTML=value?I.starOn:I.star;}
  emit();
 };
 const importantWrites=createMailToggleQueue(async(address,value)=>{const epoch=ownerEpoch,result=await request('/contacts',value?'PUT':'DELETE',data.directory.find(c=>c.address===address)||importantContacts.get(address)||{address,name:''});if(epoch===ownerEpoch&&value&&!data.directory.some(c=>c.address===address))data.directory.push({...result.contact,important:true})},{apply:patchImportant,failed:(error,address,change)=>{if(!change?.quiet)mailToast(error.message,{id:'mail-important:'+address,tone:'error'})},settled:(address,value,change)=>{if(value===change.previous||change.quiet)return;const epoch=ownerEpoch;mailToast(value?'已设为重要联系人':'已取消重要联系人',{id:'mail-important:'+address,tone:'success',...(change.undoable?{action:{label:value?'取消重要联系人':'恢复重要联系人',run:()=>{if(epoch!==ownerEpoch)throw Error('账号已变化，请重新操作。');return MailWorkspace.important(importantContacts.get(address)||{address,name:''},!value,{undoable:false})}}}:{})})}});
 const patchSource=(key,included)=>{const source=data.sources.find(s=>s.key===key);if(source)source.included=included;for(const node of document.querySelectorAll('[data-source-toggle]'))if(node.dataset.sourceToggle===key){node.dataset.included=String(included);node.textContent=included?'移出订阅列表':'加入订阅列表'}emit()};
 const sourceWrites=createMailToggleQueue(async(key,included,change)=>{const epoch=ownerEpoch;await request('/source-preferences','PUT',{key,included});if(epoch===ownerEpoch&&!change?.quiet)try{await MailWorkspace.load(true)}catch{}},{apply:patchSource,failed:(error,key,change)=>{if(!change?.quiet)mailToast(error.message,{id:'mail-source:'+key,tone:'error'})},settled:(key,included,change)=>{if(included===change.previous)return;const epoch=ownerEpoch;mailToast(included?'已加入订阅列表':'已移出订阅列表',{id:'mail-source:'+key,tone:'success',...(change.undoable?{action:{label:included?'移出订阅列表':'恢复订阅',run:()=>{if(epoch!==ownerEpoch)throw Error('账号已变化，请重新操作。');return MailWorkspace.sourcePreference(key,!included,{undoable:false})}}}:{})})}});
 const replace=draft=>{data.drafts=[draft,...data.drafts.filter(d=>d.id!==draft.id)];emit()};
 const same=(a,b)=>a&&b&&a.to===b.to&&a.subject===b.subject&&a.body===b.body&&(a.from_id||'')===(b.from_id||'')&&(a.cc||'')===(b.cc||'')&&(a.bcc||'')===(b.bcc||'')&&JSON.stringify(a.document||null)===JSON.stringify(b.document||null)&&JSON.stringify(a.attachments||[])===JSON.stringify(b.attachments||[]);
 const accept=(saved,submitted)=>{lastError=null;const newer=backups[saved.id];if(newer&&!same(newer,submitted)){stash({...newer,rev:saved.rev,conflict:false});replace({...newer,rev:saved.rev,conflict:false,unsaved:true})}else{unstash(saved.id);replace(saved)}return saved};
 const request=(path,method,value)=>api('/api/mail-workspace'+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(value)});
 window.MailWorkspace={
  setOwner(value){const next=value||'password-owner';if(owner&&owner!==next){ownerEpoch++;importantWrites.clear();sourceWrites.clear();importantContacts.clear();mailStars.clear();mailReadWrites.clear();data={drafts:[],contacts:[],directory:[],sources:[],folders:[],senders:[],sent:[],outbox:[]};loaded=false;loading=null;lastError=null;mailResources.clear();mailPages.clear()}owner=next;try{backups=JSON.parse(sessionStorage.getItem(backupKey())||'{}');if(location.hostname==='127.0.0.1'&&!sessionStorage.getItem('eona-preview-drafts-migrated')){for(const d of JSON.parse(sessionStorage.getItem('eona-mail-compose-drafts-v1')||'[]'))stash({...d,rev:0,unsaved:true});sessionStorage.setItem('eona-preview-drafts-migrated','true')}}catch{backups={}}},
  get data(){return data},get loaded(){return loaded},get error(){return lastError},get identityGeneration(){return ownerEpoch},
  // Compact workspace refreshes contain only sent IDs; list actions need the
  // authoritative row projection already returned by the sent-list query.
  row(kind,id){return kind==='sent'?sentRows.find(m=>m.id===id)||(sentAnchor?.id===id?sentAnchor:null)||data.sent.find(m=>m.id===id):kind==='draft'?data.drafts.find(m=>m.id===id):null},
  async load(force=false){
   if(loaded&&!force){if(Date.now()-loadedAt>=30000&&!loading)this.load(true).catch(()=>{});return data}if(loading)return loading;const epoch=ownerEpoch;
   loading=(async()=>{try{
    const value=await api('/api/mail-workspace?view=compact',{fresh:force});if(epoch!==ownerEpoch)return data;if(!Array.isArray(value.drafts)||!Array.isArray(value.contacts)||!Array.isArray(value.folders))throw Error('邮箱资料无法读取。');
    const previous=JSON.stringify(data),wasFailed=!!lastError;if(loaded&&JSON.stringify([data.folders,data.sent_total])!==JSON.stringify([value.folders,value.sent_total])){mailResources.invalidate('/api/mail-workspace/correspondence');const visible=document.querySelector('.mail-correspondence');if(visible?.dataset.path&&!state.workspaceMail)api(visible.dataset.path).catch(()=>{})}data={directory:[],sources:[],senders:[],sent:[],outbox:[],...value};loaded=true;loadedAt=Date.now();lastError=null;for(const contact of data.directory){const pending=importantWrites.pending(contact.address);if(pending!==undefined){contact.important=pending;data.contacts=data.contacts.filter(c=>c.address!==contact.address);if(pending)data.contacts.push({...contact})}}
    for(const source of data.sources){const pending=sourceWrites.pending(source.key);if(pending!==undefined)source.included=pending}
    for(const local of Object.values(backups)){if(data.sent.some(m=>m.draft_id===local.id&&m.draft_rev>=local.rev)){unstash(local.id);continue}const saved=data.drafts.find(d=>d.id===local.id);if(saved&&same(saved,local))unstash(local.id);else replace({...local,rev:saved?.rev||0,conflict:!!saved&&saved.rev!==local.rev,unsaved:true})}
    if(wasFailed||previous!==JSON.stringify(data))emit();return data;
   }catch(error){if(error.name==='MailReadSuperseded')return data;if(epoch===ownerEpoch){lastError=error;emit()}throw error}finally{if(epoch===ownerEpoch)loading=null}})();return loading;
  },
  isImportant(address){return data.contacts.some(c=>c.address===String(address).toLowerCase())},
  important(contact,value,options){importantContacts.set(contact.address.toLowerCase(),contact);return importantWrites.set(contact.address.toLowerCase(),value,this.isImportant(contact.address),options)},
  sourcePreference(key,included,options){return sourceWrites.set(key,included,!!data.sources.find(s=>s.key===key)?.included,options)},
  local(draft){stash(draft);replace(draft)},
  async save(draft){
   stash(draft);
   if(draft.conflict)throw Error('此草稿在其他页面有更新，请另存为新草稿。');
   try{const value=await request('/drafts/'+encodeURIComponent(draft.id),'PUT',draft);return accept(value.draft,draft)}
   catch(error){
    // Recover an unknown write result by reading its stable ID, never by replaying it.
    try{const latest=await api('/api/mail-workspace',{fresh:true}),saved=latest.drafts?.find(d=>d.id===draft.id);if(same(saved,draft))return accept(saved,draft);if(saved&&saved.rev!==draft.rev){draft.conflict=true;stash({...backups[draft.id],conflict:true});replace(backups[draft.id])}}catch{}
    lastError=error;throw error;
   }
  },
  applySettings(result){if(Array.isArray(result.senders))data.senders=result.senders;emit()},
  async senderPreferences(value){const result=await request('/sender-preferences','PUT',value);data.senders=result.senders;emit();return result.senders},
  async upload(draft,file){return (await request('/assets','POST',{draft_id:draft.id,...file})).asset},
  async removeAsset(draft,id){return request('/assets/'+encodeURIComponent(id),'DELETE',{draft_id:draft.id,rev:draft.rev})},
  async remove(draft){await request('/drafts/'+encodeURIComponent(draft.id),'DELETE',{rev:draft.rev||0});unstash(draft.id);data.drafts=data.drafts.filter(d=>d.id!==draft.id);emit()},
  async send(draft,id){
   let result;
   try{result=await request('/send','POST',{draft_id:draft.id,rev:draft.rev,attempt_id:id})}
   catch(error){if(error.data?.message)result=error.data;else if([400,403,409,413,415,503].includes(error.status)){error.definitelyNotSubmitted=true;throw error}else try{result=await api('/api/mail-workspace/send/'+encodeURIComponent(id))}catch{throw Error('发送结果尚未确认，请核对发送记录，勿重复发送。')}}
   if(result.message.state==='sending')window.dispatchEvent(new Event('mail:send-checking'));
   for(const delay of [600,1200,2400,4800,4800]){if(result.message.state!=='sending')break;await new Promise(resolve=>setTimeout(resolve,delay));try{result=await api('/api/mail-workspace/send/'+encodeURIComponent(result.message.id||id))}catch{break}}
   if(['sent','partial'].includes(result.message.state)){unstash(draft.id);data.drafts=data.drafts.filter(d=>d.id!==draft.id)}
   await this.load(true);return result.message;
  },
  async sendStatus(id){return (await api('/api/mail-workspace/send/'+encodeURIComponent(id))).message},
  async restore(id){unstash(id);return this.load(true)},
  async editing(id,editor_id,active){return request('/drafts/'+encodeURIComponent(id)+'/editing','PUT',{editor_id,active})},
 };
 const sentReaderHeader=(message,pending=false)=>{
  const person=(part,field)=>{const html=mailContactTrigger(part,field,esc,I);return pending?html.replace('<button ','<button disabled '):html},recipients=parts=>(parts||[]).map(p=>person(p,'to')).join('');
  const back='<button id="back" class="btn" data-sent-back aria-label="'+(state.workspaceMail?'返回联系人':'返回已发送')+'">'+I.back+'返回</button>',actions=message.raw_url?(pending?'<button class="btn" disabled>'+I.down+'原始邮件</button>':'<a class="btn" href="'+esc(message.raw_url)+'">'+I.down+'原始邮件</a>'):'';
  const envelope='<div><dt>发件人</dt><dd>'+person(message.from,'from')+'</dd></div><div><dt>收件人</dt><dd>'+recipients(message.to)+'</dd></div>'+(message.cc?.length?'<div><dt>抄送</dt><dd>'+recipients(message.cc)+'</dd></div>':'')+(message.bcc?.length?'<div><dt>密送</dt><dd>'+recipients(message.bcc)+'</dd></div>':'');
  return mailMessageHeader({subject:message.subject,at:message.created_at,back,actions,envelope},esc,localTime);
 };
 let sentDispose=null;
 let pendingWorkspaceRender=false,contactsDispose=null,renderIntent=0,sentRows=[],sentNext=null,sentTotal=0,sentQuery='',sentAnchor=null;
 window.renderMailWorkspace=async(append=false)=>{
  window.MailNavigation?.visit();
  const ticket=++renderIntent;
  const folder=state.folder,list=document.getElementById('list'),entry=activeMailPage;
  list.setAttribute('aria-busy','true');
  try{await MailWorkspace.load()}catch(error){if(ticket!==renderIntent||state.folder!==folder)return;list.setAttribute('aria-busy','false');showMailListFailure(error.message,mailListHeading({sent:'已发送',drafts:'草稿箱',contacts:'通讯录',important:'重要联系人',subscriptions:'订阅来源'}[folder],null));return}
  if(ticket!==renderIntent||state.folder!==folder)return;
  const isDraft=folder==='drafts',isSent=folder==='sent',isSource=folder==='subscriptions',query=state.q||'';
  if(isSent){try{const params=new URLSearchParams({view:'compact',q:query,offset:String(append&&sentQuery===query?sentRows.length:0)});const selectedID=state.sentSelected;if(selectedID)params.set('selected_id',selectedID);const page=await api('/api/mail-workspace/sent?'+params);if(ticket!==renderIntent||state.folder!==folder)return;if(selectedID&&state.sentSelected===selectedID&&page.selected_matches===false){clearMailReader();state.sentSelected=null}sentRows=append&&sentQuery===query?[...sentRows,...page.messages]:page.messages;sentQuery=query;sentNext=page.next;sentTotal=page.total;sentAnchor=page.selected_message&&!sentRows.some(m=>m.id===page.selected_message.id)?{...page.selected_message,anchor:true}:null;data.sent=[...new Map([...data.sent,...sentRows,...(sentAnchor?[sentAnchor]:[])].map(m=>[m.id,m])).values()]}catch(error){if(ticket!==renderIntent||state.folder!==folder)return;list.setAttribute('aria-busy','false');showMailListFailure(error.message,mailListHeading('已发送',null));return}}
  const all=isDraft?data.drafts:isSent?(sentAnchor?[sentAnchor,...sentRows]:sentRows):isSource?data.sources.filter(s=>s.included):folder==='important'?data.directory.filter(c=>c.important):data.directory;
  let rows=isSent?all:all.filter(row=>!query||EonaUI.searchRank(query,isDraft?{title:row.subject,to:row.to,body:row.body}:isSent?{title:row.subject,to:row.to.map(p=>p.address).join(' '),body:row.body}:{name:row.name,address:row.address||row.addresses?.join(' '),source:row.list_id||''}));
  const title=isDraft?'草稿箱':isSent?'已发送':isSource?'订阅来源':folder==='important'?'重要联系人':'通讯录';
  const groups={correspondence:'有往来',subscription:'订阅来源',automatic:'自动通知',other:'其他联系人'};
  const groupFilter='';
  if(!isSent)rows=mailDirectoryFilter(rows,state.directoryFilters?.[folder]);
  let rowMarkup;
  if(isDraft||isSent)rowMarkup=rows.map(d=>{
   const recipient=isSent?d.to.map(p=>p.name||p.address).join('、'):d.to||'尚未填写收件人';
   const row={id:d.id,from_name:recipient,from_addr:recipient,subject:d.subject,text_preview:d.sync?.conflict_of?'保留的冲突版本 · '+d.body:d.body,received_at:d.updated_at.replace('T',' ').slice(0,19),is_read:true,has_attachments:!!d.attachments?.length};
   return (d.anchor?'<div class="mail-anchor-label">当前邮件</div>':'')+mailRow(row).replace('data-mail-id=',(isDraft?'data-draft-open=':'data-sent-open=')).replace('class="mail', 'class="mail'+((isSent&&state.sentSelected===d.id||isDraft&&state.workspaceSelected?.id===d.id&&state.workspaceSelected?.kind===folder)?' on':''));
  }).join('');
  else rowMarkup=rows.slice(0,entry.directoryLimit||80).map(c=>'<button type="button" class="mail mail-directory-row'+(state.workspaceSelected?.id===(c.key||c.address)&&state.workspaceSelected?.kind===folder?' on':'')+'" data-directory-open="'+esc(c.key||c.address)+'" title="查看'+esc(c.name||c.address)+'"><span class="mail-workspace-avatar">'+(isSource?I.mail:I.person)+'</span><span class="mail-directory-copy"><span class="mail-directory-line"><strong>'+esc(c.name||c.address)+'</strong>'+(c.important?'<span class="mail-contact-mark" aria-label="重要联系人">'+I.starOn+'</span>':'')+(!state.directoryFilters?.[folder]?.group||isSource?'<small class="mail-directory-label">'+esc(isSource?c.received_count+' 封':groups[c.group]||'其他联系人')+'</small>':'')+'</span><span class="mail-directory-address">'+esc(isSource?c.addresses.join('、'):c.address)+'</span></span></button>').join('');
  const refreshError=lastError?'<div class="mail-list-error" role="alert">更新失败，已保留当前内容。</div>':'';
  const pending=isSent?data.outbox.filter(m=>['sending','unknown'].includes(m.state)).map(m=>'<div class="mail-send-notice" role="status"><strong>'+esc(m.subject)+'</strong><span>发送结果待确认</span><button class="e-button" data-send-check="'+esc(m.id)+'">核对状态</button></div>').join(''):'';
  const syncText=mailSyncNotice(data.sync,lastError),syncNotice=(isDraft||isSent)&&data.sync?.configured?'<p class="mail-list-status" role="status" data-mail-sync-status'+(!syncText?' hidden':'')+'>'+syncText+'</p>':'';
  const coverage=!isDraft&&!isSent&&data.source_coverage&&data.source_coverage.indexed_count<data.source_coverage.total?'<p role="status">来源识别尚未完成，已保留当前联系人。</p>':'';
  const markup='<section class="mail-workspace-content">'+mailListHeading(title,isSent?sentTotal:rows.length,isDraft||isSent?'封':isSource?'个':'位',groupFilter)+refreshError+coverage+syncNotice+pending+(rowMarkup||'<div class="empty">'+(query?'未找到匹配项':isDraft?'还没有草稿':isSent?'尚无发送记录':'暂无联系人')+'</div>')+(isSent&&sentNext!==null?'<button class="e-button mail-sent-more" data-sent-more>加载更多</button>':'')+(!isDraft&&!isSent&&rows.length>(entry.directoryLimit||80)?'<button class="e-button mail-sent-more" data-directory-list-more>加载更多</button>':'')+'</section>';
  if(entry.markup!==markup){contactsDispose?.();contactsDispose=null;const scroll=list.scrollTop;list.innerHTML=markup;EonaUI.bindForms?.(list);list.scrollTop=scroll;entry.markup=markup}
  if(isSent&&state.sentSelected&&rows.some(m=>m.id===state.sentSelected))openMailSent(state.sentSelected);
  const selected=state.workspaceSelected;if(!isSent&&selected?.kind===folder&&!rows.some(r=>(r.id||r.key||r.address)===selected.id)&&!(folder==='important'&&data.directory.some(c=>c.address===selected.id))){clearMailReader()}
  list.setAttribute('aria-busy','false');return {ok:true,ids:rows.map(r=>r.id||r.address),count:rows.length};
 };
 window.openMailSent=async(id,push=true)=>{
  if(state.folder!=='sent'&&!state.workspaceMail)return;pushMailReaderHistory(id,'sent',push);state.sentSelected=id;const view=document.getElementById('view');if(view.dataset.sentID===id){document.body.classList.add('viewing');syncMailReader();return}const ticket=++mailReaderIntent;mailBodyDispose?.();mailBodyDispose=null;sentDispose?.();sentDispose=null;view.dataset.sentID=id;const preview=api.peek('/api/mail-workspace/sent/'+encodeURIComponent(id))?.message||data.sent.find(m=>m.id===id);view.innerHTML=mailLoadingMarkup('reader','已发送邮件',preview?.from?sentReaderHeader(preview,true):'');document.body.classList.add('viewing');syncMailReader();
  let message;try{({message}=await api('/api/mail-workspace/sent/'+encodeURIComponent(id)))}catch(error){if(ticket===mailReaderIntent)view.innerHTML='<div class="empty" role="alert">'+esc(error.message)+' <button class="e-button" data-sent-retry="'+esc(id)+'">重试</button></div>';view.dataset.sentID='';return}if(ticket!==mailReaderIntent||state.folder!=='sent'&&!state.workspaceMail)return;
  const list=view;for(const row of document.querySelectorAll('[data-sent-open]'))row.classList.toggle('on',row.dataset.sentOpen===id);
  list.innerHTML='<article class="mail-sent-reading mail-reader-content">'+sentReaderHeader(message)+(message.state==='partial'?'<p role="status">'+esc(message.error)+' 未接收：'+esc(message.rejected.join('、'))+'</p>':'')+'<div class="mail-sent-body">'+esc(message.body)+'</div></article>';
  const body=list.querySelector('.mail-sent-body');
  if(message.view_html){body.textContent='';body.classList.add('mail-sent-rich');const holder=document.createElement('div');holder.className='htmlbody';const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('title','已发送邮件正文');holder.append(frame);body.append(holder);sentDispose=installMailBodyFrame(frame);frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'; font-src \'none\'"><style>body{margin:0;font:15px/1.65 Arial,sans-serif}img{max-width:100%;height:auto}</style></head><body>'+message.view_html+'</body></html>'}
  if(message.attachments?.length){const files=document.createElement('div');files.className='mail-editor-files';files.innerHTML=message.attachments.map(a=>'<div class="mail-editor-file"><a href="'+esc(a.url)+'" target="_blank" rel="noopener">'+I.clip+'<span>'+esc(a.name)+'</span><small>'+Math.max(1,Math.round(a.size/1024))+' KB</small></a></div>').join('');body.after(files)}
  const disposeBody=sentDispose,disposeContacts=installMailContactActions(list,mailContactOptions());mailBodyDispose=chainMailReaderDisposers(disposeBody,disposeContacts,()=>{if(view.contains(body))view.dataset.sentID=''});
 };
 const paintCorrespondence=(host,page,id,kind,append=false)=>{
  correspondenceRows=append&&correspondenceIdentity===kind+':'+id?[...correspondenceRows,...page.messages]:page.messages;correspondenceIdentity=kind+':'+id;correspondenceNext=page.next;
  for(const message of page.messages)if(message.reader_preview){if(message.kind==='received'){activeMailPage.readerPreviews||=new Map();activeMailPage.readerPreviews.set(String(message.id),message.reader_preview)}else data.sent=[...data.sent.filter(m=>m.id!==message.id),message.reader_preview];}
  const markup='<header class="mail-correspondence-heading"><h2>往来邮件</h2><span>'+page.total+' 封</span></header>'+correspondenceRows.map(m=>'<button type="button" class="mail-directory-message" data-directory-message="'+esc(String(m.id))+'" data-message-kind="'+m.kind+'"><span><strong>'+esc(m.subject||'(无主题)')+'</strong><small>'+esc(m.kind==='sent'?'我发出的邮件':m.name||m.address)+'</small><span>'+esc(String(m.body||'').replace(/\s+/g,' '))+'</span></span><time>'+esc(localTime(m.at))+'</time></button>').join('')+(page.total?'':'<p class="empty">暂无往来邮件</p>')+(page.next!==null?'<button class="e-button mail-sent-more" data-directory-more>加载更多</button>':'');
  if(host.innerHTML!==markup)host.innerHTML=markup;host.setAttribute('aria-busy','false');
 };
 window.addEventListener('mail:resource',event=>{const selected=state.workspaceSelected,host=document.querySelector('.mail-correspondence');if(selected&&host?.dataset.path===event.detail.path&&!state.workspaceMail){const page=api.peek(event.detail.path);if(page)paintCorrespondence(host,page,selected.id,selected.kind)}});
 window.addEventListener('mail:resource-error',event=>{const host=document.querySelector('.mail-correspondence');if(host?.dataset.path===event.detail.path&&!host.querySelector('.mail-correspondence-error'))host.insertAdjacentHTML('beforeend','<p class="mail-correspondence-error" role="alert">更新失败，已保留往来邮件。 <button class="e-button" data-directory-retry="'+esc(state.workspaceSelected?.id||'')+'">重试</button></p>')});
 let correspondenceRows=[],correspondenceNext=null,correspondenceIdentity='';
 const workspaceBody=(message,body)=>{
  if(message.view_html){body.textContent='';body.classList.add('mail-sent-rich');const holder=document.createElement('div');holder.className='htmlbody';const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');frame.title='草稿正文';holder.append(frame);body.append(holder);const dispose=installMailBodyFrame(frame);frame.srcdoc='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src \'self\' data:; style-src \'unsafe-inline\'"><style>body{margin:0;font:15px/1.65 Arial,sans-serif}img{max-width:100%;height:auto}</style>'+message.view_html;mailBodyDispose=dispose}
  if(message.attachments?.length){const files=document.createElement('div');files.className='mail-editor-files';files.innerHTML=message.attachments.map(a=>'<div class="mail-editor-file"><a href="/api/mail-workspace/assets/'+encodeURIComponent(a.id)+'" target="_blank" rel="noopener">'+I.clip+'<span>'+esc(a.name)+'</span></a></div>').join('');body.after(files)}
 };
 window.openMailWorkspaceDetail=async(id,kind=state.folder,push=true,append=false,fresh=false)=>{
  if(state.folder!==kind||document.body.classList.contains('mail-composing'))return;
  const selected=kind==='drafts'?data.drafts.find(d=>d.id===id):kind==='subscriptions'?data.sources.find(s=>s.key===id):data.directory.find(c=>c.address===id);
  if(!selected)return;state.workspaceSelected={id,kind};state.workspaceMail=false;document.body.classList.remove('mail-workspace-nested');pushMailReaderHistory(id,kind,push);
  const ticket=++mailReaderIntent,view=document.getElementById('view');if(!append){mailBodyDispose?.();mailBodyDispose=null}state.cur=null;state.curMail=null;view.dataset.sentID='';document.body.classList.add('viewing');syncMailReader();
  for(const row of document.querySelectorAll('[data-directory-open],[data-draft-open]'))row.classList.toggle('on',(row.dataset.directoryOpen||row.dataset.draftOpen)===id);
  const back='<button class="e-button mail-sent-back mail-directory-back" data-workspace-return aria-label="返回列表" title="返回列表">'+I.back+'</button>';
  if(kind==='drafts'){
   const from=data.senders.find(s=>s.id===selected.from_id),address=value=>mailAddressParts(value).map(c=>mailContactTrigger(c,'to',esc,I)).join('');
   const envelope=(from?'<div><dt>发件人</dt><dd>'+mailContactTrigger(from,'from',esc,I)+'</dd></div>':'')+'<div><dt>收件人</dt><dd>'+(address(selected.to)||'尚未填写')+'</dd></div>'+(selected.cc?'<div><dt>抄送</dt><dd>'+address(selected.cc)+'</dd></div>':'')+(selected.bcc?'<div><dt>密送</dt><dd>'+address(selected.bcc)+'</dd></div>':'');
   view.innerHTML='<article class="mail-sent-reading mail-reader-content">'+mailMessageHeader({subject:selected.subject,at:selected.updated_at,back:'<button id="back" class="btn" data-workspace-return>'+I.back+'返回</button>',actions:'<button class="btn" data-workspace-edit="'+esc(id)+'">'+I.edit+'继续编辑</button>',envelope},esc,localTime)+'<div class="mail-sent-body">'+esc(selected.body)+'</div></article>';
   workspaceBody(selected,view.querySelector('.mail-sent-body'));const dispose=mailBodyDispose,contacts=installMailContactActions(view,mailContactOptions());mailBodyDispose=chainMailReaderDisposers(dispose,contacts);return;
  }
  const isSource=kind==='subscriptions',sourceKey=isSource?id:'sender:'+id,source=data.sources.find(s=>s.key===sourceKey),included=!!source?.included;
  const addresses=isSource?selected.addresses:[selected.address];
  const related=!isSource?(selected.source_keys||[]).map(k=>data.sources.find(s=>s.key===k)).filter(s=>s&&s.name!==selected.name&&s.name!==selected.address):[];
  const previousScroll=view.scrollTop;if(!append)view.innerHTML='<article class="mail-directory-reading mail-reader-content"><header class="mail-directory-header"><div class="mail-directory-heading">'+back+'<span class="mail-directory-avatar" aria-hidden="true">'+(isSource?I.mail:I.person)+'</span><h1>'+esc(selected.name||selected.address)+'</h1>'+(isSource?'':'<button class="btn mail-important-toggle" data-directory-important="'+esc(id)+'" aria-pressed="'+!!selected.important+'" aria-label="'+(selected.important?'取消重要联系人':'设为重要联系人')+'" title="'+(selected.important?'取消重要联系人':'设为重要联系人')+'">'+(selected.important?I.starOn:I.star)+'</button>')+'</div><div class="mail-directory-identities">'+addresses.map(address=>mailContactTrigger({address,name:''},'from',esc,I)).join('')+'</div><div class="mail-directory-actions">'+(!isSource?'<button class="e-button" data-contact-write="'+esc(id)+'">'+I.edit+'写邮件</button>':'')+'<button class="e-button mail-source-action" data-source-toggle="'+esc(sourceKey)+'" data-included="'+included+'">'+(included?'移出订阅列表':'加入订阅列表')+'</button></div>'+(selected.list_id||related.length?'<details class="mail-directory-metadata"><summary>来源信息</summary>'+(selected.list_id?'<dl class="mail-envelope"><div><dt>列表标识</dt><dd>'+esc(selected.list_id)+'</dd></div></dl>':'')+related.map(s=>'<button type="button" class="mail-source-link" data-source-open="'+esc(s.key)+'">'+esc(s.name)+I.caret+'</button>').join('')+'</details>':'')+'</header><section class="mail-correspondence" aria-label="往来邮件"></section></article>';
  if(!append){const contacts=installMailContactActions(view,mailContactOptions());mailBodyDispose=contacts;view.scrollTop=0}
  const host=view.querySelector('.mail-correspondence'),params=new URLSearchParams(isSource?{key:id}:{address:id});
  if(append)view.querySelector('[data-directory-more]')?.setAttribute('disabled','');
  if(append&&correspondenceIdentity===kind+':'+id)params.set('offset',String(correspondenceNext));
  const path='/api/mail-workspace/correspondence?'+params;
  host.dataset.path=path;host.setAttribute('aria-busy','true');
  if(!append){const cached=api.peek(path);if(cached)paintCorrespondence(host,cached,id,kind);else host.innerHTML=mailLoadingMarkup('correspondence','往来邮件')}
  try{
   const page=await api(path,{fresh});if(ticket!==mailReaderIntent||state.folder!==kind)return;
   paintCorrespondence(host,page,id,kind,append);if(append)view.scrollTop=previousScroll;
  }catch(error){if(ticket!==mailReaderIntent)return;host.setAttribute('aria-busy','false');const retry='<div class="mail-correspondence-error" role="alert">'+esc(error.message)+' <button class="e-button" data-directory-retry="'+esc(id)+'">重试</button></div>';if(append||api.peek(path)){host.insertAdjacentHTML('beforeend',retry);view.querySelector('[data-directory-more]')?.removeAttribute('disabled')}else host.innerHTML=retry}
 };
 window.openMailDirectoryMessage=async(id,kind,push=true)=>{
  if(!state.workspaceSelected)return;state.workspaceMail=true;state.workspaceMailKind=kind;document.body.classList.add('mail-workspace-nested');pushMailReaderHistory(id,'workspace-message',push);
  if(kind==='sent')await openMailSent(id,false);else await openMail(id,false);
 };
 const update=()=>{
  for(const node of document.querySelectorAll('[data-mail-sync-status]')){const text=mailSyncNotice(data.sync,lastError);if(node.textContent!==text)node.textContent=text;node.hidden=!text}
  for(const item of document.querySelectorAll('[data-workspace-count]')){const kind=item.dataset.workspaceCount;item.textContent=!loaded||lastError?'—':kind==='drafts'?data.drafts.length:kind==='contacts'?data.directory.length:kind==='important'?data.contacts.length:kind==='subscriptions'?data.sources.filter(s=>s.included).length:data.sent_total??data.sent.length}
  if(!document.body.classList.contains('mail-composing')&&['drafts','contacts','important','subscriptions'].includes(state.folder)){if(document.querySelector('.mail-contact-menu:popover-open'))pendingWorkspaceRender=true;else{pendingWorkspaceRender=false;renderMailWorkspace()}}
 };
 window.addEventListener('mail:workspace',()=>{if(loaded)update()});
 // Poll authoritative workspace state without replacing an open editor.
 setInterval(function refreshMailWorkspace(){if(loaded&&!document.hidden)MailWorkspace.load(true).catch(()=>{})},30000);
 window.addEventListener('mail:contact-closed',()=>{if(pendingWorkspaceRender&&!document.querySelector('.mail-contact-menu:popover-open'))update()});
 document.addEventListener('change',event=>{if(!event.target.matches?.('select[data-directory-group]'))return;state.directoryGroup=event.target.value;state.workspaceSelected=null;clearMailReader();activeMailPage.directoryLimit=80;document.getElementById('list').scrollTop=0;renderMailWorkspace()});
 document.addEventListener('click',async event=>{
  const node=event.target.closest('[data-new-mail],[data-draft-open],[data-contact-write],[data-workspace-retry],[data-sent-open],[data-sent-back],[data-send-check],[data-sent-more],[data-sent-retry],[data-directory-open],[data-directory-retry],[data-directory-group],[data-workspace-edit],[data-workspace-return],[data-directory-message],[data-directory-more],[data-source-toggle],[data-directory-important],[data-source-open],[data-directory-list-more]');if(!node)return;
  if(node.hasAttribute('data-new-mail'))return openMailCompose();
  if(node.dataset.draftOpen)return openMailWorkspaceDetail(node.dataset.draftOpen,'drafts');
  if(node.dataset.workspaceEdit)return openMailDraft(node.dataset.workspaceEdit);
  if(node.dataset.sourceOpen){pick('subscriptions');return openMailWorkspaceDetail(node.dataset.sourceOpen,'subscriptions')}
  if(node.dataset.directoryRetry)return openMailWorkspaceDetail(node.dataset.directoryRetry,state.folder,false,false,true);
  if(node.dataset.directoryOpen)return openMailWorkspaceDetail(node.dataset.directoryOpen,state.folder);
  if(node.hasAttribute('data-directory-list-more')){activeMailPage.directoryLimit=(activeMailPage.directoryLimit||80)+80;return renderMailWorkspace()}
  if(node.hasAttribute('data-workspace-return'))return returnToMailList();
  if(node.dataset.directoryMessage)return openMailDirectoryMessage(node.dataset.directoryMessage,node.dataset.messageKind);
  if(node.hasAttribute('data-directory-more'))return openMailWorkspaceDetail(state.workspaceSelected.id,state.workspaceSelected.kind,false,true);
  if(node.hasAttribute('data-source-toggle')){node.disabled=true;try{await MailWorkspace.sourcePreference(node.dataset.sourceToggle,node.dataset.included!=='true')}finally{node.disabled=false}return}
  if(node.dataset.directoryImportant){const c=data.directory.find(c=>c.address===node.dataset.directoryImportant);if(c)MailWorkspace.important(c,!MailWorkspace.isImportant(c.address));return}
  if(node.dataset.sentOpen)return openMailSent(node.dataset.sentOpen);
  if(node.hasAttribute('data-sent-more')){node.disabled=true;return renderMailWorkspace(true)}
  if(node.hasAttribute('data-sent-back'))return returnToMailList();
  if(node.dataset.sentRetry)return openMailSent(node.dataset.sentRetry);
  if(node.dataset.sendCheck){node.disabled=true;try{const m=await MailWorkspace.sendStatus(node.dataset.sendCheck);mailToast(m.state==='sent'?'发信服务器已接收。':m.error||'发送仍在确认中，请稍后核对。',{tone:m.state==='sent'?'success':m.error?'error':'info'});await MailWorkspace.load(true)}catch(error){mailToast(error.message,{tone:'error'})}finally{node.disabled=false}return}
  if(node.hasAttribute('data-workspace-retry')){try{await MailWorkspace.load(true);renderMailWorkspace()}catch(error){mailToast(error.message,{tone:'error'})}return}
  if(node.dataset.contactWrite)return openMailCompose({address:node.dataset.contactWrite});
 });
}
