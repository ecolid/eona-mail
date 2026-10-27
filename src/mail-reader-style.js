import {MAIL_WORKSPACE_CSS} from './mail-workspace-style.js';
// The reader owns its envelope, command group, summary and original document.
export const MAIL_READER_CSS = `
#view{background:var(--card);scroll-padding-top:16px;scrollbar-gutter:stable;overflow-anchor:none}
.mail-reader-content{flex:none;box-sizing:border-box;width:100%;max-width:1048px;margin:0 auto;padding:24px 28px 40px;overflow-anchor:none}
#vhead{display:block;background:transparent;width:100%;max-width:none;margin:0;padding:0 0 20px;border:0}
#vhead h2{font-size:22px;font-weight:650;line-height:1.4;letter-spacing:-.02em;text-wrap:pretty;margin:0 0 16px;overflow-wrap:anywhere}
#vbar.mail-reader-commandbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;position:static;min-height:36px;padding:0;margin:0 0 12px;background:transparent;border:0;z-index:auto}
#vbar .mail-detail-time{font-size:12px;color:var(--sub);font-variant-numeric:tabular-nums;margin:0 auto 0 0}
#vbar .btn{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:5px 9px;font-size:12px;font-weight:450;line-height:1.5;border:0;border-radius:6px;background:transparent;box-shadow:none;color:var(--sub);white-space:nowrap}
#vbar .btn svg{width:16px;height:16px}
#vbar .btn:hover{background:var(--line);color:var(--ink)}
#vbar .btn.warn:hover{background:var(--needbg);color:var(--needink)}
#vbar .btn:focus-visible,.mail-address:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:2px}
#vbar #back{display:none}
#vbar .mail-more{margin-left:0}
#vbar .mail-actions.e-menu{display:none;position:fixed;width:224px;max-width:calc(100vw - 24px);margin:0;padding:6px;border:1px solid var(--line);border-radius:10px;background:var(--card);box-shadow:0 8px 24px rgb(0 0 0/.1);font:inherit}
#vbar .mail-actions.e-menu:popover-open{display:block}
#vbar .mail-actions.e-menu .btn{display:flex;width:100%;justify-content:flex-start;min-height:36px;padding:8px 10px;font-size:13px}
.mail-envelope{display:grid;gap:6px;margin:0;font-size:13px;line-height:1.65}
.mail-envelope>div{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:baseline;gap:8px}
.mail-envelope dt{color:var(--sub);font-size:12px;font-weight:400}
.mail-envelope dd{display:flex;flex-wrap:wrap;gap:4px 12px;min-width:0;margin:0}
.mail-address,.mail-address-plain{display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:4px 8px;max-width:100%;padding:0;border:0;background:none;font:inherit;line-height:1.65;text-align:left;overflow-wrap:anywhere;color:var(--ink)}
.mail-address{cursor:pointer;border-radius:4px;padding:2px 5px;margin:-2px -5px;gap:4px 8px}
.mail-address-name{font-weight:600}
.mail-address-email{color:var(--ink)}
.mail-address:hover,.mail-address[aria-expanded=true]{background:var(--bg)}
.mail-contact-caret{display:inline-flex;align-self:center;color:var(--sub)}.mail-contact-caret svg{width:12px;height:12px}
.mail-contact-menu{width:280px;padding:6px}
.mail-contact-identity{display:grid;gap:3px;padding:8px 10px 10px;font-size:12px;line-height:1.5;border-bottom:1px solid var(--line);margin-bottom:4px;overflow-wrap:anywhere}
.mail-contact-identity strong{font-size:13px;font-weight:600}.mail-contact-identity>span{color:var(--sub)}
.mail-contact-value{display:block;color:var(--sub);font-size:12px;margin-top:2px}
.mail-envelope-time{display:none;color:var(--sub);font-size:12px;margin-top:8px;font-variant-numeric:tabular-nums}
.mail-summary{margin-top:18px;padding:12px 0 0;border:0;border-top:1px solid var(--line);border-radius:0;background:none}
.mail-summary-meta{display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:11px;color:var(--sub)}
.mail-summary-label{font-size:11px;font-weight:600;margin-right:4px;color:var(--sub)}
.mail-summary .chip{padding:0 6px;font-size:11px;line-height:1.7;border-radius:4px}
.mail-summary p{margin:6px 0 0;font-size:13px;line-height:1.7;color:var(--sub)}
.mail-document{min-width:0;background:transparent;border:0;border-top:1px solid var(--line);padding-top:16px;border-radius:0;overflow:hidden}
.mail-reader-translation{display:flex;align-items:center;min-width:0}
#vbar #vtrans>button:first-of-type{color:var(--e-ui-accent)}
#vbar #vtrans [role=status]{max-width:210px}
#vtrans{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin:0;padding:0;min-height:0;border:0;border-radius:0;background:transparent;color:var(--sub);font-size:12px}
#vtrans>svg{display:none}
#vtrans [role=status]{max-width:280px;font-size:12px;line-height:1.5}
#vtrans:not([data-translation-busy]):not([data-translation-error]) [role=status]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
#vtrans button{min-height:28px;padding:3px 5px;font-size:12px;line-height:1.5}
#vtrans .translation-close{margin-left:0;color:var(--sub)}
#vbig{max-width:none;margin:0;width:100%;padding:12px 16px 0}
#vbody{position:relative;min-height:0;padding:0;background:var(--card)}
#vbody iframe{display:block;width:100%;min-height:0;border:0;background:#fff}
#vbody pre{margin:0;max-width:78ch;padding:0;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.75 var(--e-ui-font)}
.mail-selection-pending>.mail-reader-content{visibility:hidden}
.mail-selection-status{position:absolute;top:36px;left:24px;color:var(--sub);font-size:13px}
.mail-anchor-label{padding:10px 16px 0;color:var(--sub);font-size:11px}
${MAIL_WORKSPACE_CSS}
.mail-reader-attachments{margin-top:24px;padding-top:16px;border-top:1px solid var(--line);min-width:0}
.mail-reader-attachments h3{display:flex;align-items:baseline;gap:8px;margin:0 0 10px;font-size:13px;font-weight:600;line-height:1.5;color:var(--ink)}
.mail-reader-attachments h3 span{font-size:12px;font-weight:400;color:var(--sub);font-variant-numeric:tabular-nums}
.mail-reader-attachments ul{display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:0;list-style:none}
.mail-reader-file{display:flex;align-items:center;gap:10px;box-sizing:border-box;flex:0 1 360px;width:100%;max-width:100%;min-width:0;min-height:64px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.mail-reader-file-icon{display:flex;flex:none;color:var(--sub)}.mail-reader-file-icon svg{width:20px;height:20px}
.mail-reader-file-copy{display:grid;flex:1;gap:2px;min-width:0}.mail-reader-file-name{font-size:13px;line-height:1.5;overflow-wrap:anywhere}.mail-reader-file-copy small{font-size:11px;line-height:1.5;color:var(--sub)}
.mail-reader-file-download,.mail-reader-file-delete{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;min-height:32px;padding:6px;border:0;border-radius:6px;background:transparent;color:var(--sub);box-shadow:none;text-decoration:none}
.mail-reader-file-download svg,.mail-reader-file-delete svg{width:18px;height:18px}
.mail-reader-file-download:hover{background:var(--card);color:var(--e-ui-accent)}.mail-reader-file-delete:hover{background:var(--needbg);color:var(--danger)}
.mail-reader-file-download:focus-visible,.mail-reader-file-delete:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:2px}
.mail-reader-file-unavailable .mail-reader-file-name{color:var(--sub)}
@media(max-width:860px){
 .mail-reader-content{padding:12px 12px 28px}
 #vhead{padding:0 4px 16px}
 #vbar.mail-reader-commandbar{margin-bottom:12px;gap:4px;min-height:44px;flex-wrap:nowrap}
 #vbar #back{display:inline-flex;margin-right:auto;padding-left:0}
 #vbar .btn{min-height:44px;font-size:13px;padding-inline:8px}
 #vbar .mail-detail-time{display:none}
 #vbar #vtrans button{min-height:44px}
 #vbar.mail-reader-commandbar{flex-wrap:wrap}#vbar .mail-reader-translation{margin-left:auto}#vbar #vtrans [role=status]{max-width:140px;font-size:11px}
 #vbar .mail-actions.e-menu .btn{min-height:44px}
 #vhead h2{font-size:20px;line-height:1.4;margin-bottom:14px}
 .mail-envelope{font-size:12px;gap:8px}
 .mail-envelope>div{grid-template-columns:40px minmax(0,1fr);gap:6px}
 .mail-envelope dt{font-size:12px}
 .mail-address{min-height:24px}
 .mail-envelope-time{display:block}
 .mail-summary{margin-top:14px;padding:12px 0 0}
 .mail-summary p{font-size:13px}
 #vtrans{gap:4px}#vtrans button{min-height:36px;padding-inline:4px}
 #vtrans [role=status]{max-width:200px}
 #vbody pre{padding:0;font-size:14px}
 .mail-reader-file{flex-basis:100%;padding:8px;gap:8px}.mail-reader-file-download,.mail-reader-file-delete{width:44px;height:44px;min-height:44px}
 .mail-address{min-height:32px}.mail-contact-menu button{min-height:44px}

}
`;
