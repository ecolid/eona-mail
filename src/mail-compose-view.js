// The compose screen shares the mailbox shell and account-owned workspace.
export function installMailComposer() {
 const workspace=MailWorkspace;
 let active=null,returnFocus=null,dirty=false,saving=null,timer=0,intent=0,sending=false,attempt=null,firstDirtyAt=0,slowSaveTimer=0;
 let protection=null;const editingLease=createMailDraftLease(workspace),releaseEditing=()=>editingLease.release(),beginEditing=id=>protection=editingLease.begin(id);
 const panel=document.createElement('section');panel.className='mail-compose';panel.hidden=true;panel.setAttribute('aria-label','写邮件');
 panel.innerHTML='<div class="mail-compose-heading"><h1>写邮件</h1><button class="e-button" type="button" data-compose-close>'+I.back+'返回邮件</button></div><div class="mail-compose-canvas"><form id="mail-compose-form" class="mail-compose-form" novalidate><div class="mail-compose-toolbar"><button class="e-button mail-primary" type="submit" data-compose-send>'+I.send+'发送</button><button class="e-button" type="button" data-compose-save>保存草稿</button><button class="e-button mail-discard" type="button" data-compose-discard>'+I.trash+'丢弃</button><span class="mail-compose-status" role="status" aria-live="polite"></span></div><div class="mail-compose-envelope"><div class="mail-form-field"><span>发件人</span><select name="from_id" aria-label="发件人"></select></div><div class="mail-form-field"><label for="mail-compose-to">收件人</label><div class="mail-recipients"><input id="mail-compose-to" name="to" autocomplete="off" placeholder="邮箱地址，多个地址用逗号分隔"><button class="mail-text-action" type="button" aria-label="显示抄送与密送" title="显示抄送与密送" data-compose-cc>抄送 / 密送</button></div></div><div class="mail-form-field" data-cc-row hidden><label for="mail-compose-cc">抄送</label><input id="mail-compose-cc" name="cc" autocomplete="off"></div><div class="mail-form-field" data-cc-row hidden><label for="mail-compose-bcc">密送</label><input id="mail-compose-bcc" name="bcc" autocomplete="off"></div><label class="mail-form-field"><span>主题</span><input name="subject" maxlength="300" autocomplete="off"></label></div><section class="mail-compose-message" aria-label="编辑邮件"><div class="mail-rich-editor"></div></section><div class="mail-compose-recovery" hidden><button class="e-button" type="button" data-compose-retry>重试保存</button><button class="e-button" type="button" data-compose-copy>另存为新草稿</button><button class="e-button" type="button" data-compose-check hidden>核对发送状态</button></div></form></div>';
 const commandbar=panel.querySelector('.mail-compose-toolbar');commandbar.querySelector('[type=submit]').setAttribute('form','mail-compose-form');panel.querySelector('.mail-compose-heading').insertBefore(commandbar,panel.querySelector('[data-compose-close]'));
 document.querySelector('main').append(panel);
 const form=panel.querySelector('form'),fields=form.elements,status=panel.querySelector('[role=status]'),recovery=panel.querySelector('.mail-compose-recovery'),send=panel.querySelector('[data-compose-send]');
 panel.querySelector('.mail-compose-heading h1').after(status);
 const composition=installMailComposition(form,{start:()=>clearTimeout(timer),commit:()=>capture()});
 let uploading=false;
 const editor=createMailEditor(panel.querySelector('.mail-rich-editor'),{onChange:()=>capture(),onStatus:value=>{status.textContent=value},onUpload:async file=>{if(!active)throw Error('请先打开草稿。');uploading=true;syncSenders();try{if(!active.rev)dirty=true;await flush();if(dirty)throw Error('草稿尚未保存，请先重试保存。');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('文件读取失败。'));reader.readAsDataURL(file)});return await workspace.upload(active,{name:file.name,type:file.type,data})}finally{uploading=false;syncSenders()}},onRemove:async id=>{await flush();if(!dirty)await workspace.removeAsset(active,id).catch(error=>{status.textContent=error.message})}});
 const heading=panel.querySelector('.mail-compose-heading');heading.prepend(panel.querySelector('[data-compose-close]'));panel.querySelector('[data-compose-close]').innerHTML=I.back;panel.querySelector('[data-compose-close]').setAttribute('aria-label','返回邮件');panel.querySelector('[data-compose-close]').title='返回邮件';panel.querySelector('[data-compose-save]').innerHTML=editor.icons.save+'<span>保存</span>';panel.querySelector('[data-compose-save]').setAttribute('aria-label','保存草稿');panel.querySelector('[data-compose-save]').title='保存草稿';panel.querySelector('[data-compose-discard]').innerHTML=I.trash;panel.querySelector('[data-compose-discard]').setAttribute('aria-label','丢弃草稿');panel.querySelector('[data-compose-discard]').title='丢弃草稿';
 const recipientLabels={to:'收件人',cc:'抄送',bcc:'密送'},pickers=[];
 for(const key of Object.keys(recipientLabels)){
  const input=fields[key];input.setAttribute('aria-label',recipientLabels[key]);const wrap=input.closest('.mail-recipients')||document.createElement('div');
  if(!wrap.classList.contains('mail-recipients')){wrap.className='mail-recipients';input.before(wrap);wrap.append(input)}
  const button=document.createElement('button');button.type='button';button.className='mail-compose-people-button';button.setAttribute('aria-label','选择'+recipientLabels[key]+'联系人');button.innerHTML=I.person;wrap.append(button);
  const menu=document.createElement('div');menu.className='e-menu mail-recipient-menu';menu.setAttribute('aria-label',recipientLabels[key]+'联系人');menu.innerHTML='<div class="mail-recipient-heading">'+recipientLabels[key]+'</div><div class="mail-recipient-search"><input type="search" aria-label="搜索'+recipientLabels[key]+'联系人" placeholder="搜索姓名或邮箱"></div><div class="mail-recipient-list"></div>';panel.append(menu);
  const search=menu.querySelector('input'),list=menu.querySelector('.mail-recipient-list');let signature='';
  const render=()=>{
   const next=JSON.stringify([search.value,fields.to.value,fields.cc.value,fields.bcc.value,workspace.data.directory]);if(signature===next)return;signature=next;
   const selected=Object.fromEntries(Object.keys(recipientLabels).map(k=>[k,mailAddressParts(fields[k].value).map(p=>p.address.toLowerCase())]));
   const contacts=(workspace.data.directory||[]).filter(c=>!search.value||EonaUI.searchRank(search.value,{name:c.name,address:c.address}));
   list.innerHTML=contacts.map(c=>{const address=c.address.toLowerCase(),own=selected[key].includes(address),other=Object.keys(recipientLabels).find(k=>k!==key&&selected[k].includes(address));return '<button type="button" class="mail-recipient-option" role="checkbox" aria-checked="'+own+'" '+(other&&!own?'disabled ':'')+'data-recipient-address="'+esc(c.address)+'"><span class="mail-recipient-check" aria-hidden="true">'+(own?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4L19 6"/></svg>':'')+'</span><span class="mail-recipient-copy"><strong>'+esc(c.name||c.address)+'</strong>'+(c.name?'<span>'+esc(c.address)+'</span>':'')+'</span><small>'+(own?'已选':other?'已在'+recipientLabels[other]:'')+'</small></button>'}).join('')||'<p class="mail-contact-empty">没有匹配的联系人</p>';
  };
  const pop=EonaUI.bindPopover(button,menu,{closeOnSelect:false,onOpen:()=>{render();search.focus()},position:{align:'end'}});
  search.oninput=render;EonaUI.bindSearchField(search);
  menu.addEventListener('click',event=>{const option=event.target.closest('[data-recipient-address]');if(!option||option.disabled||!active||sending||attempt)return;input.value=toggleMailRecipient(input.value,option.dataset.recipientAddress);capture();render();list.querySelector('[data-recipient-address="'+CSS.escape(option.dataset.recipientAddress)+'"]')?.focus()});
  search.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();list.querySelector('button:not(:disabled)')?.focus()}});
  pickers.push({render,close:pop.close,button});
 }
 const closePickers=()=>pickers.forEach(p=>p.close());
 const senderSettings=document.createElement('button');senderSettings.className='e-button mail-sender-settings';senderSettings.type='button';senderSettings.setAttribute('aria-label','发信设置');senderSettings.title='发信设置';senderSettings.innerHTML=EonaUI.icon('settings')+'<span>发信设置</span>';senderSettings.onclick=async()=>{await close();state.mailSettingsSection='sending';pick('settings');};
 const fromWrap=document.createElement('span');fromWrap.className='mail-from-control';fields.from_id.before(fromWrap);fromWrap.append(fields.from_id);commandbar.append(senderSettings);
 const meaningful=d=>d.to||d.subject||d.body||d.cc||d.bcc||d.attachments?.length||d.document?.ops?.some(o=>typeof o.insert==='object');
 const syncSenders=()=>{
  const senders=workspace.data.senders||[],signature=JSON.stringify([senders,active?.from_id]);
  if(fields.from_id.dataset.source!==signature){fields.from_id.innerHTML=senders.length?senders.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name?s.name+' <'+s.address+'>':s.address)+'</option>').join(''):'<option value="">暂无可用发件账号</option>';if(active?.from_id&&!senders.some(s=>s.id===active.from_id))fields.from_id.insertAdjacentHTML('afterbegin','<option value="'+esc(active.from_id)+'" disabled>原发件账号已不可用</option>');fields.from_id.dataset.source=signature}
  fields.from_id.value=active?.from_id||senders.find(s=>s.default)?.id||senders[0]?.id||'';
  send.disabled=uploading||sending||!!attempt||!senders.length||!!active?.from_id&&!senders.some(s=>s.id===active.from_id&&s.available!==false);
 };
 const feedback=(value='',error=false)=>{clearTimeout(slowSaveTimer);if(status.textContent!==value)status.textContent=value;status.dataset.error=String(error)};
 const normalFeedback=()=>{const sync=(workspace.data.sync?.accounts||[]).find(a=>a.account===active?.from_id),blocked=!!workspace.data.sync?.configured&&(workspace.data.sync?.source_error||sync&&sync.state!=='ok'),otherVersion=workspace.data.drafts.some(d=>d.sync?.conflict_of===active?.id);feedback(active?.previous_failure?'上次发送未成功，草稿会自动保存。':blocked?'已保存在本站，原邮箱同步暂未完成。':otherVersion?'自动保存 · 另一端版本已单独保留':'自动保存',!!blocked);status.title=(active?.updated_at?'上次保存：'+new Date(active.updated_at).toLocaleTimeString():'输入会自动保存')+(sync?.last_success?'；原邮箱上次同步：'+new Date(sync.last_success).toLocaleTimeString():'')};
 const flush=async()=>{
  clearTimeout(timer);if(saving)return saving;if(!active||!dirty||composition.active)return;
  if(!active.rev&&!meaningful(active)&&!uploading){dirty=false;firstDirtyAt=0;normalFeedback();return}
  try{if(protection)await protection;else if(editingLease.id!==active.id)await beginEditing(active.id)}catch(error){protection=null;feedback('编辑保护暂不可用，请重试保存。',true);return}
  saving=(async()=>{while(active&&dirty&&!composition.active){const target=active,snapshot=JSON.parse(JSON.stringify(target));dirty=false;firstDirtyAt=0;slowSaveTimer=setTimeout(()=>{status.textContent='正在保存草稿…'},1500);recovery.hidden=true;
   try{const saved=await workspace.save(snapshot);if(active!==target)return;active.rev=saved.rev;active.updated_at=saved.updated_at;normalFeedback()}
   catch(error){if(active===target){dirty=true;active.conflict=workspace.data.drafts.find(d=>d.id===active.id)?.conflict;feedback(error.message,true);recovery.hidden=false}break}
  }})().finally(()=>{saving=null;syncSenders()});return saving;
 };
 const capture=()=>{if(!active||sending||attempt||composition.active)return;for(const key of ['to','subject','from_id','cc','bcc'])active[key]=fields[key].value;Object.assign(active,editor.get());dirty=true;workspace.local({...active,unsaved:true});if(!firstDirtyAt)firstDirtyAt=Date.now();if(!recovery.hidden&&active.conflict)return;clearTimeout(timer);timer=setTimeout(flush,Math.min(600,Math.max(0,5000-(Date.now()-firstDirtyAt))));for(const p of pickers)if(p.button.getAttribute('aria-expanded')==='true')p.render()};
 const lock=value=>{for(const key of ['to','subject','from_id','cc','bcc'])fields[key].disabled=value;editor.lock(value);panel.querySelector('[data-compose-save]').disabled=value;panel.querySelector('[data-compose-discard]').disabled=value;syncSenders();for(const p of pickers)p.button.disabled=value};
 const show=(draft,protect=true)=>{
  if(protect&&editingLease.id!==draft.id)beginEditing(draft.id).catch(error=>feedback('编辑保护暂不可用，当前输入会保留。',true));
  active={...draft,from_id:draft.from_id||workspace.data.senders?.find(s=>s.default)?.id||workspace.data.senders?.[0]?.id||'',cc:draft.cc||'',bcc:draft.bcc||''};active.previous_failure=(workspace.data.outbox||[]).some(m=>m.draft_id===draft.id&&m.draft_rev===draft.rev&&m.state==='failed');dirty=!!draft.unsaved||active.previous_failure||!draft.from_id&&!!active.from_id&&!!meaningful(active);
  attempt=(workspace.data.outbox||[]).find(m=>m.draft_id===draft.id&&['sending','unknown'].includes(m.state))?.id||null;
  for(const key of ['to','subject','cc','bcc'])fields[key].value=active[key]||'';editor.set(active);
  syncSenders();panel.hidden=false;document.body.classList.add('mail-composing');mailDrawer.close();
  for(const row of panel.querySelectorAll('[data-cc-row]'))row.hidden=!(active.cc||active.bcc);
  recovery.hidden=!attempt;panel.querySelector('[data-compose-check]').hidden=!attempt;
  panel.querySelector('[data-compose-retry]').hidden=!!attempt;panel.querySelector('[data-compose-copy]').hidden=!!attempt;
  if(dirty&&active.conflict){recovery.hidden=false;panel.querySelector('[data-compose-copy]').hidden=false;panel.querySelector('[data-compose-retry]').hidden=true}
  status.textContent=attempt?'上次发送结果待确认，请先核对。':dirty&&active.conflict?'草稿在其他页面有更新，当前输入已保留，可另存为新草稿。':workspace.data.sending_error||(!workspace.data.senders?.length?'发信通道尚未连接，仍可保存草稿。':draft.rev?'草稿已保存':'');
  firstDirtyAt=0;closePickers();if(!attempt&&!active.conflict&&!workspace.data.sending_error&&workspace.data.senders?.length)normalFeedback();lock(!!attempt);(active.to?fields.subject:fields.to).focus();if(dirty&&!active.conflict&&meaningful(active))flush();
 };
 const finishComposition=async()=>{if(composition.active){document.activeElement?.blur();await composition.settled()}};
 const close=async()=>{await finishComposition();if(uploading||editor.busy){status.textContent='文件正在添加，请稍候。';await editor.settled()}await flush();await releaseEditing();closePickers();panel.hidden=true;document.body.classList.remove('mail-composing');window.dispatchEvent(new Event('mail:workspace'));returnFocus?.isConnected&&returnFocus.focus()};
 window.closeMailComposer=close;
 window.openMailCompose=async(contact={address:''})=>{
  const ticket=++intent;returnFocus=document.activeElement;
  try{await workspace.load();await finishComposition();if(editor.busy)await editor.settled();await flush();if(ticket!==intent)return;if(dirty){show({...active,unsaved:true});return}
   const next={id:crypto.randomUUID(),to:contact.address||'',subject:contact.subject||'',body:contact.body||'',rev:0,unsaved:true};const ready=beginEditing(next.id);if(ticket===intent)show(next,false);await ready;
  }catch(error){mailToast(error.message,{tone:'error'})}
 };
 window.openMailDraft=async id=>{const ticket=++intent;returnFocus=document.activeElement;try{await workspace.load();await finishComposition();if(editor.busy)await editor.settled();await flush();if(ticket!==intent)return;if(dirty){show({...active,unsaved:true});return}const draft=workspace.data.drafts.find(d=>d.id===id),ready=beginEditing(id);if(draft){show(draft,false);lock(true)}const fresh=await ready;if(ticket===intent&&(draft||fresh))show(draft?.unsaved?draft:{...draft,...fresh},false)}catch(error){mailToast(error.message,{tone:'error'})}};
 // Quill text-change owns document commits; raw editor input can contain uncommitted IME text.
 form.addEventListener('input',event=>{if(!event.isComposing&&event.target.closest('.mail-compose-envelope'))capture()});fields.from_id.addEventListener('change',capture);
 form.onsubmit=async event=>{
  event.preventDefault();if(composition.active||uploading||editor.busy||sending||attempt||!active)return;
  await flush();if(dirty)return;
  if(!active.rev||!active.to.trim()||!active.subject.trim()||(!active.body.trim()&&!active.attachments?.length&&!active.document?.ops?.some(o=>typeof o.insert==='object'))){status.textContent='请填写收件人、主题和正文。';return}
  sending=true;attempt=crypto.randomUUID();lock(true);status.textContent='正在发送…';
  try{
   const receipt=await workspace.send(active,attempt);
   if(['sent','partial'].includes(receipt.state)){active=null;dirty=false;attempt=null;await close();pick('sent');await renderMailWorkspace();openMailSent(receipt.id);mailToast(receipt.state==='sent'?'邮件已发送':receipt.error,{tone:receipt.state==='sent'?'success':'error'})}
   else if(receipt.state==='failed'){attempt=null;dirty=true;status.textContent=receipt.error;recovery.hidden=true}
   else{attempt=receipt.id;status.textContent=receipt.error||'正在确认发送结果…';recovery.hidden=false;panel.querySelector('[data-compose-check]').hidden=false;panel.querySelector('[data-compose-retry]').hidden=true;panel.querySelector('[data-compose-copy]').hidden=true}
  }catch(error){status.textContent=error.message;if(error.definitelyNotSubmitted){attempt=null;recovery.hidden=true}else{recovery.hidden=false;panel.querySelector('[data-compose-check]').hidden=false;panel.querySelector('[data-compose-retry]').hidden=true;panel.querySelector('[data-compose-copy]').hidden=true}}
  finally{sending=false;lock(!!attempt)}
 };
 panel.querySelector('[data-compose-close]').onclick=close;
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&event.keyCode!==229&&!composition.active&&!event.defaultPrevented&&!document.querySelector(':popover-open,dialog[open]')){event.preventDefault();event.stopPropagation();close()}});
 panel.querySelector('[data-compose-save]').onclick=async()=>{if(composition.active)return;await flush();if(!dirty)mailToast('草稿已保存',{tone:'success'})};
 panel.querySelector('[data-compose-cc]').onclick=()=>{for(const row of panel.querySelectorAll('[data-cc-row]'))row.hidden=!row.hidden;fields.cc.focus()};
 panel.querySelector('[data-compose-retry]').onclick=flush;
 panel.querySelector('[data-compose-copy]').onclick=async()=>{if(!active)return;await finishComposition();await flush();const old=active.id,copy={...active,id:crypto.randomUUID(),rev:0,conflict:false,unsaved:true,previous_failure:false};active=copy;dirty=true;workspace.local(copy);await flush();if(!dirty){await workspace.restore(old);show(workspace.data.drafts.find(d=>d.id===copy.id))}};
 panel.querySelector('[data-compose-discard]').onclick=async()=>{if(!active||editor.busy||uploading||sending||attempt||!await EonaUI.confirm({title:'丢弃这封草稿？',description:active.subject||active.to||'新邮件',action:'丢弃草稿',danger:true}))return;await flush();try{if(active.rev)await workspace.remove(active);active=null;dirty=false;await close();mailToast('草稿已丢弃',{tone:'success'})}catch(error){status.textContent=error.message;recovery.hidden=false}};
 panel.querySelector('[data-compose-check]').onclick=async()=>{if(!attempt)return;try{const receipt=await workspace.sendStatus(attempt);if(['sent','partial'].includes(receipt.state)){await workspace.load(true);active=null;dirty=false;attempt=null;await close();pick('sent');await renderMailWorkspace();openMailSent(receipt.id)}else{status.textContent=receipt.error||'发信服务器仍在确认中，请稍后核对。';if(receipt.state==='failed'){attempt=null;dirty=true;lock(false)}}}catch(error){status.textContent=error.message}};
 window.addEventListener('mail:send-checking',()=>{if(sending)status.textContent='正在核对发送结果…'});
 window.addEventListener('mail:workspace',()=>{syncSenders();if(!panel.hidden){if(active&&!dirty&&!saving&&!sending&&!attempt)normalFeedback();for(const p of pickers)if(p.button.getAttribute('aria-expanded')==='true')p.render()}});
}

