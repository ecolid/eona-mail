export function advancedMailQuery(values,parse){
 const quote=value=>value.includes(' ')?'"'+value.replaceAll('"','')+'"':value.replaceAll('"','');
 const term=t=>(t.exclude?'-':'')+(t.field?t.field+':':'')+quote(t.value);
 const words=String(values.words||'').trim(),where=values.where||'';
 const parts=[where?parse(words).map(t=>term({...t,field:t.field||where})).join(' '):words];
 for(const field of ['from','to','subject','filename','after','before','is','in']){const value=String(values[field]||'').trim();if(value)parts.push(field+':'+quote(value))}
 if(values.attachment)parts.push((values.attachment==='no'?'-':'')+'has:attachment');
 const query=parts.filter(Boolean).join(' ');
 if(!query)throw Error('请填写关键词或选择至少一项筛选条件。');
 if(query.length>500)throw Error('搜索条件最多500个字符，请缩短关键词。');
 return query;
}
export function submittedMailSearch(values,parse,{filters=true,previous=''}={}){
 const empty=Object.values(values).every(value=>!String(value||'').trim());
 const query=filters?(empty&&String(previous).trim()?'':advancedMailQuery(values,parse)):String(values.words||'').trim();
 if(!query&&!String(previous).trim())throw Error('请输入关键词或添加筛选条件。');
 return query;
}
export function mailSearchBrowserScript(){return [advancedMailQuery,submittedMailSearch,bindMailSearchActions].map(fn=>fn.toString()).join('\n')+'\n('+mailSearchController.toString()+')();';}
// A keyboard viewport may move the button between press and compatibility click.
// Commit the explicit clear/close intent while its original target still owns it.
export function bindMailSearchActions(form){
 const pressed=new WeakMap(),control=event=>event.target.closest?.('.mail-search-sheet-close,.e-search-clear,[data-cancel-search],[data-reset-search],[type=submit],.mail-search-filter-toggle');
 form.addEventListener('pointerdown',event=>{const button=control(event);if(!button||button.disabled||event.button>0||event.isPrimary===false)return;event.preventDefault();pressed.set(button,performance.now());button.click()},{capture:true});
 form.addEventListener('mousedown',event=>{if(control(event)&&event.button===0)event.preventDefault()},{capture:true});
 form.addEventListener('click',event=>{const button=control(event);if(button&&event.isTrusted&&event.detail>0&&performance.now()-(pressed.get(button)??-Infinity)<800){event.preventDefault();event.stopImmediatePropagation()}},{capture:true});
}
function mailSearchController(){
 let highlightQuery='',highlightTerms=[];
 window.highlightMailSearch=function(value){
  const text=String(value||'');if(!state.q)return esc(text);
  if(highlightQuery!==state.q){highlightQuery=state.q;highlightTerms=parseMailQuery(state.q).filter(t=>!t.exclude&&!['in','after','before','is','has'].includes(t.field)).map(t=>t.value.toLowerCase());}
  const lower=text.toLowerCase(),ranges=[];
  for(const term of highlightTerms){let at=0;while(term&&at<text.length){const found=lower.indexOf(term,at);if(found<0)break;ranges.push([found,found+term.length]);at=found+term.length;}}
  ranges.sort((a,b)=>a[0]-b[0]);const merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push(range)}
  let end=0,out='';for(const [start,stop] of merged){out+=esc(text.slice(end,start))+'<mark>'+esc(text.slice(start,stop))+'</mark>';end=stop}return out+esc(text.slice(end));
 };
 const input=document.getElementById('q');input.title='搜索主题、正文、摘要、发件人、收件人和附件名';
 const trigger=document.createElement('button');trigger.type='button';trigger.className='mail-search-options';trigger.setAttribute('aria-label','高级搜索');trigger.title='高级搜索';
 trigger.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M7 12h10M10 17h4"/></svg>';document.querySelector('#app>header .search').append(trigger);
 const panel=document.createElement('div');panel.className='e-menu mail-search-options-panel';panel.setAttribute('aria-label','高级搜索');
 panel.innerHTML='<form><h2>高级搜索</h2><div class="mail-search-grid"><label class="mail-search-wide">关键词<input name="words" placeholder="多个关键词，或用引号匹配短语"></label><label class="mail-search-wide">关键词位置<select name="where"><option value="">全部字段</option><option value="subject">主题</option><option value="body">正文</option><option value="summary">摘要</option><option value="from">发件人</option><option value="to">收件人</option><option value="filename">附件名</option></select></label><label>发件人<input name="from" placeholder="名称或邮箱"></label><label>收件人<input name="to" placeholder="名称或邮箱"></label><label>主题<input name="subject"></label><label>附件名<input name="filename"></label><label>开始日期<input name="after" type="date"></label><label>截止日期前<input name="before" type="date"></label><label class="mail-search-wide">文件夹<select name="in"><option value="">当前邮件范围</option><option value="any">所有文件夹</option></select></label><label>状态<select name="is"><option value="">不限</option><option value="unread">未读</option><option value="read">已读</option><option value="starred">已星标</option></select></label><label>附件<select name="attachment"><option value="">不限</option><option value="yes">有附件</option><option value="no">无附件</option></select></label></div><div class="mail-search-options-state" role="status" hidden></div><div class="mail-search-form-error" role="alert" hidden></div><div class="mail-search-actions"><button type="button" data-reset-search>重置条件</button><button type="button" data-cancel-search>取消</button><button type="submit">搜索</button></div></form>';
 document.body.append(panel);mailSearchRelated.push(panel);
 const form=panel.querySelector('form'),fields=form.elements,status=panel.querySelector('[role=status]'),error=panel.querySelector('[role=alert]');
 let initialized=false,loadedAt=0,optionsPending=null,formScope='',observedQuery='',mobileBinding=null,mobileDialog=null;
 const query=matchMedia('(max-width:860px)'),drafts=new Map(),fieldKeys=['words','where','from','to','subject','filename','after','before','is','in','attachment'];
 const scopeKey=()=>state.queryScope||'mail',supportsFilters=()=>['mail','sent'].includes(scopeKey());
 const values=()=>Object.fromEntries(fieldKeys.map(key=>[key,fields[key].value]));
 const grid=form.querySelector('.mail-search-grid'),wordsLabel=fields.words.closest('label'),advanced=document.createElement('div'),advancedBody=document.createElement('div'),advancedToggle=document.createElement('button');
 advanced.className='mail-search-advanced mail-search-wide';advancedBody.className='mail-search-advanced-body';advancedToggle.type='button';advancedToggle.className='mail-search-filter-toggle mail-search-wide';advancedToggle.innerHTML='<span>筛选条件</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>';advancedToggle.setAttribute('aria-expanded','false');advanced.id='mail-search-filters';advancedToggle.setAttribute('aria-controls',advanced.id);
 for(const label of [...grid.children])if(label!==wordsLabel)advancedBody.append(label);advanced.append(advancedBody);grid.append(advancedToggle,advanced);
 const setFilters=open=>{form.toggleAttribute('data-mail-search-filters',open);advancedToggle.setAttribute('aria-expanded',String(open));advanced.inert=query.matches&&!open};
 advancedToggle.onclick=()=>setFilters(!form.hasAttribute('data-mail-search-filters'));
 const heading=document.createElement('div');heading.className='mail-search-heading';const title=form.querySelector('h2'),close=document.createElement('button');close.type='button';close.className='mail-search-sheet-close';close.setAttribute('aria-label','关闭搜索');close.innerHTML=EonaUI.icon('close');title.before(heading);heading.append(title,close);
 fields.words.setAttribute('aria-label','搜索邮件关键词');EonaUI.bindSearchField(fields.words);
 const quote=value=>value.includes(' ')?'"'+value.replaceAll('"','')+'"':value.replaceAll('"','');
 const renderTerm=t=>(t.exclude?'-':'')+(t.field?t.field+':':'')+quote(t.value);
 function syncSelects(){for(const select of form.querySelectorAll('select'))select.dispatchEvent(new Event('change',{bubbles:true}))}
 function ensureFolder(value,label){if(value&&![...fields.in.options].some(o=>o.value===value)){const option=document.createElement('option');option.value=value;option.textContent=label||value;fields.in.add(option)}}
 function initialize(){
  if(initialized)return;initialized=true;const words=[];
  for(const term of parseMailQuery(input.value)){
   if(!term.exclude&&['from','to','subject','filename','after','before','is','in'].includes(term.field)){
    if(term.field==='in')ensureFolder(term.value);fields[term.field].value=term.value;
   }else if(term.field==='has'&&['attachment','attachments'].includes(term.value))fields.attachment.value=term.exclude?'no':'yes';
   else words.push(renderTerm(term));
  }
  fields.words.value=words.join(' ');syncSelects();
 }
 function prepareScope(){
  const next=scopeKey();if(formScope!==next){if(formScope&&initialized)drafts.set(formScope,{values:values(),query:observedQuery});formScope=next;form.reset();initialized=false;const saved=drafts.get(next);if(saved&&saved.query===input.value){for(const key of fieldKeys){if(key==='in')ensureFolder(saved.values[key]);fields[key].value=saved.values[key]||''}initialized=true;syncSelects()}observedQuery=input.value}
  if(observedQuery!==input.value){form.reset();initialized=false}observedQuery=input.value;
  if(supportsFilters())initialize();else{if(!initialized)fields.words.value=input.value;initialized=true}form.dataset.searchMode=supportsFilters()?'mail':'local';
 }
 async function loadOptions(force=false){
  if(optionsPending)return optionsPending;if(!force&&Date.now()-loadedAt<30000)return;
  status.hidden=false;status.textContent='正在读取文件夹…';
  optionsPending=(async()=>{
   try{
    const data=await api('/api/search/options');if(!Array.isArray(data.folders))throw Error('文件夹列表无法读取');
    const selected=fields.in.value;for(const option of [...fields.in.options])if(option.value&&!['any'].includes(option.value))option.remove();
    for(const row of data.folders){const option=document.createElement('option');option.value=row.value;option.textContent=row.label+' · '+row.count;fields.in.add(option)}
    ensureFolder(selected,selected+'（暂无邮件）');fields.in.value=selected;syncSelects();loadedAt=Date.now();status.hidden=true;
   }catch(e){status.textContent='文件夹选项未能读取。';const retry=document.createElement('button');retry.type='button';retry.className='btn';retry.textContent='重试';retry.onclick=()=>loadOptions(true);status.append(retry);}
   finally{optionsPending=null}
  })();return optionsPending;
 }
 const binding=EonaUI.bindPopover(trigger,panel,{closeOnSelect:false,keepOnViewportChange:true,onOpen:()=>{prepareScope();setFilters(true);loadOptions()}});
 function openMobileSearch(){
  if(mobileBinding)return;mailSearch.close();binding.close();prepareScope();if(supportsFilters())loadOptions();
  const dialog=document.createElement('dialog');dialog.className='e-dialog mail-search-options-panel mail-search-sheet';dialog.setAttribute('aria-label',(input.placeholder||'搜索邮件').replace(/[…\.]+$/,''));title.textContent=dialog.getAttribute('aria-label');for(const trigger of form.querySelectorAll('.e-select-trigger')){const menu=document.getElementById(trigger.getAttribute('aria-controls'));if(menu)form.append(menu)}dialog.append(form);document.body.append(dialog);mobileDialog=dialog;
  const setViewport=()=>{const viewport=window.visualViewport;dialog.style.setProperty('--mail-search-height',Math.max(160,(viewport?.height||innerHeight)-24)+'px');dialog.style.setProperty('--mail-search-bottom',Math.max(0,innerHeight-(viewport?viewport.offsetTop+viewport.height:innerHeight))+'px')};setViewport();
  const abort=new AbortController();window.addEventListener('resize',setViewport,{signal:abort.signal});window.visualViewport?.addEventListener('resize',setViewport,{signal:abort.signal});window.visualViewport?.addEventListener('scroll',setViewport,{signal:abort.signal});
  const returnFocus=document.getElementById('mail-search-toggle');returnFocus.setAttribute('aria-expanded','true');setFilters(supportsFilters()&&fieldKeys.slice(1).some(key=>fields[key].value));
  mobileBinding=openMailDialog(dialog,{initialFocus:fields.words,onClosed:()=>{abort.abort();for(const menu of dialog.querySelectorAll('.e-select-menu'))form.append(menu);panel.append(form);title.textContent='高级搜索';advanced.inert=false;mobileBinding=null;mobileDialog=null;returnFocus.setAttribute('aria-expanded','false');if(returnFocus.isConnected)returnFocus.focus({preventScroll:true})}});
 }
 document.addEventListener('click',event=>{if(query.matches&&event.target.closest('#mail-search-toggle')){event.preventDefault();event.stopImmediatePropagation();openMobileSearch()}},true);
 query.addEventListener('change',()=>{if(mobileBinding)mobileBinding.close();else advanced.inert=false});
 const closeSearch=()=>mobileBinding?mobileBinding.close():binding.close();close.onclick=closeSearch;
 bindMailSearchActions(form);
 form.addEventListener('input',()=>{initialized=true;error.hidden=true});
 form.addEventListener('change',()=>{initialized=true;error.hidden=true});
 form.querySelector('[data-cancel-search]').onclick=closeSearch;
 form.querySelector('[data-reset-search]').onclick=()=>{form.reset();initialized=true;error.hidden=true;syncSelects()};
 form.onsubmit=event=>{
  event.preventDefault();let value;
  try{value=submittedMailSearch(values(),parseMailQuery,{filters:supportsFilters(),previous:input.value})}catch(e){error.textContent=e.message;error.hidden=false;return}
  observedQuery=value;input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));submitMailSearch();closeSearch();mailSearch.close();
 };
 window.refreshMailSearchOptions=()=>{if(initialized)loadOptions(true)};
}

