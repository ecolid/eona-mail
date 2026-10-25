export function mailSourceHealthMarkup(value){
 const labels={connected:'已联通',error:'检查失败',stale:'待重新检查',complete:'已覆盖',incomplete:'有缺口'};
 const time=value=>value?new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'尚未检查';
 const accounts=value?.accounts||[];
 return accounts.length?accounts.map(a=>{const missing=a.folders.reduce((sum,f)=>sum+(f.missing_count||0),0);return '<details class="e-disclosure mail-source-account" data-source-account="'+esc(a.id)+'"><summary><span class="mail-source-identity">'+esc(a.address)+'<small>'+esc(time(a.checked_at))+'</small></span><span class="mail-source-state" data-state="'+esc(a.coverage)+'">'+(a.connection==='connected'?'<span>已联通</span>':'')+'<strong>'+esc(a.connection==='error'?'连接失败':a.connection==='stale'?'检查已过期':a.coverage==='incomplete'?'缺 '+missing+' 封':labels[a.coverage]||'待检查')+'</strong></span>'+I.caret+'</summary><div class="mail-source-folders"><p>'+(a.discovery==='all'?'全部可读取目录':'已配置目录')+'</p>'+a.folders.map(f=>'<div class="mail-source-folder"><span>'+esc(f.name)+'</span><span>'+esc(f.state==='error'?'读取失败':f.state==='stale'?'待检查':f.remote_count===null?'历史缺 '+f.missing_count+' 封':f.archived_count+' / '+f.remote_count+' 封')+'</span></div>').join('')+'</div></details>'}).join(''):'<p class="mail-source-empty">尚未接入收信来源</p>';
}
export function mountMailSourceHealth(panel){
 panel.innerHTML='<div class="mail-settings-section-head"><h2>来源检查</h2><button type="button" class="e-button" data-refresh-source>刷新状态</button></div><p role="status" class="mail-source-load">正在读取…</p><div data-source-health></div>';
 const output=panel.querySelector('[data-source-health]'),status=panel.querySelector('[role=status]'),button=panel.querySelector('button');let pending=false,timer;
 const load=async()=>{if(pending||!panel.isConnected)return;pending=true;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='正在刷新';status.textContent=output.children.length?'':'正在读取…';
  try{const value=await api('/api/mail-workspace/source-health',{fresh:true});if(!panel.isConnected)return;const opened=new Set([...output.querySelectorAll('details[open]')].map(d=>d.dataset.sourceAccount));output.innerHTML=mailSourceHealthMarkup(value);for(const d of output.querySelectorAll('details'))if(opened.has(d.dataset.sourceAccount))d.open=true;status.textContent='';}
  catch{if(panel.isConnected)status.textContent='状态暂时无法读取，请重试。';}
  finally{pending=false;button.disabled=false;button.removeAttribute('aria-busy');button.textContent='刷新状态';clearTimeout(timer);if(panel.isConnected)timer=setTimeout(()=>{if(panel.hidden)return;load()},60000);}
 };button.onclick=load;load();return load;
}
export function mailSourceHealthBrowserScript(){return mailSourceHealthMarkup.toString()+';'+mountMailSourceHealth.toString()+';';}