// Preserve quoted display names and unfinished user tokens when a picker toggles one address.
export function toggleMailRecipient(value,address){
 const parts=[];let part='',quoted=false,angle=0;
 for(const c of String(value||'')){if(c==='"')quoted=!quoted;if(!quoted&&c==='<')angle++;if(!quoted&&c==='>')angle=Math.max(0,angle-1);if(!quoted&&!angle&&(c===','||c===';')){if(part.trim())parts.push(part.trim());part=''}else part+=c}
 if(part.trim())parts.push(part.trim());const same=p=>(/^[^<>]*<([^<>]+)>$/.exec(p)?.[1]||p).trim().toLowerCase()===address.toLowerCase();
 return (parts.some(same)?parts.filter(p=>!same(p)):[...parts,address]).join(', ');
}
export function mailComposeBrowserScript(){return createMailDraftLease.toString()+';'+installMailComposition.toString()+';'+toggleMailRecipient.toString()+';('+installMailComposer.toString()+')();';}

// Quill batches marked text until its compositionend microtask. Commit after it,
// including the WebKit ordering where DOM updates follow the native event.
export function installMailComposition(form,{start,commit}){
 let active=false,ticket=0,resolve=null,pending=Promise.resolve();
 form.addEventListener('compositionstart',()=>{ticket++;if(!active)pending=new Promise(done=>{resolve=done});active=true;form.dataset.mailComposing='true';start()});
 form.addEventListener('compositionend',()=>{const ended=ticket;queueMicrotask(()=>{if(ended!==ticket)return;active=false;delete form.dataset.mailComposing;try{commit()}finally{resolve?.();resolve=null}})});
 return {get active(){return active},settled:()=>pending};
}

// A late open request releases only its own token, never the current editor's lease.
export function createMailDraftLease(workspace,timers={setInterval:(...args)=>setInterval(...args),clearInterval:id=>clearInterval(id)},editorID=crypto.randomUUID()){
 let epoch=0,current=null,timer=0;
 const stop=()=>{timers.clearInterval(timer);timer=0};
 const end=async lease=>{if(lease)await Promise.resolve(workspace.editing?.(lease.id,lease.token,false)).catch(()=>{})};
 return {
  get id(){return current?.id||null},
  async release(){epoch++;stop();const previous=current;current=null;await end(previous)},
  async begin(id){
   if(current?.id===id)return null;
   const ticket=++epoch;stop();const previous=current;current=null;await end(previous);
   if(ticket!==epoch)return null;
   const lease={id,token:editorID+'-'+ticket},result=await workspace.editing?.(id,lease.token,true);
   if(ticket!==epoch){await end(lease);return null;}
   current=lease;timer=timers.setInterval(()=>Promise.resolve(workspace.editing?.(id,lease.token,true)).catch(()=>{}),25000);
   return result?.draft;
  },
 };
}