export const MAIL_SEARCH_CSS=`
.mail-search-heading{display:flex;align-items:center;gap:12px;flex:none}.mail-search-heading h2{flex:1}.mail-search-sheet-close,.mail-search-filter-toggle{display:none}
.mail-search-advanced{min-width:0}.mail-search-advanced-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:12px}
@media(max-width:860px){
 body.mail-atlas dialog.mail-search-sheet.e-modal{position:fixed;inset:auto 0 calc(var(--mail-search-bottom,0px) + var(--mail-float-gap,16px) + env(safe-area-inset-bottom));margin:0 auto;padding:0!important;width:calc(100% - 2 * var(--mail-float-gap,16px));max-width:480px;max-height:calc(var(--mail-search-height,100dvh) - 2 * var(--mail-float-gap,16px) - env(safe-area-inset-bottom));box-sizing:border-box;border-radius:var(--mail-float-radius,24px);overflow:hidden;background:var(--e-ui-surface);color:var(--e-ui-ink);animation:mail-sheet-enter 280ms var(--e-ui-ease)}
 body.mail-atlas dialog.mail-search-sheet.e-modal[open]{display:flex;flex-direction:column}body.mail-atlas dialog.mail-search-sheet.e-modal[data-e-closing=true]{animation:mail-sheet-exit 160ms ease-in forwards}
 .mail-search-sheet form{display:flex;flex-direction:column;min-height:0;max-height:var(--mail-search-height,calc(100dvh - 24px));width:100%}
 .mail-search-sheet .mail-search-heading{padding:16px 16px 8px}body.mail-atlas dialog.mail-search-sheet .mail-search-heading h2{flex:1;margin:0;font:600 16px/24px var(--e-ui-font)}
 body.mail-atlas dialog.mail-search-sheet .mail-search-sheet-close{display:grid;place-items:center;width:44px;height:44px;min-width:44px;padding:10px;border:0;border-radius:50%;background:var(--e-ui-soft);color:var(--e-ui-muted)}.mail-search-sheet-close svg{width:20px;height:20px}
 .mail-search-sheet .mail-search-grid{display:block;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 16px 12px}.mail-search-sheet label{font-size:12px;color:var(--e-ui-muted)}
 .mail-search-sheet .mail-search-advanced-body{grid-template-columns:minmax(0,1fr);min-height:0;overflow:hidden}.mail-search-sheet .mail-search-advanced{display:grid;grid-template-rows:0fr;transition:grid-template-rows 220ms var(--e-ui-ease),visibility 0s 220ms;visibility:hidden}
 .mail-search-sheet [data-mail-search-filters] .mail-search-advanced{grid-template-rows:1fr;visibility:visible;transition-delay:0s}
 body.mail-atlas dialog.mail-search-sheet .mail-search-filter-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;width:100%;padding:8px 12px;border:0;border-radius:12px;background:var(--e-ui-soft);color:var(--e-ui-ink);font:500 13px/20px var(--e-ui-font)}.mail-search-filter-toggle svg{width:16px;height:16px;transition:transform 220ms var(--e-ui-ease)}.mail-search-filter-toggle[aria-expanded=true] svg{transform:rotate(180deg)}
 .mail-search-sheet [data-search-mode=local] :is(.mail-search-filter-toggle,.mail-search-advanced,[role=status]){display:none}
 .mail-search-sheet .mail-search-actions{flex:none;position:relative;padding:12px 16px 16px;border-top:1px solid var(--e-ui-line);gap:12px;background:var(--e-ui-surface)}body.mail-atlas dialog.mail-search-sheet .mail-search-actions [data-cancel-search]{display:none}.mail-search-sheet .mail-search-actions [data-reset-search]{margin-right:auto;background:var(--e-ui-soft);color:var(--e-ui-ink);border:1px solid var(--e-ui-line)}body.mail-atlas dialog.mail-search-sheet .mail-search-actions>[type=submit]{min-width:88px;border-radius:14px}
 .mail-search-sheet :is(.mail-search-options-state,.mail-search-form-error){flex:none;padding:0 16px}.mail-search-sheet .mail-search-form-error{color:var(--e-ui-danger)}
}
@media(prefers-reduced-motion:reduce){.mail-search-advanced,.mail-search-filter-toggle svg,body.mail-atlas dialog.mail-search-sheet.e-modal{animation:none!important;transition:none!important}}
`;
