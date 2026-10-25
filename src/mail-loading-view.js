// Pending content uses the destination's own layout classes and scroll owner.
export function mailLoadingMarkup(kind='messages',title='邮件',readerHeader='') {
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const line=(name='')=>'<span class="mail-placeholder-line '+name+'"></span>';
 const status='<span class="mail-sr-only" role="status">正在读取'+esc(title)+'</span>';
 const heading='<div class="mail-workspace-title"><h1>'+esc(title)+'</h1><span>'+line('mail-placeholder-count')+'</span></div>';
 const preview='<span class="mail-placeholder-preview">'+line()+line('mail-placeholder-medium')+'</span>';
 let content;
 if(kind==='settings'){
  const tabs=['常规','邮箱账户','侧栏与布局'].map((label,i)=>'<button type="button" role="tab" aria-selected="'+!i+'" tabindex="-1">'+label+'</button>').join('');
  const fields=['邮件密度','常用邮箱数量','默认发件账号','默认发件名称'].map(label=>'<label>'+label+'<span class="mail-placeholder-field"></span></label>').join('');
  content='<section class="mail-settings-page"><header><h1>'+esc(title)+'</h1></header><nav class="mail-settings-tabs mail-segments">'+tabs+'</nav><div class="mail-settings-pending-form"><section class="mail-settings-panel"><h2>阅读与发信</h2><div class="mail-settings-general">'+fields+'</div></section><footer class="mail-settings-savebar"><span></span><span class="mail-placeholder-field mail-placeholder-action"></span><span class="mail-placeholder-field mail-placeholder-action"></span></footer></div></section>';
 }else if(kind==='reader'){
  const back='<button id="back" class="btn mail-pending-back" type="button" data-mail-pending-back aria-label="返回邮件列表"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg>返回</button>';
  content='<div class="mail-reader-content" aria-busy="true">'+(readerHeader||'<header id="vhead"><div id="vbar" class="mail-reader-commandbar">'+back+line('mail-placeholder-short')+'</div><h2 class="e-reader-heading mail-placeholder-text">'+line('mail-placeholder-title')+'</h2><dl class="mail-envelope">'+['发件人','收件人'].map(label=>'<div><dt>'+label+'</dt><dd class="mail-placeholder-text">'+line('mail-placeholder-medium')+'</dd></div>').join('')+'</dl></header>')+'<section class="mail-document"><div class="mail-placeholder-reading">'+preview+preview+preview+'</div></section></div>';
 }else if(kind==='correspondence'){
  content='<header class="mail-correspondence-heading"><h2>'+esc(title)+'</h2><span>'+line('mail-placeholder-count')+'</span></header>'+Array.from({length:3},()=>'<div class="mail-directory-message"><span><strong class="mail-placeholder-text">'+line('mail-placeholder-medium')+'</strong><small class="mail-placeholder-text">'+line('mail-placeholder-short')+'</small><span>'+preview+'</span></span><time>'+line('mail-placeholder-date')+'</time></div>').join('');
 }else if(kind==='contacts'){
  content='<section class="mail-workspace-content">'+heading+Array.from({length:6},()=>'<div class="mail mail-directory-row"><span class="mail-workspace-avatar mail-placeholder-avatar"></span><span class="mail-directory-copy"><span class="mail-directory-line"><strong class="mail-placeholder-text">'+line('mail-placeholder-short')+'</strong></span><span class="mail-directory-address mail-placeholder-text">'+line('mail-placeholder-medium')+'</span></span></div>').join('')+'</section>';
 }else{
  content=heading+Array.from({length:6},()=>'<article class="mail"><div class="av mail-placeholder-avatar"></div><div class="mail-row-content"><div class="mail-row-head"><div class="from mail-placeholder-text">'+line('mail-placeholder-short')+'</div><time class="time">'+line('mail-placeholder-date')+'</time></div><div class="subj mail-placeholder-text">'+line()+'</div><div class="sum">'+preview+'</div></div></article>').join('');
 }
 return '<div class="mail-page-skeleton" data-kind="'+esc(kind)+'">'+status+'<div class="mail-pending-content"'+(kind==='reader'?'':' aria-hidden="true"')+'>'+content+'</div></div>';
}
export const MAIL_LOADING_CSS=`
.mail-sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.mail-page-skeleton{width:100%;color:var(--sub);pointer-events:none}
.mail-page-skeleton[data-kind=settings],.mail-page-skeleton[data-kind=settings]>.mail-pending-content{height:100%}
.mail-settings-pending-form{flex:1;min-height:0;overflow:auto;overflow-anchor:none}
.mail-page-skeleton :is(.mail-pending-back,#back){pointer-events:auto}
.mail-placeholder-line{display:block;width:100%;max-width:440px;height:10px;border-radius:4px;background:var(--e-ui-soft)}
.mail-placeholder-text{min-height:1lh;display:flex;align-items:center}
.mail-placeholder-short{width:46%}.mail-placeholder-medium{width:72%}.mail-placeholder-count{width:32px}.mail-placeholder-date{width:42px}
.mail-placeholder-avatar{background:var(--e-ui-soft)}
.mail-placeholder-preview{display:flex;flex-direction:column;justify-content:space-around;min-height:36px;width:100%}
.mail-placeholder-field{display:block;height:var(--mail-field,36px);border-radius:var(--mail-radius,7px);background:var(--e-ui-soft)}
.mail-placeholder-action{width:76px;height:var(--mail-control,34px)}
.mail-page-skeleton .mail-directory-copy strong{width:100%}
.mail-placeholder-reading{padding-top:24px}.mail-placeholder-reading>.mail-placeholder-preview{margin-bottom:18px}
.mail-page-skeleton .mail-reader-commandbar>.mail-placeholder-line{margin-right:auto}
.mail-page-skeleton .mail-envelope dd{min-width:180px}
.mail-placeholder-title{height:18px;width:80%}
.mail-page-skeleton .mail-directory-message>span>span{display:block}
.mail-placeholder-avatar,.mail-placeholder-line,.mail-placeholder-field{animation:mail-placeholder-breathe 1.5s ease-in-out infinite}
.mail-loading-spinner{width:14px;height:14px;border:1.5px solid var(--e-ui-line);border-top-color:var(--e-ui-muted);border-radius:50%;animation:mail-loading-turn .8s linear infinite}
@keyframes mail-loading-turn{to{transform:rotate(360deg)}}@keyframes mail-placeholder-breathe{50%{opacity:.4}}
@media(prefers-reduced-motion:reduce){.mail-placeholder-avatar,.mail-placeholder-line,.mail-placeholder-field,.mail-loading-spinner{animation:none}}
@media(max-width:860px){.mail-placeholder-field{height:44px}.mail-placeholder-action{height:var(--mail-control,44px)}}
`;
