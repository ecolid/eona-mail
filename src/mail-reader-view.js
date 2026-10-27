// Address actions preserve the submitted search and replace only their own field.
export function mailAddressParts(value) {
 const parts=[];let text='',quoted=false,angle=0;
 for(const char of String(value||'')){
  if(char==='"')quoted=!quoted;
  if(!quoted&&char==='<')angle++;
  if(!quoted&&char==='>')angle=Math.max(0,angle-1);
  if(!quoted&&!angle&&(char===','||char===';')){if(text.trim())parts.push(text.trim());text='';}else text+=char;
 }
 if(text.trim())parts.push(text.trim());
 return parts.map(part=>{
  const bracket=part.match(/^(.*?)<([^<>]+)>$/),address=(bracket?bracket[2]:part).trim();
  const name=bracket?bracket[1].trim().replace(/^"|"$/g,''):'';
  return {name,address,searchable:/^[^\s<>"@\r\n]+@[^\s<>"@\r\n]+$/.test(address)};
 });
}

export function mailAddressSearch(query,field,address,parse) {
 if(!['from','to'].includes(field)||!mailAddressParts(address).some(p=>p.address===address&&p.searchable))throw Error('邮件地址无法用于搜索');
 return mailPersonSearch(query,field,address,parse);
}

export function mailPersonSearch(query,field,value,parse) {
 if(!['from','to'].includes(field)||!String(value).trim()||/["\r\n\x00-\x1f]/.test(value))throw Error('联系人无法用于搜索');
 const quote=value=>/\s/.test(value)?'"'+value.replaceAll('"','')+'"':value.replaceAll('"','');
 const terms=parse(query).filter(t=>t.field!==field||t.exclude&&t.value.toLowerCase()!==value.toLowerCase());
 const result=[...terms.map(t=>(t.exclude?'-':'')+(t.field?t.field+':':'')+quote(t.value)),field+':'+quote(value)].join(' ');
 if(result.length>500)throw Error('搜索条件最多500个字符，请缩短关键词。');
 return result;
}

export function mailContactTrigger(part,field,esc,I) {
 const content=(part.name?'<span class="mail-address-name">'+esc(part.name)+'</span>':'')+'<span class="mail-address-email">'+esc(part.address)+'</span>';
 return part.searchable!==false?'<button type="button" class="mail-address" data-mail-contact data-mail-address-field="'+field+'" data-mail-address="'+esc(part.address)+'" data-mail-name="'+esc(part.name||'')+'" aria-label="联系人：'+esc(part.name||part.address)+'" title="联系人操作">'+content+'<span class="mail-contact-caret" aria-hidden="true">'+(I.caret||'')+'</span></button>':'<span class="mail-address-plain">'+content+'</span>';
}

export function mailContactOptions() {
 return {ui:EonaUI,esc,icons:{mail:I.mail,star:I.star,search:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></svg>'},compose:contact=>openMailCompose(contact),search:async(field,value)=>{
  try{if(document.body.classList.contains('mail-composing'))await closeMailComposer();if(['drafts','contacts','important','subscriptions'].includes(state.folder))pick('inbox');const input=document.getElementById('q');input.value=mailPersonSearch(input.value,field,value,parseMailQuery);input.dispatchEvent(new Event('input',{bubbles:true}));submitMailSearch();if(matchMedia('(max-width:860px)').matches)returnToMailList();mailSearch?.open();input.focus()}catch(error){mailToast(error.message,{tone:'error'})}
 }};
}

export function mailMessageHeader({subject,at,back,actions='',envelope},esc,time){
 return '<header id="vhead"><div id="vbar" class="mail-reader-commandbar" aria-label="邮件操作">'+back+'<time class="mail-detail-time">'+esc(time(at))+'</time>'+actions+'</div><h2 class="e-reader-heading">'+esc(subject||'(无主题)')+'</h2><dl class="mail-envelope">'+envelope+'</dl><time class="mail-envelope-time">'+esc(time(at))+'</time></header>';
}

// Selection acknowledges the current intent, independently of detail I/O.
export function mailSelectReaderRow(root,id,kind='received'){
 for(const row of root.querySelectorAll('[data-mail-id],[data-sent-open],[data-directory-message]')){
  const rowKind=row.dataset.messageKind||(row.dataset.sentOpen?'sent':'received');
  row.classList.toggle('on',rowKind===kind&&String(row.dataset.mailId??row.dataset.sentOpen??row.dataset.directoryMessage)===String(id));
 }
}

export function mailReaderAttachments(files,esc,I,{id,kind='received',time=String}={}){
 if(!files?.length)return '';
 const size=value=>!Number.isFinite(value)?'':value<1024?value+' B':value<1048576?Math.max(1,Math.round(value/1024))+' KB':(value/1048576).toFixed(1)+' MB';
 return '<section class="mail-reader-attachments" aria-label="附件"><h3>附件 <span>'+files.length+'</span></h3><ul>'+files.map(file=>{
  const name=file.name||'attachment',url=kind==='received'?(file.key?'/api/file?key='+encodeURIComponent(file.key):null):file.url||(file.id?'/api/mail-workspace/assets/'+encodeURIComponent(file.id):null);
  const metadata=url?size(file.size):file.deleted?'已删除 · '+time(file.deleted_at):file.skipped||'未归档';
  return '<li class="mail-reader-file'+(url?'':' mail-reader-file-unavailable')+'"><span class="mail-reader-file-icon" aria-hidden="true">'+I.clip+'</span><div class="mail-reader-file-copy"><span class="mail-reader-file-name" title="'+esc(name)+'">'+esc(name)+'</span>'+(metadata?'<small>'+esc(metadata)+'</small>':'')+'</div>'+(url?'<a class="mail-reader-file-download" data-mail-download="'+esc(name)+'" href="'+esc(url)+'" aria-label="下载附件 '+esc(name)+'" title="下载附件">'+I.down+'</a>':'')+(url&&kind==='received'?'<button type="button" class="mail-reader-file-delete" data-att-del="'+esc(file.key)+'" data-id="'+esc(String(id))+'" aria-label="删除附件 '+esc(name)+'" title="删除附件">'+I.trash+'</button>':'')+'</li>';
 }).join('')+'</ul></section>';
}

export function mailCanTranslate(mail) {
 const foreign=value=>{const text=String(value||'').slice(0,3000),letters=(text.match(/\p{L}/gu)||[]).length;if(letters<25)return false;const kana=(text.match(/[\u3040-\u30ff\uac00-\ud7af]/g)||[]).length;if(kana/letters>=.05)return true;return (text.match(/[\u4e00-\u9fff]/g)||[]).length/letters<.5};
 return foreign(mail.text_body)||foreign(mail.subject);
}

export function mailReaderHeader(mail,esc,I,time,pending=false) {
 const off=pending?' disabled':'',address=(field,part)=>{const markup=mailContactTrigger(part,field,esc,I);return pending?markup.replace('<button ','<button disabled '):markup};
 const from={name:mail.from_name||'',address:mail.from_addr||'',searchable:mailAddressParts(mail.from_addr).some(x=>x.searchable)};
 const recipients=mailAddressParts(mail.to_addr||mail.origin_to||mail.alias);
 const tags=[...(mail.ai_category?[mail.ai_category]:[]),...(mail.labels?.tags||[])].filter((x,i,a)=>a.indexOf(x)===i);
 return '<header id="vhead">'+
  '<div id="vbar" class="mail-reader-commandbar" aria-label="邮件操作">'+
   '<button id="back" class="btn" onclick="returnToMailList()">'+I.back+'返回</button>'+
   '<time class="mail-detail-time">'+esc(time(mail.received_at))+'</time>'+
   '<div class="mail-reader-translation" data-mail-translation-slot>'+(pending&&mail.can_translate?'<div id="vtrans"><button type="button" disabled>全文翻译</button></div>':'')+'</div>'+
   '<button class="btn mail-star"'+off+' aria-pressed="'+!!mail.is_starred+'" aria-label="'+(mail.is_starred?'取消星标':'设为星标')+'" data-act="'+(mail.is_starred?'unstar':'star')+'" data-id="'+mail.id+'">'+(mail.is_starred?I.starOn:I.star)+'<span>星标</span></button>'+
   '<button class="btn mail-more"'+off+' data-mail-more aria-expanded="false" aria-controls="mail-actions">'+I.more+'更多</button>'+
   '</div>'+
  '<h2 class="e-reader-heading">'+esc(mail.subject||'(无主题)')+'</h2>'+
  '<dl class="mail-envelope"><div><dt>发件人</dt><dd>'+address('from',from)+'</dd></div><div><dt>收件人</dt><dd>'+recipients.map(p=>address('to',p)).join('')+'</dd></div></dl><time class="mail-envelope-time">'+esc(time(mail.received_at))+'</time>'+
  (mail.ai_summary?'<section class="mail-summary" aria-label="AI摘要"><div class="mail-summary-meta"><span class="mail-summary-label">AI摘要</span>'+tags.map(t=>'<span class="chip cat">'+esc(t)+'</span>').join('')+(mail.ai_action?'<span class="chip need">需要处理</span>':'')+'</div><p>'+esc(mail.ai_summary)+'</p></section>':'')+
 '</header>';
}

// Contact menus own their popovers; the list controller owns filtering and selection.
export function installMailContactActions(root,{search,compose,ui,esc,icons},openNow=false) {
 const disposers=[];
 for(const trigger of [...(root.matches?.('[data-mail-contact]')?[root]:[]),...root.querySelectorAll('[data-mail-contact]')]){
  const {mailAddress:address,mailName:name,mailAddressField:field}=trigger.dataset;
  const panel=document.createElement('div');panel.className='e-menu mail-contact-menu';
  panel.setAttribute('aria-label','联系人操作');
  panel.innerHTML='<div class="mail-contact-identity">'+(name?'<strong>'+esc(name)+'</strong>':'')+'<span>'+esc(address)+'</span></div>'+
   '<button type="button" data-contact-search="address">'+icons.search+'<span>搜索'+(field==='from'?'发件人':'收件人')+'邮件</span></button>'+
   (name&&!/["\r\n\x00-\x1f]/.test(name)?'<button type="button" data-contact-search="name">'+icons.search+'<span>按名称搜索<span class="mail-contact-value">'+esc(name)+'</span></span></button>':'')+
   '<button type="button" data-contact-compose>'+icons.mail+'<span>写邮件</span></button>'+
   '<button type="button" data-contact-important>'+icons.star+'<span>读取联系人…</span></button>';
  document.body.append(panel);
  panel.addEventListener('toggle',()=>{if(!panel.matches(':popover-open'))window.dispatchEvent(new Event('mail:contact-closed'))});
  const important=panel.querySelector('[data-contact-important]');
  const binding=ui.bindPopover(trigger,panel,{position:{align:'start'},onOpen:async()=>{important.disabled=true;try{await MailWorkspace.load();important.querySelector('span').textContent=MailWorkspace.isImportant(address)?'取消重要联系人':'设为重要联系人';important.disabled=false}catch{important.querySelector('span').textContent='联系人无法读取'}}});
  panel.onclick=async event=>{const action=event.target.closest('[data-contact-search],[data-contact-compose],[data-contact-important]');if(!action)return;binding.close();if(action.hasAttribute('data-contact-compose'))compose({name,address});else if(action.hasAttribute('data-contact-important')){try{await MailWorkspace.important({name:name.slice(0,200),address},!MailWorkspace.isImportant(address))}catch(error){mailToast(error.message,{tone:'error'})}}else search(field,action.dataset.contactSearch==='name'?name:address)};
  if(openNow)trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  disposers.push(()=>{binding.dispose();panel.remove()});
 }
 return ()=>disposers.forEach(dispose=>dispose());
}

export function showMailContact(trigger,contact){
 trigger.mailContactDispose?.();
 Object.assign(trigger.dataset,{mailContact:'',mailAddress:contact.address,mailName:contact.name||'',mailAddressField:'to'});
 trigger.mailContactDispose=installMailContactActions(trigger,mailContactOptions(),true);
}

export function mailReaderBrowserScript(){return [mailAddressParts,mailAddressSearch,mailPersonSearch,mailContactTrigger,mailContactOptions,mailMessageHeader,mailSelectReaderRow,mailReaderAttachments,mailCanTranslate,mailReaderHeader,installMailContactActions,showMailContact].map(f=>f.toString()).join('\n');}
