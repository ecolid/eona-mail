/* EonaUI version: 1.14.9 */
/* 公共组件只处理界面；身份、数据权限、退出请求由各站提供。 */
(() => {
  'use strict';
  const root = document.documentElement;
  const paths = {
    apps: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    theme: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z',
    close: 'm6 6 12 12M18 6 6 18',
    search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
    message: 'M4 4h16v13H8l-4 4z',
    server: 'M3 3h18v7H3zM3 14h18v7H3zM7 6.5h.01M7 17.5h.01',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    ledger: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h4',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    key: 'M21 2l-9 9M17 6l2 2M15 8l2 2M12 15a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
    brain: 'M9 3a3 3 0 0 0-3 3 4 4 0 0 0-2 7 4 4 0 0 0 5 7h2V4M15 3a3 3 0 0 1 3 3 4 4 0 0 1 2 7 4 4 0 0 1-5 7h-2V4',
    check: 'm5 12 4 4L19 6',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    user: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
    logout: 'M9 3H3v18h6M9 12h12m-4-4 4 4-4 4',
    automatic: 'M20 8a9 9 0 0 0-16-2M4 3v3h3M4 16a9 9 0 0 0 16 2m0 3v-3h-3M8.5 16 12 7l3.5 9m-5.8-3h4.6',
  };
  const icon = key => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[key]+'"/></svg>';
  const node = (tag, cls, text) => {const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n;};
  const read = key => {try{return localStorage.getItem(key)}catch{return null}};
  const write = (key,value) => {try{localStorage.setItem(key,value)}catch{}};
  let appearance = read('eona-appearance');
  if(!['auto','light','dark'].includes(appearance)) {
    const old = read('eona-skin2') || read('eona-theme') || read('cang-demo-theme') || read('theme');
    appearance = ['light','dark'].includes(old) ? old : 'auto';
  }
  const media = matchMedia('(prefers-color-scheme: dark)');
  function applyAppearance(value, persist=false) {
    appearance = ['auto','light','dark'].includes(value) ? value : 'auto';
    const dark = appearance==='dark' || (appearance==='auto' && media.matches);
    root.classList.toggle('dark',dark); root.dataset.theme=dark?'dark':'light'; root.style.colorScheme=dark?'dark':'light';
    if(persist)write('eona-appearance',appearance);
    for(const b of document.querySelectorAll('[data-e-appearance]')) b.setAttribute('aria-checked',String(b.dataset.eAppearance===appearance));
    window.dispatchEvent(new CustomEvent('eona:appearance',{detail:{appearance,dark}}));
  }
  media.addEventListener('change',()=>{if(appearance==='auto')applyAppearance('auto')});
  applyAppearance(appearance);
  // Pointer focus is transient; keyboard focus remains visible across returns.
  root.dataset.eInputMode='pointer';
  document.addEventListener('keydown',event=>{if(event.key==='Tab'||event.key.startsWith('Arrow'))root.dataset.eInputMode='keyboard'},{capture:true});
  document.addEventListener('pointerdown',event=>{root.dataset.eInputMode='pointer';let active=document.activeElement;while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;if(active&&!event.composedPath().includes(active)&&!active.contains?.(event.composedPath()[0]))active.blur?.()},{capture:true,passive:true});
  const popovers=new Set();
  function dismissPopovers(){for(const close of popovers)close()}
  function motionDuration(token){const value=getComputedStyle(root).getPropertyValue(token).trim();return (parseFloat(value)||0)*(value.endsWith('ms')?1:1000)}
  // A shared viewport anchor also serves native presentation adapters. Native
  // open/close and focus controllers keep ownership of their own surfaces.
  function positionPopover(button,panel,options={}) {
    const viewport=document.documentElement.clientWidth||innerWidth;
    const visible=typeof visualViewport==='object'?visualViewport:null,screenTop=visible?.offsetTop||0,screenHeight=visible?.height||innerHeight;
    panel.style.setProperty?.('--e-popover-available-height',Math.max(0,screenHeight-24)+'px');
    panel.style.maxWidth=Math.max(0,viewport-24)+'px';
    const r=button.getBoundingClientRect();if(options.matchWidth)panel.style.width=Math.max(options.minWidth||0,r.width)+'px';const width=panel.offsetWidth,height=panel.offsetHeight;
    const gutter=12,mobile=matchMedia('(max-width:860px)').matches;
    const right=options.align==='start'?Math.max(gutter,Math.min(viewport-r.left-width,viewport-width-gutter)):mobile?gutter:Math.max(gutter,Math.min(viewport-r.right,viewport-width-gutter));
    panel.style.left='auto';panel.style.right=right+'px';panel.style.bottom='auto';
    const bottom=screenTop+screenHeight,below=r.bottom+8,top=options.matchWidth&&below+height>bottom-gutter&&r.top-screenTop>bottom-r.bottom?r.top-height-8:below;panel.style.top=Math.max(screenTop+gutter,Math.min(top,bottom-height-gutter))+'px';
  }
  function bindPopover(button, panel, options={}) {
    const controller=new AbortController(),signal=controller.signal;
    const query=options.media?matchMedia(options.media):null;
    const enabled=()=>!query||query.matches;
    panel.popover='auto'; panel.id ||= 'e-menu-'+crypto.randomUUID();
    button.setAttribute('aria-controls',panel.id); button.setAttribute('aria-expanded','false'); button.setAttribute('aria-haspopup','true');
    const position=()=>positionPopover(button,panel,options.position);
    // Auto-popover light dismissal can precede click. Remember the pointer's
    // initial state so a second tap closes instead of immediately reopening.
    let pointerOpened=false,linkCloseTimer=0;
    button.addEventListener('pointerdown',()=>{pointerOpened=panel.matches(':popover-open')},{signal});
    button.addEventListener('pointercancel',()=>{pointerOpened=false},{signal});
    button.addEventListener('click',e=>{if(!enabled())return;clearTimeout(linkCloseTimer);const wasOpen=e.detail!==0&&pointerOpened;pointerOpened=false;if(wasOpen){close();return;}panel.togglePopover();if(panel.matches(':popover-open')){position();options.onOpen?.()}},{signal});
    panel.addEventListener('toggle',()=>{const open=panel.matches(':popover-open');button.setAttribute('aria-expanded',String(open));if(open)position()},{signal});
    button.addEventListener('keydown',e=>{if(!enabled())return;if(e.key==='Escape'&&panel.matches(':popover-open')){e.preventDefault();e.stopPropagation();close();button.focus()}else if(e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();panel.showPopover();position();options.onOpen?.();(panel.querySelector('[aria-selected="true"]')||panel.querySelector('input,button,a'))?.focus()}},{signal});
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();button.focus()}else if(!e.target.matches('input,textarea')&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){const items=[...panel.querySelectorAll('button:not(:disabled),a[href]')];const index=items.indexOf(panel.getRootNode().activeElement);e.stopPropagation();const next=e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;e.preventDefault();items[next]?.focus()}},{signal});
    panel.addEventListener('click',e=>{const selected=e.target.closest('button,a');if(options.closeOnSelect!==false&&selected&&!e.target.closest('.e-select')&&e.composedPath().find(n=>n?.hasAttribute?.('popover'))===panel){if(selected.tagName==='A'&&selected.hasAttribute('href'))linkCloseTimer=setTimeout(close,0);else close()}},{signal});
    // 弹层进入浏览器顶层，滚动或缩放时关闭，避免脱离触发按钮。
    const close=()=>{clearTimeout(linkCloseTimer);linkCloseTimer=0;if(panel.isConnected&&panel.matches(':popover-open'))panel.hidePopover()};
    const observer=new ResizeObserver(()=>{if(panel.matches(':popover-open'))position()});observer.observe(panel);
    popovers.add(close);
    const outside=e=>{if(panel.matches(':popover-open')&&!e.composedPath().includes(panel)&&!e.composedPath().includes(button))close()};
    for(const event of ['scroll','wheel','touchmove'])document.addEventListener(event,outside,{capture:true,passive:true,signal});
    document.addEventListener('pointerdown',outside,{capture:true,passive:true,signal});
    // Keyboard and browser chrome resize the visible viewport while a form is
    // still being edited. Keep its draft and submit target in the same surface.
    const viewportChanged=()=>{if(!panel.matches(':popover-open'))return;if(options.keepOnViewportChange||panel.querySelector('input,textarea'))position();else close()};
    window.addEventListener('resize',viewportChanged,{signal});window.visualViewport?.addEventListener('resize',viewportChanged,{signal});window.visualViewport?.addEventListener('scroll',viewportChanged,{signal});
    const sync=()=>{close();panel.popover=enabled()?'auto':null;button.setAttribute('aria-expanded','false')};
    if(query){query.addEventListener('change',sync,{signal});sync()}
    return {close,dispose:()=>{close();popovers.delete(close);observer.disconnect();controller.abort()}};
  }
  // Each site keeps its own gateway; credentials are entered only at the
  // central account page. Never accept a cross-origin return destination.
  function loginUrl(returnTo=location.pathname+location.search+location.hash) {
    let back='/';
    if(typeof returnTo==='string'&&returnTo.startsWith('/')&&!returnTo.startsWith('//')&&!/[\\\x00-\x1f\x7f]/.test(returnTo)) {
      try {const target=new URL(returnTo,location.origin);if(target.origin===location.origin&&target.pathname!=='/login'&&!target.pathname.startsWith('/auth/'))back=target.pathname+target.search+target.hash;}catch{}
    }
    return '/auth/start?return='+encodeURIComponent(back);
  }
  function startLogin(returnTo) {location.replace(loginUrl(returnTo));}
  function alignTopbar(host,search,input) {
    if(!host)return;host.classList.add('e-topbar');
    for(const brand of host.querySelectorAll('.fi-logo,.sw-brand,.logo,.cg-brand'))brand.classList.add('e-topbar-logo');
    for(const product of host.querySelectorAll('.e-product,.brandtext,.sw-brand>span,.cg-brand>span'))product.classList.add('e-topbar-product');
    if(!search||!input)return;search.classList.add('e-topbar-search');
    const field=input.closest('.e-search-field,.e-search-panel,.fi-input-wrp')||search;field.classList.add('e-search-field');
    const prefix=field.querySelector('.fi-input-wrp-prefix')||field;
    // Claim the leading icon before a site's deferred icon renderer runs.
    // Exclude trailing clear buttons and keep repeated alignment idempotent.
    const existing=[...prefix.children].filter(child=>child.matches('svg,[data-lucide="search"],[data-e-search-icon]'));
    const markup=icon('search').replace('<svg ','<svg data-e-search-icon="" ');
    if(existing.length){existing[0].outerHTML=markup;existing.slice(1).forEach(child=>child.remove());}
    else prefix.insertAdjacentHTML('afterbegin',markup);
  }
  const searchBindings=new WeakMap();
  const searchFields=new WeakMap();
  function searchTerms(query){return [...String(query||'').normalize('NFKC').trim().slice(0,500).matchAll(/(-?)("[^"]*"|[^\s]+)/g)].map(m=>({exclude:!!m[1],value:m[2].replace(/^"|"$/g,'').toLocaleLowerCase()})).filter(t=>t.value);}
  const searchNormalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
  function searchRank(query,fields){
    const entries=typeof fields==='object'&&fields!==null?Object.entries(fields):[['title',fields]],all=entries.map(([,v])=>searchNormalize(v)).join(' '),terms=searchTerms(query);let score=1;
    for(const term of terms){const field=/^([a-z]+):(.+)$/i.exec(term.value),named=field&&entries.find(([key])=>key===field[1]);const value=named?field[2]:term.value,text=named?searchNormalize(named[1]):all,match=named&&['kind','type'].includes(field[1])?text.split(/\s+/).includes(value):text.includes(value);if(term.exclude?match:!match)return 0;if(!term.exclude){const title=searchNormalize(entries.find(([key])=>key==='title'||key==='name')?.[1]||'');score+=title===value?20:title.startsWith(value)?12:title.includes(value)?6:2;}}
    return score;
  }
  function bindSearchField(input){
    if(!input)return null;if(input.maxLength<0)input.maxLength=500;if(searchFields.has(input))return searchFields.get(input);
    let field=input.closest('.e-search-field,.e-search-panel,.fi-input-wrp'),wrapper=null;
    if(!field){wrapper=node('span','e-search-field e-search-inline');wrapper.innerHTML=icon('search');input.before(wrapper);wrapper.append(input);field=wrapper;input.classList.remove('e-search-input');}
    field.classList.add('e-search-field');
    const existing=field.querySelector('[data-e-search-clear],.e-search-clear');
    const clear=existing||node('button','e-search-clear'),original=existing?{markup:clear.innerHTML,cls:clear.className,label:clear.getAttribute('aria-label'),type:clear.getAttribute('type'),hidden:clear.hidden,disabled:clear.disabled}:null;
    clear.classList.add('e-search-clear');clear.type='button';clear.setAttribute('aria-label','清空搜索');clear.innerHTML=icon('close');if(!existing)input.after(clear);
    const sync=()=>{clear.hidden=!input.value;clear.disabled=input.disabled||input.readOnly;};
    const controller=new AbortController(),signal=controller.signal;
    input.addEventListener('input',sync,{signal});input.addEventListener('search',sync,{signal});input.addEventListener('change',sync,{signal});input.form?.addEventListener('reset',()=>queueMicrotask(sync),{signal});
    clear.addEventListener('click',()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));input.focus();sync();},{signal});sync();
    const binding={input,sync,dispose:()=>{controller.abort();if(original){clear.innerHTML=original.markup;clear.className=original.cls;for(const [key,value] of [['aria-label',original.label],['type',original.type]]){if(value===null)clear.removeAttribute(key);else clear.setAttribute(key,value)}clear.hidden=original.hidden;clear.disabled=original.disabled;}else clear.remove();if(wrapper){wrapper.before(input);wrapper.remove();}searchFields.delete(input);}};searchFields.set(input,binding);return binding;
  }
  function bindSearch({button,panel,input,breakpoint=860,closeOnSubmit=true,related=[],onClose}) {
    if(!button||!panel||!input)return;
    if(searchBindings.has(input))return searchBindings.get(input);
    const controller=new AbortController(),signal=controller.signal,query=matchMedia('(max-width: '+breakpoint+'px)');
    const host=panel.closest('header,.sw-top,.fi-topbar');if(!host)return;
    const marker=document.createComment('e-search-position');panel.before(marker);
    const bar=node('div','e-search-bar'),cancel=node('button','e-search-cancel','取消');cancel.type='button';cancel.setAttribute('aria-label','关闭搜索');bar.setAttribute('role','search');bar.hidden=true;bar.append(cancel);host.append(bar);host.classList.add('e-search-host');
    panel.classList.add('e-search-panel');alignTopbar(host,panel,input);button.classList.add('e-search-toggle');button.setAttribute('aria-controls',panel.id||=( 'e-search-'+crypto.randomUUID()));button.setAttribute('aria-expanded','false');
    const fieldBinding=bindSearchField(input);
    let opened=false,closeTimer=0;
    const finishClose=()=>{clearTimeout(closeTimer);closeTimer=0;if(opened)return;bar.hidden=true;marker.after(panel);panel.hidden=query.matches;panel.dataset.eSearchMobile=String(query.matches)};
    const close=(restore=false,immediate=false)=>{
      if(!opened){if(immediate)finishClose();return;}
      opened=false;host.removeAttribute('data-e-searching');bar.removeAttribute('data-e-search-open');button.setAttribute('aria-expanded','false');onClose?.();
      input.blur();clearTimeout(closeTimer);const duration=immediate?0:motionDuration('--e-ui-motion-exit');if(duration)closeTimer=setTimeout(finishClose,duration);else finishClose();
      if(restore)button.focus();
    };
    const open=()=>{if(!query.matches||opened)return;clearTimeout(closeTimer);closeTimer=0;dismissPopovers();opened=true;panel.hidden=false;bar.prepend(panel);bar.hidden=false;bar.dataset.eSearchOpen='true';host.dataset.eSearching='true';button.setAttribute('aria-expanded','true');input.focus();};
    button.addEventListener('click',()=>opened?close(true):open(),{signal});cancel.addEventListener('click',()=>close(true),{signal});
    input.addEventListener('keydown',e=>{if(opened&&!e.isComposing&&(e.key==='Escape'||closeOnSubmit&&e.key==='Enter')){e.preventDefault();e.stopPropagation();close(true)}},{signal});
    const outside=e=>{const path=e.composedPath();if(opened&&!path.includes(bar)&&!path.includes(button)&&!related.some(surface=>path.includes(surface)))close()};
    for(const event of ['pointerdown','scroll','wheel','touchmove'])document.addEventListener(event,outside,{capture:true,passive:true,signal});
    query.addEventListener('change',()=>close(false,true),{signal});finishClose();
    const binding={open,close:()=>close(),dispose:()=>{close(false,true);controller.abort();fieldBinding?.dispose();bar.remove();marker.remove();panel.hidden=false;delete panel.dataset.eSearchMobile;searchBindings.delete(input);}};searchBindings.set(input,binding);return binding;
  }
  // Keep form values/events native; own the visible surface and its lifecycle.
  const selectBindings=new WeakMap(),formScopes=new WeakMap();
  function bindSelect(select){
    if(!select||select.multiple||select.size>1||select.hasAttribute('data-e-native-select'))return null;
    if(selectBindings.has(select))return selectBindings.get(select);
    const controller=new AbortController(),signal=controller.signal,wrapper=node('div','e-select'),button=node('button','e-select-trigger'),label=node('span'),panel=node('div','e-menu e-select-menu');
    button.type='button';button.append(label);button.insertAdjacentHTML('beforeend','<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>');
    const accessible=()=>select.getAttribute('aria-label')||[...select.labels||[]].map(l=>[...l.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join('')).join(' ').trim()||select.name||'选择';
    panel.setAttribute('role','listbox');select.before(wrapper);wrapper.append(select,button);
    // A modal's popover must remain in its active subtree, including Shadow DOM.
    (select.closest('.e-menu')||select.closest('dialog')||select.getRootNode().host&&select.getRootNode()||document.body).append(panel);
    let disposed=false;
    const sync=()=>{if(disposed)return;label.textContent=select.selectedOptions[0]?.textContent||'';button.setAttribute('aria-label',accessible()+'：'+label.textContent);panel.setAttribute('aria-label',accessible());button.disabled=select.disabled;wrapper.hidden=select.hidden;
      panel.replaceChildren();for(const option of select.options){if(option.hidden)continue;const item=node('button','e-select-option',option.textContent);item.type='button';item.disabled=option.disabled||option.parentElement?.disabled===true;item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));if(option.selected)item.insertAdjacentHTML('beforeend',icon('check'));item.onclick=()=>{select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true,composed:true}));select.dispatchEvent(new Event('change',{bubbles:true}));sync()};panel.append(item)}};
    const pop=bindPopover(button,panel,{position:{align:'start',minWidth:180,matchWidth:true},onOpen:sync});
    select.addEventListener('change',sync,{signal});
    select.form?.addEventListener('reset',()=>queueMicrotask(sync),{signal});
    document.addEventListener('pointerdown',event=>{if(!event.composedPath().includes(button)&&!event.composedPath().includes(panel))button.blur()},{capture:true,signal});
    const observer=new MutationObserver(sync);observer.observe(select,{attributes:true,childList:true,subtree:true,characterData:true});
    const binding={select,sync,dispose:()=>{if(disposed)return;disposed=true;observer.disconnect();pop.dispose();controller.abort();wrapper.before(select);wrapper.remove();panel.remove();selectBindings.delete(select)}};
    button.setAttribute('aria-haspopup','listbox');selectBindings.set(select,binding);sync();return binding;
  }
  function bindForms(scope=document){
    if(formScopes.has(scope))return formScopes.get(scope);
    const bindings=new Set();
    const enhance=branch=>{if(branch.nodeType!==Node.ELEMENT_NODE&&branch!==scope)return;const selects=[...(branch.matches?.('select')?[branch]:[]),...branch.querySelectorAll('select')];for(const select of selects){const binding=bindSelect(select);if(binding)bindings.add(binding)}
      for(const details of [...(branch.matches?.('details')?[branch]:[]),...branch.querySelectorAll('details')])details.classList.add('e-disclosure');
      for(const input of [...(branch.matches?.('input[type="search"]')?[branch]:[]),...branch.querySelectorAll('input[type="search"]')]){
        const parent=input.closest('.fi-input-wrp')||input.parentElement;if(parent&&parent.querySelectorAll('input').length===1&&parent.matches('search,form[role="search"],.search,.sw-search,.cg-search,.fi-input-wrp'))parent.classList.add('e-search-field');
        const binding=bindSearchField(input);if(binding)bindings.add(binding);
      }
    };
    const observer=new MutationObserver(records=>{for(const record of records)for(const added of record.addedNodes)enhance(added);for(const binding of bindings)if(!scope.contains(binding.select||binding.input)){binding.dispose();bindings.delete(binding)}});
    enhance(scope);observer.observe(scope,{childList:true,subtree:true});
    const binding={dispose:()=>{observer.disconnect();for(const item of bindings)item.dispose();bindings.clear();formScopes.delete(scope)}};formScopes.set(scope,binding);return binding;
  }
  let appearanceTransition=null,appearanceIntent=null,appearanceTicket=0;
  function animateAppearance(value){
    const ticket=++appearanceTicket;
    const commit=()=>{if(ticket===appearanceTicket)applyAppearance(value,true)};
    appearanceIntent=value;
    appearanceTransition?.skipTransition();
    const nextDark=value==='dark'||value==='auto'&&media.matches;
    if(nextDark===(root.dataset.theme==='dark')){commit();appearanceIntent=null;return;}
    root.dataset.eAppearanceChanging='true';
    if(!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches){
      commit();appearanceIntent=null;delete root.dataset.eAppearanceChanging;return;
    }
    const transition=document.startViewTransition(commit);appearanceTransition=transition;
    transition.finished.catch(()=>{}).finally(()=>{if(appearanceTransition===transition){appearanceTransition=null;appearanceIntent=null;delete root.dataset.eAppearanceChanging}});
  }
  function bindAppearanceButton(button){
    const controller=new AbortController(),signal=controller.signal;
    const sync=()=>{const symbol=button.querySelector('.e-theme-symbol');if(symbol)symbol.innerHTML=icon(appearance==='auto'?'automatic':appearance==='dark'?'theme':'sun');const label={auto:'自动',light:'浅色',dark:'深色'}[appearance];button.title='外观：'+label+'；点击切换';button.setAttribute('aria-label','外观');button.dataset.eAppearanceMode=appearance;button.setAttribute('aria-description','当前'+label+'。点击依次切换浅色、深色、自动。');};
    button.classList.add('e-theme-toggle');button.innerHTML='<span class="e-theme-symbol">'+icon('theme')+'</span>';
    button.addEventListener('click',()=>animateAppearance(({light:'dark',dark:'auto',auto:'light'})[appearanceIntent||appearance]),{signal});
    window.addEventListener('eona:appearance',sync,{signal});sync();
    return {dispose:()=>controller.abort()};
  }
  /* Standalone application identities come only from caller options. */
  const applicationLinks=[];
  const applicationIconData={};
  const applicationIcon=(id,key='apps')=>{const entry=document.querySelector('script[src^="/_brand/"][src$="/brand.js"]')?.getAttribute('src');const src=entry?entry.slice(0,entry.lastIndexOf('/')+1)+id+'/icon.svg':applicationIconData[id];return src?'<img class="e-app-icon" width="32" height="32" alt="" src="'+src+'">':icon(key)};
  const applicationForUrl=raw=>{try{const url=new URL(raw,location.href);return applicationLinks.find(row=>new URL(row[1]).origin===url.origin)}catch{return undefined}};
  function mountTools(mount, options={}) {
    const tools=node('div','e-tools');
    const links=options.applications===undefined?applicationLinks:options.applications;
    if(!Array.isArray(links)||links.some(row=>!Array.isArray(row)||row.length<2||typeof row[0]!=='string'||typeof row[1]!=='string'||!/^https?:/.test(new URL(row[1],location.href).protocol)))throw Error('invalid_application_links');
    const apps=node('button','e-tool');apps.type='button';apps.title='切换应用';apps.setAttribute('aria-label','应用');apps.innerHTML=icon('apps');tools.append(apps);
    const appMenu=node('div','e-menu e-app-menu');appMenu.append(node('div','e-menu-head','应用'));
    const appGrid=node('div','e-app-grid');for(const [label,href,key,id] of links){const link=node('a',null);link.href=href;link.innerHTML=applicationIcon(id||'mail',key);link.append(node('span',null,label));if(new URL(href,location.href).hostname===location.hostname)link.setAttribute('aria-current','page');appGrid.append(link)}appMenu.append(appGrid);document.body.append(appMenu);const appsPop=bindPopover(apps,appMenu);if(links.length<2)apps.remove();
    const theme=node('button','e-tool');theme.type='button';tools.append(theme);const themeControl=bindAppearanceButton(theme);
    // Native clients retain their own authenticated account switcher.
    if(options.account===false) {
      mount.append(tools);
      return {setIdentity:()=>{},dispose:()=>{themeControl.dispose();appsPop.dispose();appMenu.remove();tools.remove()},tools};
    }
    const avatar=node('button','e-tool e-account-button');avatar.innerHTML='<span class="e-account-symbol">'+icon('user')+'<span class="e-account-presence" aria-hidden="true"></span></span><span class="e-account-label"></span>';avatar.type='button';avatar.title='账号';avatar.setAttribute('aria-label','账号');
    const menu=node('div','e-menu e-account-menu'),head=node('div','e-menu-head e-account-identity');head.textContent='账号';menu.append(head);
    if(options.accountUrl){const account=node('a',null);account.innerHTML=icon('shield');account.append(node('span',null,'账号与安全'));account.href=options.accountUrl;menu.append(account);}
    for(const action of [ ...(options.settings?[{label:'设置',icon:'settings',...options.settings}]:[]),...(options.actions||[])]) {const a=node(action.href?'a':'button',null,action.label);if(action.href)a.href=action.href;else{a.type='button';a.onclick=async()=>{a.disabled=true;try{await action.run()}catch(error){toast(error.message||'操作未完成，请重试')}finally{a.disabled=false}}}const symbol=action.icon||(/退出/.test(action.label)?'logout':null);if(symbol)a.insertAdjacentHTML('afterbegin',icon(symbol));if(action.danger)a.dataset.danger='';menu.append(a)}
    tools.append(avatar);document.body.append(menu);const accountPop=bindPopover(avatar,menu);mount.append(tools);
    const setIdentity=value=>{const email=typeof value==='string'?value:value?.email||'';head.textContent=email||'账号';avatar.title=email?'账号：'+email:'账号';avatar.dataset.eAuthenticated=String(!!email);avatar.querySelector('.e-account-label').textContent=email;avatar.setAttribute('aria-label',email?'账号：'+email:'账号')};
    setIdentity(options.identity);
    return {setIdentity,dispose:()=>{themeControl.dispose();appsPop.dispose();appMenu.remove();accountPop.dispose();menu.remove();tools.remove()},tools};
  }
  function mountNotifications(mount, options={}) {
    const button=node('button','e-tool e-notice-trigger');button.type='button';button.innerHTML=icon('bell');button.setAttribute('aria-label',options.title||'通知中心');
    const count=node('span','e-notice-count','');count.setAttribute('aria-live','polite');button.append(count);
    const panel=node('div','e-menu e-notice-menu'),head=node('div','e-notice-header');head.append(node('strong',null,options.title||'通知中心'));
    const refresh=node('button','e-notice-refresh','刷新');refresh.type='button';head.append(refresh);panel.append(head);
    const list=node('div','e-notice-list');panel.append(list);
    if(options.href){const link=node('a','e-notice-footer','查看全部');link.href=options.href;panel.append(link)}
    document.body.append(panel);mount.append(button);list.append(node('div','e-notice-empty','正在读取通知…'));let running=false,disposed=false;
    const update=async()=>{if(running||disposed)return;running=true;refresh.disabled=true;try{const value=await options.load();if(disposed)return;const items=value.items||[];count.textContent=String(value.count??items.length);button.dataset.eNoticeCount=String(value.count??items.length);list.replaceChildren();for(const item of items){const row=node(item.href?'a':'div','e-notice-row');if(item.href)row.href=item.href;row.append(node('strong',null,item.title||''));if(options.onSelect){row.addEventListener('click',()=>{options.onSelect(item);pop.close()})}if(item.description)row.append(node('span',null,item.description));if(item.time){const time=node('time',null,item.time);row.append(time)}list.append(row)}if(!items.length)list.append(node('div','e-notice-empty','暂无通知'));}catch(error){if(!disposed){list.replaceChildren(node('div','e-notice-error',error.message||'通知暂时无法读取'));}}finally{running=false;refresh.disabled=false}};
    refresh.onclick=update;const pop=bindPopover(button,panel,{onOpen:update,closeOnSelect:false});update();const timer=setInterval(()=>{if(!document.hidden)update()},60000);
    return {refresh:update,dispose:()=>{disposed=true;clearInterval(timer);pop.dispose();panel.remove();button.remove()}};
  }
  function bindDrawer({button,panel,overlay,breakpoint=860,openClass='open',overlayClass='show',bodyClass,onChange}) {
    if(!button||!panel)return;
    const query=matchMedia('(max-width: '+breakpoint+'px)'),controller=new AbortController(); let opened=false;
    panel.classList.add('e-navigation');overlay?.classList.add('e-navigation-overlay');
    panel.id ||= 'e-navigation';button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','打开导航');
    function setOpen(value,restore=false) {opened=Boolean(value)&&query.matches;panel.dataset.eDrawerMobile=String(query.matches);panel.dataset.eDrawerOpen=String(opened);if(overlay){overlay.dataset.eDrawerMobile=String(query.matches);overlay.dataset.eDrawerOpen=String(opened)}panel.classList.toggle(openClass,opened);overlay?.classList.toggle(overlayClass,opened);document.body.classList.toggle('e-drawer-open',opened);if(bodyClass)document.body.classList.toggle(bodyClass,opened);button.setAttribute('aria-expanded',String(opened));panel.inert=query.matches&&!opened;if(query.matches)panel.setAttribute('aria-hidden',String(!opened));else panel.removeAttribute('aria-hidden');onChange?.(opened);if(restore)button.focus();}
    button.addEventListener('click',()=>setOpen(!opened),{signal:controller.signal});overlay?.addEventListener('click',()=>setOpen(false,true),{signal:controller.signal});
    panel.addEventListener('click',e=>{if(e.target.closest('a[href]'))setTimeout(()=>setOpen(false),0)},{signal:controller.signal});
    document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape')setOpen(false,true);if(opened&&e.key==='Tab'){const items=[...panel.querySelectorAll('a[href],button:not(:disabled),input,select')].filter(n=>n.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();button.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();button.focus()}else if(document.activeElement===button){e.preventDefault();(e.shiftKey?last:first)?.focus()}}},{signal:controller.signal});
    query.addEventListener('change',()=>setOpen(false),{signal:controller.signal});setOpen(false);
    return {close:()=>setOpen(false),open:()=>setOpen(true),dispose:()=>{setOpen(false);controller.abort()}};
  }
  let toastTimer,toastEpoch=0,toastRegion,toastStack,toastHover=false,toastWasExpanded=false;
  const toastTouches=new Set();
  const toastCards=[];
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
  const toastHeld=()=>toastHover||toastTouches.size>0||toastRegion?.contains(document.activeElement)||document.hidden;
  function layoutToasts(){
    if(!toastRegion)return;const expanded=!!toastHeld();toastRegion.dataset.expanded=String(expanded);let offset=0;
    for(const [index,entry] of toastCards.entries()){
      const slot=entry.slot,card=entry.node;slot.style.zIndex=String(10-index);
      slot.style.transform='translateY(-'+(expanded?offset:index*10)+'px) scale('+(expanded?1:1-index*.04)+')';
      slot.style.opacity=expanded||index<3?'1':'0';slot.dataset.front=String(index===0);
      card.inert=!expanded&&index>0;card.style.pointerEvents=expanded||index===0?'auto':'none';
      offset+=(card.offsetHeight||76)+10;
    }
    const collapsed=(toastCards[0]?.node.offsetHeight||76)+Math.min(2,Math.max(0,toastCards.length-1))*10;
    const total=expanded?Math.max(0,offset-10):collapsed,available=Math.max(160,innerHeight-48);
    toastStack.style.height=total+'px';toastRegion.style.height=Math.min(total,available)+'px';
    toastRegion.style.overflowY=expanded&&total>available?'auto':'visible';toastRegion.hidden=!toastCards.length;
    if(expanded&&!toastWasExpanded)toastRegion.scrollTop=Math.max(0,total-available);toastWasExpanded=expanded;
  }
  function toastCard(message,options){
    if(!toastRegion){toastRegion=node('section','e-toast-region');toastRegion.setAttribute('aria-label','操作通知');toastRegion.tabIndex=-1;
      toastStack=node('div','e-toast-stack');toastRegion.append(toastStack);document.body.append(toastRegion);
      const pause=()=>{for(const entry of toastCards)entry.pause();layoutToasts()};
      const resume=()=>{layoutToasts();if(!toastHeld())for(const entry of toastCards)entry.schedule()};
      toastRegion.onpointerenter=event=>{if(event.pointerType!=='touch'){toastHover=true;pause()}};
      toastRegion.onpointerleave=()=>{toastHover=false;resume()};toastRegion.onfocusin=pause;toastRegion.onfocusout=()=>queueMicrotask(resume);
      toastRegion.onpointerdown=event=>{if(event.pointerType==='touch'){toastTouches.add(event.pointerId);pause()}};
      const releaseTouch=event=>{if(toastTouches.delete(event.pointerId))resume()};window.addEventListener('pointerup',releaseTouch);window.addEventListener('pointercancel',releaseTouch);
      window.addEventListener('resize',layoutToasts);document.addEventListener('visibilitychange',()=>document.hidden?pause():resume());
      document.addEventListener('keydown',event=>{if(event.altKey&&event.key.toLowerCase()==='t'&&toastCards.length){event.preventDefault();toastCards[0].node.querySelector('button')?.focus()}});
    }
    const key=options.id||String(options.tone||'info')+':'+message;
    let entry=toastCards.find(e=>e.key===key&&(!e.closing||options.id)),fresh=!entry;
    if(!entry){const slot=node('div','e-toast-slot'),card=node('div','e-toast');slot.append(card);entry={key,node:card,slot,revision:0};toastCards.unshift(entry);toastStack.append(slot);if(typeof ResizeObserver==='function'){entry.observer=new ResizeObserver(layoutToasts);entry.observer.observe(card)}}
    if(entry.closing){entry.motion?.cancel();entry.motion=null;entry.closing=false}
    toastRegion.hidden=false;
    const n=entry.node,revision=++entry.revision,duration=options.duration??(options.action?8000:4500);
    clearTimeout(entry.timer);clearTimeout(entry.tick);entry.remaining=duration;entry.deadline=0;n.replaceChildren();n.dataset.variant='card';n.dataset.tone=options.tone||'info';n.setAttribute('role',options.tone==='error'?'alert':'status');n.setAttribute('aria-atomic','true');
    let lifetime=null,progress=null;
    const paintTime=()=>{if(!lifetime)return;const remaining=entry.deadline?Math.max(0,entry.deadline-Date.now()):entry.remaining,seconds=Math.ceil(remaining/1000);n.dataset.remainingSeconds=String(seconds);n.dataset.timerPaused=String(!entry.deadline);lifetime.textContent=entry.deadline?seconds+' 秒后收起':'已暂停 · '+seconds+' 秒';progress.style.transform='scaleX('+Math.max(0,remaining/duration)+')';clearTimeout(entry.tick);if(entry.deadline&&remaining>0)entry.tick=setTimeout(paintTime,Math.min(250,remaining))};
    const remove=()=>{if(entry.revision!==revision)return;const index=toastCards.indexOf(entry);if(index<0)return;clearTimeout(entry.timer);clearTimeout(entry.tick);entry.observer?.disconnect();toastCards.splice(index,1);entry.slot.remove();if(!toastCards.length){toastHover=false;toastTouches.clear()}layoutToasts()};
    const dismiss=()=>{if(entry.revision!==revision||entry.closing)return;entry.closing=true;clearTimeout(entry.timer);clearTimeout(entry.tick);const from=getComputedStyle(n);const initial={opacity:from.opacity,transform:from.transform};entry.motion?.cancel();if(n.animate&&!reducedMotion()){entry.motion=n.animate([initial,{opacity:0,transform:'translateY(16px) scale(.98)'}],{duration:160,easing:'cubic-bezier(.4,0,1,1)'});entry.motion.onfinish=remove}else remove()};
    entry.pause=()=>{clearTimeout(entry.timer);clearTimeout(entry.tick);if(entry.deadline){entry.remaining=Math.max(1,entry.deadline-Date.now());entry.deadline=0}paintTime()};
    entry.schedule=()=>{clearTimeout(entry.timer);clearTimeout(entry.tick);if(duration>0&&!entry.acting&&!toastHeld()){entry.deadline=Date.now()+entry.remaining;entry.timer=setTimeout(dismiss,entry.remaining)}paintTime()};
    const symbol=node('span','e-toast-symbol');symbol.setAttribute('aria-hidden','true');symbol.innerHTML=icon(options.tone==='error'?'close':options.tone==='success'?'check':'bell');
    const copy=node('div','e-toast-copy');copy.append(node('span','e-toast-message',message));if(options.description)copy.append(node('span','e-toast-description',options.description));n.append(symbol,copy);
    delete n.dataset.remainingSeconds;delete n.dataset.timerPaused;n.dataset.countdown=String(!!options.countdown&&duration>0);if(options.countdown&&duration>0){lifetime=node('span','e-toast-lifetime');lifetime.setAttribute('aria-hidden','true');copy.append(lifetime);const track=node('span','e-toast-time-track');track.setAttribute('aria-hidden','true');progress=node('span','e-toast-time-progress');track.append(progress);n.append(track)}
    if(options.action?.label&&typeof options.action.run==='function'){const action=node('button','e-toast-action',options.action.label);action.type='button';action.onclick=async()=>{if(entry.acting)return;entry.acting=true;action.disabled=true;entry.pause();try{const result=await options.action.run();if(result!==false)dismiss();else action.disabled=false}catch(error){toast(error.message||'操作未完成，请重试',{variant:'card',tone:'error'});action.disabled=false}finally{entry.acting=false;entry.schedule()}};n.append(action)}
    const close=node('button','e-toast-close');close.type='button';close.setAttribute('aria-label','关闭提示');close.innerHTML=icon('close');close.onclick=dismiss;n.append(close);n.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();dismiss()}};
    let swipe=null;n.onpointerdown=e=>{if(e.pointerType==='touch'&&!e.target.closest('button'))swipe={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0}};
    n.onpointermove=e=>{if(!swipe||e.pointerId!==swipe.id)return;const dx=e.clientX-swipe.x;if(Math.abs(e.clientY-swipe.y)>Math.abs(dx)+8){swipe=null;return}if(Math.abs(dx)>8){swipe.dx=dx;n.style.transform='translateX('+dx+'px)';entry.pause()}};
    const release=e=>{if(!swipe||e.pointerId!==swipe.id)return;const dx=swipe.dx;swipe=null;n.style.transform='';if(Math.abs(dx)>80)dismiss();else entry.schedule()};n.onpointerup=release;n.onpointercancel=()=>{swipe=null;n.style.transform='';entry.schedule()};
    while(toastCards.length>5){const old=toastCards.pop();clearTimeout(old.timer);clearTimeout(old.tick);old.motion?.cancel();old.observer?.disconnect();old.slot.remove()}
    layoutToasts();if(fresh&&n.animate&&!reducedMotion()){entry.motion=n.animate([{opacity:0,transform:'translateY(28px) scale(.96)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:360,easing:'cubic-bezier(.16,1,.3,1)'});entry.motion.onfinish=()=>{entry.motion=null}}entry.schedule();return {dismiss};
  }
  function toast(message,options={}) {
    if(options.variant==='card')return toastCard(message,options);
    let n=document.querySelector('.e-toast[data-variant="plain"]');if(!n){n=node('div','e-toast');n.dataset.variant='plain';n.setAttribute('role','status');n.setAttribute('aria-live','polite');n.setAttribute('aria-atomic','true');document.body.append(n)}
    const epoch=++toastEpoch;clearTimeout(toastTimer);n.replaceChildren(node('span','e-toast-message',message));n.hidden=false;
    const dismiss=()=>{if(epoch===toastEpoch){clearTimeout(toastTimer);n.hidden=true}};const schedule=()=>{clearTimeout(toastTimer);if(options.duration!==0)toastTimer=setTimeout(dismiss,options.duration??2800)};
    n.onpointerenter=()=>clearTimeout(toastTimer);n.onpointerleave=schedule;n.onfocusin=n.onpointerenter;n.onfocusout=schedule;schedule();return {dismiss};
  }
  const contentMotions=new WeakMap();
  function transitionContent(surface,key){if(!surface||surface.dataset.eViewKey===key)return;surface.dataset.eViewKey=key;contentMotions.get(surface)?.cancel();if(matchMedia('(prefers-reduced-motion: reduce)').matches||!surface.animate)return;contentMotions.set(surface,surface.animate([{opacity:.65},{opacity:1}],{duration:motionDuration('--e-ui-motion-page'),easing:'ease-out'}))}
  const dialogTimers=new WeakMap();
  function openDialog(dialog){clearTimeout(dialogTimers.get(dialog));dialogTimers.delete(dialog);delete dialog.dataset.eClosing;dialog.classList.add('e-modal');dialog.hidden=false;if(!dialog.open)dialog.showModal()}
  function closeDialog(dialog){clearTimeout(dialogTimers.get(dialog));if(!dialog.open)return;dialog.dataset.eClosing='true';const finish=()=>{dialogTimers.delete(dialog);dialog.close();dialog.hidden=true;delete dialog.dataset.eClosing};const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:motionDuration('--e-ui-motion-exit');if(duration)dialogTimers.set(dialog,setTimeout(finish,duration));else finish()}
  async function confirmAction({title,description,action='确认',danger=false}) {
    const dialog=node('dialog','e-dialog'),heading=node('h2',null,title),body=node('p',null,description),actions=node('div','e-dialog-actions'),cancel=node('button','e-button','取消'),accept=node('button','e-button',action);
    heading.id='e-confirm-'+crypto.randomUUID();dialog.setAttribute('aria-labelledby',heading.id);cancel.type=accept.type='button';if(danger)accept.dataset.danger='';actions.append(cancel,accept);dialog.append(heading,body,actions);document.body.append(dialog);
    return new Promise(resolve=>{let settled=false;const finish=ok=>{if(settled)return;settled=true;closeDialog(dialog);setTimeout(()=>dialog.remove(),motionDuration('--e-ui-motion-exit')+30);resolve(ok)};cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false)};openDialog(dialog);cancel.focus()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>bindForms(document),{once:true});else bindForms(document);
  window.EonaUI={profile:'standalone-v1',version:'1.14.9',loginUrl,startLogin,alignTopbar,mountTools,mountNotifications,bindDrawer,bindPopover,bindSearch,bindSearchField,searchTerms,searchNormalize,searchRank,bindSelect,bindForms,transitionContent,openDialog,closeDialog,positionPopover,dismissPopovers,toast,confirm:confirmAction,setAppearance:value=>applyAppearance(value,true),getAppearance:()=>appearance,icon,applicationIcon,applicationForUrl};
})();
