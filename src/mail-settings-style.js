export const MAIL_SETTINGS_CSS=`
body.mail-settings #view{display:none}body.mail-settings #list{width:auto;flex:1;min-width:0;overflow:hidden}
.mail-settings-page{display:flex;flex-direction:column;width:100%;height:100%;max-width:1000px;margin:0 auto;box-sizing:border-box;padding:28px 32px 0;color:var(--e-ui-ink)}
.mail-settings-page>header{margin-bottom:24px}
.mail-settings-page h1{font:600 22px/1.4 var(--e-ui-font);margin:0}
.mail-settings-page h2{font:600 14px/1.5 var(--e-ui-font);margin:0}
.mail-settings-tabs{--mail-segment-pad:16px;flex:none;width:fit-content;max-width:100%;margin-bottom:24px}
#mail-settings-form,.mail-settings-page>.mail-layout-settings,.mail-settings-page>.mail-source-settings{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;overflow-anchor:none}
.mail-settings-panel[hidden],#mail-settings-form[hidden]{display:none!important}
.mail-settings-panel{min-width:0;padding:0 0 24px}
.mail-settings-panel>h2{margin-bottom:18px}
.mail-settings-fields{min-width:0;border:0;padding:0;margin:0}
.mail-settings-general{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px 24px;max-width:680px}
.mail-settings-general>label{display:grid;gap:8px;min-width:0;font-size:12px;color:var(--e-ui-muted)}
.mail-settings-page :where(input,select),.mail-settings-page .e-select-trigger{min-width:0;width:100%;box-sizing:border-box;height:var(--mail-field,36px);min-height:var(--mail-field,36px);padding:7px 10px;border:1px solid var(--e-ui-line);border-radius:var(--mail-radius,7px);background:var(--e-ui-surface);color:var(--e-ui-ink);font:13px/20px var(--e-ui-font)}
.mail-settings-page .e-select{width:100%;min-width:0}
.mail-settings-page .e-select-trigger>span{white-space:normal;overflow-wrap:anywhere}
.mail-settings-page input:focus-visible,.mail-route-dialog input:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:1px}
.mail-settings-section-head{display:flex;align-items:center;gap:12px;padding:0 0 18px}
.mail-settings-section-head h2{margin-right:auto}
.mail-account-search{width:min(230px,40%)}.mail-account-search input{width:100%}
.mail-accounts-table{border-collapse:collapse;width:100%;table-layout:fixed;text-align:left;font:13px/1.5 var(--e-ui-font)}
.mail-accounts-table th{font-weight:500}
.mail-accounts-table thead th{font-size:11px;color:var(--e-ui-muted);padding:10px;background:var(--e-ui-soft)}
.mail-accounts-table thead th:nth-child(1){width:27%}.mail-accounts-table thead th:nth-child(2){width:32%}.mail-accounts-table thead th:nth-child(3){width:25%}.mail-accounts-table thead th:nth-child(4){width:16%}
.mail-accounts-table tbody th,.mail-accounts-table td{border-bottom:1px solid var(--e-ui-line);padding:14px 10px;overflow-wrap:anywhere;vertical-align:middle}
.mail-accounts-table td>input,.mail-accounts-table td>.e-select{max-width:100%}
.mail-route-path{display:inline-flex;align-items:center;gap:6px;max-width:100%;border:0;border-radius:4px;background:transparent;color:var(--e-ui-accent);padding:4px 0;font:inherit;text-align:left;cursor:pointer}
.mail-route-path span{overflow-wrap:anywhere;min-width:0}.mail-route-path svg{width:14px;height:14px;flex:none}
.mail-route-path:hover{text-decoration:underline;text-underline-offset:3px}
.mail-route-pending{display:block;font-size:11px;color:var(--e-ui-muted)}.mail-settings-unavailable{color:var(--e-ui-muted)}
.mail-settings-savebar{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;min-height:64px;padding:14px 0;background:var(--e-ui-surface);border-top:1px solid var(--e-ui-line);z-index:2}
.mail-settings-savebar>[role=status]{flex:1;font-size:12px;color:var(--e-ui-muted);overflow-wrap:anywhere}
#mail-settings-form:has([data-settings-panel="general"]:not([hidden])) .mail-settings-savebar{max-width:680px}
.mail-settings-savebar [data-settings-reset]{border-color:transparent;color:var(--e-ui-muted);background:transparent}
.mail-settings-primary{background:var(--e-ui-accent);border-color:var(--e-ui-accent);color:#fff}
.mail-settings-error,.mail-settings-savebar>.mail-settings-error{color:var(--e-ui-danger);font-size:13px}
.mail-route-dialog{width:min(460px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto}
.mail-route-dialog .e-modal-surface>p{font-size:13px;color:var(--e-ui-muted);line-height:1.6}
.mail-route-dialog label{display:grid;gap:6px;font-size:13px;margin:12px 0;color:var(--e-ui-muted)}
.mail-route-dialog label.mail-route-check{display:flex;align-items:center;gap:8px}
.mail-route-dialog [role=alert]{font-size:12px;color:var(--e-ui-danger);min-height:18px}
.mail-route-dialog .e-dialog-actions{flex-wrap:wrap}.mail-route-dialog .e-button{font-size:13px}
.mail-layout-settings{max-width:680px}
@media(max-width:1100px){
 .mail-settings-page{padding-inline:24px}
 .mail-accounts-table,.mail-accounts-table tbody{display:block;width:100%}.mail-accounts-table thead{display:none}
 .mail-accounts-table tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 20px;padding:16px 0;border-bottom:1px solid var(--e-ui-line)}
 .mail-accounts-table tbody th{grid-column:1/-1;display:block;border:0;padding:0 0 4px;font-size:13px}
 .mail-accounts-table td{display:grid;grid-template-columns:1fr;align-items:start;gap:6px;border:0;padding:0}
 .mail-accounts-table td[data-label="收信路径"]{grid-column:1/-1}
 .mail-accounts-table td::before{content:attr(data-label);font-size:11px;color:var(--e-ui-muted)}
 .mail-route-pending{grid-column:1}.mail-accounts-empty::before{display:none}
}
@media(max-width:860px){
 .mail-settings-page{padding:20px 16px 0}
 .mail-settings-page>header{margin-bottom:18px}.mail-settings-page h1{font-size:20px}
 .mail-settings-tabs{--mail-segment-pad:10px;width:100%;margin-bottom:20px}
 .mail-settings-general{gap:18px 12px}.mail-settings-general>label:nth-child(n+3){grid-column:1/-1}
 .mail-settings-page :where(input,select),.mail-settings-page .e-select-trigger{font-size:16px;min-height:44px;height:44px}
 .mail-settings-section-head{gap:8px;flex-wrap:wrap;padding-bottom:16px}
 .mail-account-search{width:100%;order:3}
 .mail-route-path{min-height:36px}
 .mail-settings-savebar{gap:6px}.mail-settings-savebar .e-button,.mail-route-dialog .e-button{min-height:44px}
 .mail-settings-savebar>[role=status]{font-size:11px}
}

.mail-source-load:empty{display:none}
.mail-source-load{color:var(--e-ui-muted);font-size:13px;min-height:20px;margin:8px 0}
.mail-source-account{border-bottom:1px solid var(--e-ui-line)}
.mail-source-account summary{display:flex;align-items:center;gap:16px;min-height:72px;padding:12px 0;cursor:pointer;list-style:none;box-sizing:border-box}
.mail-source-account summary::-webkit-details-marker{display:none}
.mail-source-account summary:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:3px;border-radius:6px}
.mail-source-account summary>svg{width:16px;height:16px;flex:none;color:var(--e-ui-muted)}
.mail-source-account summary>svg>*{transform-box:view-box;transform-origin:center;transition:transform var(--e-ui-motion) var(--e-ui-ease)}
.mail-source-account[open] summary>svg>*{transform:rotate(180deg)}
.mail-source-identity{min-width:0;flex:1;font-size:14px;font-weight:500;overflow-wrap:anywhere}
.mail-source-identity small{display:block;font-size:12px;color:var(--e-ui-muted);font-weight:400;margin-top:5px}
.mail-source-state{display:grid;gap:5px;text-align:right;font-size:12px;flex:none;color:var(--e-ui-muted)}
.mail-source-state strong{font-weight:500;color:var(--e-ui-ink)}
.mail-source-state[data-state=incomplete] strong,.mail-source-state[data-state=error] strong{color:var(--e-ui-danger,#b91c1c)}
.mail-source-folders{padding:0 0 16px}.mail-source-folders p{margin:0 0 8px;color:var(--e-ui-muted);font-size:12px}
.mail-source-folder{display:flex;justify-content:space-between;gap:16px;padding:9px 0;font-size:13px;line-height:20px}
.mail-source-folder>span:first-child{min-width:0;overflow-wrap:anywhere}.mail-source-folder>span:last-child{flex:none;color:var(--e-ui-muted);font-variant-numeric:tabular-nums}
@media(max-width:600px){.mail-source-identity{font-size:16px}.mail-source-identity small,.mail-source-state,.mail-source-folders p{font-size:14px}.mail-source-folder{font-size:14px}.mail-source-account summary{gap:10px}}
@media(prefers-reduced-motion:reduce){.mail-source-account summary>svg>*{transition:none}}
`;
