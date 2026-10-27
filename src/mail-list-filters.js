// Filtering shares each list's authoritative query or complete directory source.
export function mailFilterQuery(query,changes,parse){
 const terms=parse(query||'').filter(t=>!(Object.hasOwn(changes,t.field)||Object.hasOwn(changes,'read')&&t.field==='is'&&['read','unread'].includes(t.value)));
 const term=t=>(t.exclude?'-':'')+(t.field?t.field+':':'')+(/\s/.test(t.value)?'"'+t.value.replaceAll('"','')+'"':t.value);
 return [...terms.map(term),...Object.entries(changes).filter(([,v])=>v).map(([field,value])=>(value==='no'?'-':'')+(field==='read'?'is':field)+':'+(field==='has'?'attachment':value))].join(' ');
}
export function mailFilterCaption(query,scope,parse){
 const terms=parse(query||''),labels=terms.map(t=>t.field==='is'&&['read','unread'].includes(t.value)?((t.value==='read')!==!!t.exclude?'已读':'未读'):t.field==='has'?(t.exclude?'无附件':'有附件'):null);
 return terms.length&&labels.every(Boolean)?[scope,...labels].join(' · '):'“'+query+'”';
}
export function mailDirectoryFilter(rows,filter={}){
 return rows.filter(row=>(!filter.group||row.group===filter.group)&&(!filter.important||!!row.important===(filter.important==='yes'))&&(!filter.source||(filter.source==='list'?!!row.list_id:filter.source==='sender'?!row.list_id:filter.source==='detected'?row.detected:!row.detected))&&(!filter.attachment||!!row.attachments?.length===(filter.attachment==='yes')));
}
export function mailToggleFilter(values,name,value){
 return {...values,[name]:values[name]===value?(name==='order'?'recent':''):value};
}
// Choices describe a useful narrowing of this page, never its implementation type.
export function mailListFilterFields(folder,{data={},filter={},terms=[],order='recent',total}={}){
 const groups={correspondence:'有往来',subscription:'订阅来源',automatic:'自动通知',other:'其他联系人'};
 const field=(name,label,options,value='')=>({name,label,options,value});
 if(['contacts','important'].includes(folder)){
  const rows=(data.directory||[]).filter(r=>folder!=='important'||r.important),keys=Object.keys(groups).filter(key=>rows.some(r=>r.group===key)||filter.group===key);
  return keys.length>1||filter.group?[field('group','联系人分类',[['','全部分类'],...keys.map(key=>[key,groups[key]])],filter.group||'')]:[];
 }
 if(folder==='subscriptions')return [];
 if(folder==='drafts'){
  const rows=data.drafts||[],mixed=rows.some(r=>r.attachments?.length)&&rows.some(r=>!r.attachments?.length);
  return mixed||filter.attachment?[field('attachment','附件',[['','不限'],['yes','有附件'],['no','无附件']],filter.attachment||'')]:[];
 }
 if(total===0&&!terms.length)return [];
 const fields=[],reading=terms.find(t=>t.field==='is'&&['read','unread'].includes(t.value)),attachment=terms.find(t=>t.field==='has');
 if(folder!=='sent')fields.push(field('read','阅读状态',[['','不限'],['unread','未读'],['read','已读']],reading?(reading.exclude?(reading.value==='read'?'unread':'read'):reading.value):''));
 fields.push(field('has','附件',[['','不限'],['yes','有附件'],['no','无附件']],attachment?(attachment.exclude?'no':'yes'):''));
 if(folder!=='sent'&&terms.some(t=>!['is','has'].includes(t.field)))fields.push(field('order','排序',[['recent','最新优先'],['relevance','相关优先']],order));
 return fields;
}
export function installMailListFilters(){
 const list=document.getElementById('list');let owner=null,dispose=null,panel=null,pageScope='',retained=null;
 const enhance=()=>{const nextScope=JSON.stringify([state.folder,state.starred,state.alias,state.box,state.origin,state.category,state.actionOnly]);if(nextScope!==pageScope&&dispose){dispose();dispose=null;retained=null;panel=null;owner=null}const head=list.querySelector('.mail-workspace-title,.mail-results-bar');if(!head||head.closest('.mail-page-skeleton')||head===owner)return;const sameScope=nextScope===pageScope;owner=head;pageScope=nextScope;
  const folder=state.folder,directory=['contacts','important','subscriptions','drafts'].includes(folder),filter=state.directoryFilters?.[folder]||{},terms=directory?[]:parseMailQuery(state.q||'');
  const fields=mailListFilterFields(folder,{data:MailWorkspace.data,filter,terms,order:state.searchOrder,total:folder==='sent'?MailWorkspace.data.sent_total:listMore.total});if(!fields.length){dispose?.();dispose=null;retained=null;panel=null;return}
  // A result commit replaces the heading, not the user's open control. Move
  // its trigger to the new heading and keep the top-layer node and focus.
  const shape=JSON.stringify(fields.map(({name,label,options})=>({name,label,options})));
  if(sameScope&&retained?.shape===shape){const {trigger,values,paint,position}=retained;Object.assign(values,Object.fromEntries(fields.map(f=>[f.name,f.value])));head.insertBefore(trigger,head.querySelector('[data-mail-select-toggle]'));paint();position();return}
  dispose?.();dispose=null;retained=null;
  const category=['contacts','important'].includes(folder),label=category?'分类':'筛选';
  const trigger=document.createElement('button');trigger.type='button';trigger.className='e-button mail-list-filter';head.insertBefore(trigger,head.querySelector('[data-mail-select-toggle]'));
  panel=document.createElement('div');const current=panel;panel.className='e-menu mail-list-filter-panel';const values=Object.fromEntries(fields.map(f=>[f.name,f.value]));panel.innerHTML='<h2>'+esc(label)+'</h2>'+fields.map(f=>'<fieldset><legend>'+esc(f.label)+'</legend><div class="mail-filter-choices">'+f.options.filter(([value])=>value!=='').map(([value,text])=>'<button type="button" class="mail-filter-choice" data-filter-name="'+f.name+'" data-filter-value="'+value+'" aria-pressed="'+(value===f.value)+'">'+esc(text)+'</button>').join('')+'</div></fieldset>').join('');document.body.append(panel);
  const paint=()=>{const active=fields.some(f=>f.name==='order'?values[f.name]!=='recent':!!values[f.name]),caption=active?'清除':label;trigger.dataset.active=String(active);trigger.setAttribute('aria-label',active?'清除全部'+label:label);trigger.title=active?'清除全部'+label:label;if(trigger.dataset.label!==caption){trigger.dataset.label=caption;trigger.innerHTML='<span class="mail-header-action-face">'+(active?EonaUI.icon('close'):document.querySelector('.mail-search-options')?.innerHTML||EonaUI.icon('search'))+'<span data-mail-header-label>'+caption+'</span></span>'}for(const control of current.querySelectorAll('[data-filter-name]'))control.setAttribute('aria-pressed',String(values[control.dataset.filterName]===control.dataset.filterValue))};
  // All heading enhancers must finish before reading the trigger's geometry.
  // Positioning while the selection action is still detached shifts the panel.
  let anchorFrame=0;const position=()=>{cancelAnimationFrame(anchorFrame);anchorFrame=requestAnimationFrame(()=>{anchorFrame=0;if(current.isConnected&&current.matches(':popover-open'))EonaUI.positionPopover(trigger,current)})};
  const apply=()=>{paint();position();if(directory){state.directoryFilters||={};state.directoryFilters[folder]={...values};activeMailPage.directoryLimit=80;list.scrollTop=0;renderMailWorkspace()}else{const {order,...changes}=values,orderChanged=order&&order!==state.searchOrder;if(order)state.searchOrder=order;const query=mailFilterQuery(state.q,changes,parseMailQuery);document.getElementById('q').value=query;if(orderChanged&&query===state.q)loadList();else submitMailSearch()}};
  const binding=EonaUI.bindPopover(trigger,panel,{closeOnSelect:false,onOpen:position});
  trigger.addEventListener('click',event=>{if(trigger.dataset.active!=='true')return;event.preventDefault();event.stopImmediatePropagation();for(const f of fields)values[f.name]=f.name==='order'?'recent':'';binding.close();apply()},{capture:true});
  retained={shape,trigger,values,paint,position};paint();
  panel.onclick=event=>{const choice=event.target.closest('[data-filter-name]');if(!choice)return;Object.assign(values,mailToggleFilter(values,choice.dataset.filterName,choice.dataset.filterValue));apply()};
  dispose=()=>{cancelAnimationFrame(anchorFrame);binding.dispose();current.remove();trigger.remove()};
 };new MutationObserver(enhance).observe(list,{childList:true,subtree:true});enhance();
}
export function mailListFiltersBrowserScript(){return [mailFilterQuery,mailFilterCaption,mailDirectoryFilter,mailToggleFilter,mailListFilterFields,installMailListFilters].map(f=>f.toString()).join('\n')+'\ninstallMailListFilters();'}
export const MAIL_LIST_FILTERS_CSS=`
#app [data-mail-result-count]{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mail-list-filter-panel{width:280px;padding:16px;border-radius:14px}.mail-list-filter-panel h2{margin:0 0 16px;font:600 14px/22px var(--e-ui-font)}
.mail-list-filter-panel fieldset{margin:0 0 16px;padding:0;border:0;min-width:0}.mail-list-filter-panel legend{padding:0;margin-bottom:8px;color:var(--e-ui-muted);font:12px/18px var(--e-ui-font)}
.mail-list-filter-panel fieldset:last-child{margin-bottom:0}.mail-filter-choices{display:flex;flex-wrap:wrap;gap:6px}.mail-filter-choice{flex:1;display:flex;align-items:center;justify-content:center;min-width:64px;min-height:34px;padding:6px 10px;box-sizing:border-box;border:1px solid var(--e-ui-line);border-radius:10px;background:var(--e-ui-surface);color:var(--e-ui-ink);font:500 13px/20px var(--e-ui-font);white-space:nowrap;cursor:pointer;transition:background 160ms,color 160ms,border-color 160ms}
.mail-filter-choice[aria-pressed=true]{color:var(--e-ui-accent);background:var(--e-ui-selected);border-color:var(--e-ui-accent)}.mail-filter-choice:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:2px}.mail-filter-choice:hover{background:var(--e-ui-soft)}.mail-filter-choice[aria-pressed=true]:hover{background:var(--e-ui-selected)}
@media(max-width:860px){.mail-filter-choice{min-height:44px}}
@media(prefers-reduced-motion:reduce){.mail-filter-choice{transition:none}}
`;
