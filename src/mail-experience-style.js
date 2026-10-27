import {MAIL_SCROLLBARS_CSS} from './mail-experience-assets.js';
export const MAIL_EXPERIENCE_CSS=MAIL_SCROLLBARS_CSS+`
#list .mail{position:relative}
#list .mail-open{position:absolute;inset:0;z-index:1;width:100%;height:100%;border:0;padding:0;border-radius:0;background:transparent;cursor:pointer}
#list .mail-open:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:-2px}
#list .mail-code{position:relative;z-index:2}

#app :is([data-overlayscrollbars],[data-overlayscrollbars-viewport]){scrollbar-gutter:auto}
/* These nodes own scrolling before and after overlay initialization. A newly
   inserted settings form must never reserve a native gutter for one frame. */
#app :is(#side,#list,#mail-list-scroll,#view,#mail-settings-form,.mail-layout-settings,.mail-compose,.mail-settings-pending-form){scrollbar-gutter:auto;scrollbar-width:none}
#app :is(#side,#list,#mail-list-scroll,#view,#mail-settings-form,.mail-layout-settings,.mail-compose,.mail-settings-pending-form)::-webkit-scrollbar{display:none}
.mail-overlay-scrollbar{position:fixed!important;--os-size:10px;--os-padding-perpendicular:3px;--os-handle-border-radius:6px;--os-handle-bg:color-mix(in srgb,var(--e-ui-muted) 42%,transparent);--os-handle-bg-hover:color-mix(in srgb,var(--e-ui-muted) 65%,transparent);--os-handle-bg-active:var(--e-ui-muted)}
/* Mail's larger, denser feedback stack uses a slower spatial handoff. The
   shared component retains lifetime, focus, pause and node ownership. */
@media(prefers-reduced-motion:no-preference){body.mail-atlas .e-toast-slot{transition:transform 440ms cubic-bezier(.22,.72,.18,1),opacity 220ms}
body.mail-atlas .e-toast-stack{transition:height 440ms cubic-bezier(.22,.72,.18,1)}}
.mail-directory-line>.mail-contact-mark{display:inline-flex;align-items:center;flex:none;margin-left:0;color:var(--mail-star)}.mail-directory-line>.mail-contact-mark svg{width:13px;height:13px}
/* Mail's control family: visual scale, state and layout have one owner. */
body.mail-atlas{--mail-control:34px;--mail-field:36px;--mail-radius:10px;--mail-float-radius:24px;--mail-float-gap:16px;--mail-float-width:480px;--mail-float-min:64px;--mail-float-shadow:0 8px 24px rgb(0 0 0/.1);--mail-motion:220ms;--mail-ease:cubic-bezier(.22,1,.36,1);--mail-star:#a77416;--mail-on-primary:#fff}
:root.dark body.mail-atlas{--mail-star:#dabb78;--mail-on-primary:#101827}
#app main{position:relative}
#app :is(.btn,.e-button,.mail-search-actions button),body.mail-atlas :is(.e-dialog .e-button,.mail-search-actions button){display:inline-flex;align-items:center;justify-content:center;flex:none;min-height:var(--mail-control);height:var(--mail-control);border-radius:var(--mail-radius);font:500 13px/20px var(--e-ui-font);gap:6px;padding:6px 10px;box-shadow:none;white-space:nowrap;transition:background-color 120ms,color 120ms,border-color 120ms,transform 100ms}
#app :is(.btn,.e-button,.mail-search-actions button):where(:hover):not(:disabled),body.mail-atlas :is(.e-dialog .e-button,.mail-search-actions button):where(:hover):not(:disabled){background:var(--e-ui-soft)}
#app :is(.btn,.e-button,.mail-search-actions button):active:not(:disabled),body.mail-atlas :is(.e-dialog .e-button,.mail-search-actions button):active:not(:disabled){transform:scale(.97)}
#app :is(.btn,.e-button) svg,body.mail-atlas .e-dialog .e-button svg{width:17px;height:17px;stroke-width:1.8;flex:none}
#app :is(.pri,.mail-primary,.mail-settings-primary,.mail-search-actions [type=submit]),body.mail-atlas :is(.e-dialog .mail-settings-primary,.e-dialog .mail-dialog-primary,.mail-search-actions [type=submit]){background:var(--e-ui-accent);border-color:var(--e-ui-accent);color:var(--mail-on-primary)}
#app :is(.pri,.mail-primary,.mail-settings-primary,.mail-search-actions [type=submit]):hover:not(:disabled),body.mail-atlas :is(.e-dialog .mail-settings-primary,.e-dialog .mail-dialog-primary,.mail-search-actions [type=submit]):hover:not(:disabled){background:var(--e-ui-accent);color:var(--mail-on-primary);filter:brightness(.94)}
#app :is(.warn,[data-compose-discard]):hover{color:var(--e-ui-danger)}
#app :is(.btn,.e-button,.mail-search-actions button):disabled,body.mail-atlas :is(.e-dialog .e-button,.mail-search-actions button):disabled{opacity:.5;cursor:default;transform:none}
#app :is(.mail-workspace-title,.mail-results-bar) .e-select-trigger{height:var(--mail-control);min-height:var(--mail-control);padding:6px 10px;gap:6px;border-color:transparent;border-radius:var(--mail-radius);background:transparent;color:var(--e-ui-muted);font:500 13px/20px var(--e-ui-font);box-shadow:none;transition:background-color 120ms,color 120ms}
#app :is(.mail-workspace-title,.mail-results-bar) .e-select-trigger:hover,#app :is(.mail-workspace-title,.mail-results-bar) .e-select-trigger[aria-expanded=true]{border-color:transparent;background:var(--e-ui-soft);color:var(--e-ui-ink)}
#app :is(.mail-workspace-title,.mail-results-bar) .e-select-trigger svg{width:16px;height:16px}
#app>header .logo{font-size:23px;line-height:1;gap:14px;align-self:stretch;align-items:center}
#app>header .logo .brandtext{font-size:14px;line-height:22px;padding-left:14px}
#app>header .search{transition:border-color 140ms;filter:none}
#app>header .search:hover{border-color:color-mix(in srgb,var(--e-ui-muted) 48%,var(--e-ui-line))!important}
#mail-refresh svg{transform-origin:center}
#mail-refresh[data-spinning] svg{animation:mail-refresh-spin .65s linear infinite}
#side{position:relative;padding:10px 8px}
.mail-side-tools{display:flex;align-items:center;gap:6px;margin:2px 6px 14px}
#app .mail-side-tools>.mail-new-compose{display:flex;justify-content:center;flex:1;min-width:0;margin:0;height:36px;min-height:36px}
#side .item{position:relative;z-index:1;min-height:36px;padding:8px 10px;gap:9px;line-height:20px;isolation:isolate}
#side .item svg{width:18px;height:18px;stroke-width:1.8}
#side .item .n{font-size:11px;line-height:20px;font-weight:400;font-variant-numeric:tabular-nums}
#side .item.on{background:transparent;color:var(--e-ui-accent);font-weight:600}
#side .item.on svg{color:inherit}
#side .mail-nav-action{display:flex;align-items:center;flex:1;gap:9px;min-width:0;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;border-radius:4px}
#side .mail-nav-action:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:4px}
#mail-nav-indicator{position:absolute;left:8px;right:8px;top:0;border-radius:8px;background:var(--e-ui-selected);pointer-events:none;z-index:0;transform-origin:top left}
#side .sec{font-size:11px;line-height:18px;letter-spacing:0;text-transform:none;margin:22px 10px 6px}
#side button.sec.tap{width:calc(100% - 20px)}#side .item.sub{padding-left:24px;font-size:12px}
#side .asof{margin:10px 10px 4px;padding:8px 0 0;border-top:1px solid var(--e-ui-line);font-size:10px;line-height:1.5;color:var(--e-ui-muted);font-variant-numeric:tabular-nums}
/* Same heading rhythm in every list; status belongs below it only when needed. */
#app #list .mail-workspace-title,#app #list .mail-results-bar{display:flex;align-items:center;gap:8px;box-sizing:border-box;height:56px;min-height:56px;padding:12px 16px;border-bottom:1px solid var(--e-ui-line);background:var(--e-ui-surface)}
#app #list .mail-workspace-title h1{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 14px/22px var(--e-ui-font)}
#app #list .mail-workspace-title>span{font-size:12px;font-weight:400;color:var(--e-ui-muted);white-space:nowrap}
#list .mail{position:relative}
#list .mail .sum{min-height:36px;white-space:normal;-webkit-line-clamp:2}
#list .mail .from::before{display:none!important}
#list .mail.unread>.av::after{content:'';position:absolute;right:-2px;top:-2px;width:7px;height:7px;box-sizing:content-box;border:2px solid var(--e-ui-surface);border-radius:50%;background:var(--e-ui-accent)}
#list .av{position:relative;font-weight:500}
#list .mail-row-head .from{display:flex;align-items:center;min-width:0}
.mail-row-sender{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mail-row-star{display:flex;align-items:center;flex:none;margin-left:0;color:var(--mail-star)}
.mail-row-star svg{width:12px;height:12px;stroke-width:1.5}
#list .mail-row-head{gap:8px;min-height:22px;align-items:center}
#list .mail-row-head .time{margin-left:auto}
#list .empty:not([role=alert]){display:flex;align-items:center;justify-content:center;min-height:180px;box-sizing:border-box;padding:40px 20px;margin:0;color:var(--e-ui-muted);font:400 13px/1.6 var(--e-ui-font);text-align:center}
#list .mail-list-status{margin:12px 16px;padding:10px 12px;border-radius:7px;background:var(--e-ui-soft);color:var(--e-ui-muted);font:400 12px/1.6 var(--e-ui-font)}
.mail-list-status[hidden]{display:none}
.mail-directory-message>span>span,.mail-workspace-mail-copy>.mail-workspace-snippet{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;overflow-wrap:anywhere;line-height:1.5}
/* A shared moving selection for contacts and settings; buttons retain their nodes. */
.mail-segments{position:relative;isolation:isolate;box-sizing:border-box;display:flex;gap:2px;padding:3px;border:0;border-radius:8px;background:var(--e-ui-soft);overflow-x:auto;scrollbar-width:none;scroll-padding-inline:3px;overscroll-behavior-x:contain}
.mail-segments::-webkit-scrollbar{display:none}
#app .mail-segments>button{position:relative;z-index:1;flex:1 0 auto;min-width:max-content;min-height:34px;padding:7px var(--mail-segment-pad,10px);border:0;border-radius:6px;background:transparent;color:var(--e-ui-muted);font:500 13px/20px var(--e-ui-font);white-space:nowrap;transition:color 150ms}
#app .mail-segments>button:hover{color:var(--e-ui-ink)}
#app .mail-segments>button:is([aria-pressed=true],[aria-selected=true]){color:var(--e-ui-ink);background:transparent;box-shadow:none}
#app .mail-segments>button:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:-2px}
.mail-segment-indicator{position:absolute;left:0;top:0;z-index:0;border-radius:6px;background:var(--e-ui-surface);box-shadow:0 1px 2px rgb(0 0 0/.06);pointer-events:none;transform-origin:top left}

/* Sorting is a settings task, with contained rows and independent drag overlays. */
.mail-layout-settings{margin:0;padding:0}
.mail-order-groups{max-width:none;margin-top:12px}
.mail-order-groups details{border-bottom:1px solid var(--e-ui-line)}
.mail-order-groups summary{display:flex;align-items:center;gap:8px;list-style:none;cursor:pointer;min-height:44px;font-size:13px;font-weight:500;color:var(--e-ui-ink)}
.mail-order-groups summary::-webkit-details-marker{display:none}
.mail-order-groups summary small{margin-left:auto;color:var(--e-ui-muted);font:400 12px/20px var(--e-ui-font)}
.mail-order-groups summary>svg{width:14px;height:14px;color:var(--e-ui-muted);transform:rotate(-90deg);transition:transform 180ms}
.mail-order-groups details[open]>summary>svg{transform:none}
.mail-order-list{padding:2px 0 10px}
.mail-order-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:40px;padding:3px 6px 3px 10px;border-radius:7px;color:var(--e-ui-ink);background:var(--e-ui-surface);font:13px/20px var(--e-ui-font)}
.mail-order-icon{display:flex;flex:none;color:var(--e-ui-muted)}
.mail-order-icon svg{display:block;width:17px;height:17px;stroke-width:1.8;flex:none}
.mail-order-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mail-order-handle{display:grid;place-items:center;flex:none;width:32px;height:32px;padding:7px;border:0;border-radius:5px;background:transparent;color:var(--e-ui-muted);cursor:grab;touch-action:none}
.mail-order-handle svg{display:block;width:15px;height:15px;stroke-width:1.8}
.mail-order-handle:hover{background:var(--e-ui-soft)}.mail-order-handle:active{cursor:grabbing}
.mail-order-handle:focus-visible{outline:2px solid var(--e-ui-accent);outline-offset:0}
.mail-sort-ghost{opacity:.25;background:var(--e-ui-soft)}.mail-sort-chosen{background:var(--e-ui-soft)}
.mail-sort-fallback{z-index:1500!important;background:var(--e-ui-surface);box-shadow:0 8px 24px rgb(0 0 0/.16);font:13px/20px var(--e-ui-font)}
.mail-sorting{user-select:none}
.mail-order-footer{display:flex;align-items:center;gap:16px;justify-content:space-between;margin-top:16px}
.mail-order-footer>span{color:var(--e-ui-muted);font-size:11px;max-width:32ch;line-height:1.6}
.mail-order-footer>.e-button{flex:none}
.mail-split-gutter{position:relative;flex:0 0 4px;cursor:col-resize;z-index:5;background:transparent;touch-action:none;outline:none}
.mail-split-gutter:before{content:'';position:absolute;top:0;bottom:0;left:1px;width:1px;background:var(--e-ui-line)}
.mail-split-gutter:after{content:'';position:absolute;left:0;right:0;top:calc(50% - 22px);height:44px;border-radius:3px;background:var(--e-ui-muted);opacity:0;transition:opacity 160ms}
.mail-split-gutter:hover:after,.mail-split-gutter:focus-visible:after,.mail-resizing .mail-split-gutter:after{opacity:.4}
.mail-split-gutter:focus-visible:after{outline:2px solid var(--e-ui-accent);outline-offset:3px}
.mail-resizing{cursor:col-resize;user-select:none}.mail-resizing iframe{pointer-events:none}
#app[data-mail-split=true] :is(#side,#list,#mail-reader-page){flex:none;min-width:0}
#app[data-mail-split=true] #side,#app[data-mail-split=true] #list{border-right:0}
.mail-search-options-panel{border-radius:var(--mail-float-radius);padding:20px!important;max-height:min(780px,var(--e-popover-available-height,82dvh));overflow:hidden}
.mail-search-options-panel form{display:flex;flex-direction:column;min-height:0;max-height:calc(var(--e-popover-available-height,82dvh) - 42px)}
.mail-search-options-panel :is(h2,.mail-search-actions,.mail-search-options-state,.mail-search-form-error){flex:none}
.mail-search-options-panel .mail-search-grid{min-height:0;overflow:auto;overscroll-behavior:contain;padding-right:4px}
.mail-search-options-panel label{min-width:0}
.mail-search-options-panel input[type=date]{display:block;min-width:0;max-width:100%;appearance:none;-webkit-appearance:none}
.mail-search-options-panel input[type=date]::-webkit-date-and-time-value{text-align:left;min-width:0}
.mail-search-options-panel h2{font-size:16px;font-weight:600;margin:0 0 18px}
.mail-search-options-panel label{font-size:12px;color:var(--sub);gap:6px;margin-bottom:14px}
.mail-search-options-panel .mail-search-actions{border-top:1px solid var(--line);margin-top:6px;padding-top:16px;gap:8px}
.mail-search-options-panel .mail-search-actions>button{background:transparent;color:var(--sub)}
.mail-search-options-panel .mail-search-actions>button:hover{background:var(--e-ui-soft);color:var(--ink)}
.mail-search-options-panel .mail-search-actions>[type=submit],.mail-search-options-panel .mail-search-actions>[type=submit]:hover{background:var(--e-ui-accent);color:var(--mail-on-primary)}
.mail-reader-content h1,.mail-reader-content h2{letter-spacing:-.02em}
#app .mail-compose-toolbar [data-compose-save],#app .mail-compose-toolbar [data-compose-discard],#app .mail-compose-toolbar .mail-sender-settings{border-color:transparent;background:transparent;color:var(--sub)}
#app .mail-compose-toolbar [data-compose-discard],#app .mail-compose-toolbar .mail-sender-settings{width:var(--mail-control);padding:7px;margin:0}
#app .mail-compose-toolbar .mail-sender-settings>span{display:none}
#app .mail-compose-toolbar .e-button:hover{background:var(--e-ui-soft);color:var(--ink)}
#app .mail-compose-toolbar .mail-primary:hover{background:var(--e-ui-accent);color:var(--mail-on-primary)}
#app .mail-compose-heading{min-height:56px;padding:10px 20px;gap:10px}
#app .mail-compose-heading h1{font-size:16px}
#app .mail-compose-heading>[data-compose-close]{width:32px;padding:0;border:0;background:transparent;color:var(--sub)}
#app .mail-compose-toolbar{gap:4px}
#app .mail-sent-toolbar .e-button,#app .mail-directory-back{border-color:transparent;background:transparent;color:var(--sub)}
.mail-send-notice{margin:12px 16px;padding:10px 12px;border:1px solid var(--e-ui-line);border-radius:8px;background:var(--e-ui-soft);font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.mail-list-error{display:flex;align-items:center;gap:12px;min-height:44px;margin:0;padding:8px 16px;border:0;border-bottom:1px solid var(--e-ui-line);border-radius:0;background:var(--e-ui-soft);font-size:12px;line-height:20px;color:var(--sub);overflow-wrap:anywhere}.mail-list-error .btn{flex:none;margin-left:auto}
.mail-body-status[role=status]{position:absolute;inset:0 0 auto;z-index:1;pointer-events:none}
#vbar .mail-star[aria-pressed=true],#app .mail-important-toggle[aria-pressed=true]{color:var(--mail-star)}
#vbar .mail-star{min-width:68px}
.mail-sent-reading .mail-sent-body{margin-top:0;padding-top:24px}
.mail-directory-header{padding-bottom:28px}
.mail-directory-heading{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.mail-directory-heading h1{font-size:20px;line-height:1.4;margin:0}
.mail-directory-avatar{width:36px;height:36px;display:grid;place-items:center;flex:none;border-radius:10px;background:var(--e-ui-soft);color:var(--e-ui-muted)}
.mail-directory-avatar svg{width:20px;height:20px}
#app .mail-important-toggle{display:grid;place-items:center;border:0;background:transparent;color:var(--e-ui-muted);width:34px;height:34px;flex:none;padding:8px}
.mail-directory-identities{gap:8px;font-size:13px;line-height:1.65}
.mail-directory-actions{margin:20px 0 0;gap:8px}
#app .mail-directory-actions .mail-source-action{font-size:13px;border-color:var(--e-ui-line);background:var(--e-ui-soft);color:var(--e-ui-ink)}
#app .mail-directory-actions .mail-source-action:hover{background:var(--e-ui-soft);color:var(--ink);text-decoration:none}
.mail-directory-metadata{margin-top:16px}
.mail-source-link{display:flex;align-items:center;gap:6px;color:var(--e-ui-accent);font-size:12px;padding:6px 0}
.mail-source-link svg{width:12px;height:12px}
.mail-correspondence-heading{align-items:center;min-height:40px;gap:8px}
.mail-correspondence-heading h2{margin:0}.mail-correspondence-heading .mail-loading-spinner{margin-left:auto}
.mail-correspondence-error{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--e-ui-danger);padding:16px 0}
.mail-directory-reading .mail-directory-message{padding:18px 0}.mail-directory-reading{max-width:920px}
body.mail-atlas .e-dialog{width:min(420px,calc(100vw - 32px));padding:24px;border-radius:var(--mail-float-radius);box-shadow:0 16px 48px rgb(0 0 0/.16)}
body.mail-atlas .e-dialog h2{font-size:18px;line-height:1.5;margin:0 0 8px;font-weight:600}
body.mail-atlas .e-dialog>p{font-size:13px;line-height:1.7;margin:0;color:var(--e-ui-muted);overflow-wrap:anywhere}
body.mail-atlas .e-dialog .e-dialog-actions{margin-top:24px;gap:8px}body.mail-atlas .e-dialog .e-dialog-actions>.e-button:not([data-danger]):not(.mail-dialog-primary){background:var(--e-ui-soft);border-color:var(--e-ui-line)}
/* The local password fallback uses the same roles as authenticated forms. */
body.mail-atlas #login input{height:var(--mail-field);min-height:var(--mail-field);padding:7px 10px;border-radius:var(--mail-radius);font:400 13px/20px var(--e-ui-font)}
body.mail-atlas #login .e-button{height:var(--mail-control);min-height:var(--mail-control);padding:6px 10px;border-radius:var(--mail-radius);font:500 13px/20px var(--e-ui-font);background:var(--e-ui-accent);color:var(--mail-on-primary)}
/* Portal forms and app forms use the same role tokens, including enhanced nodes. */
body.mail-atlas :is(.mail-search-options-panel,.mail-list-filter-panel,.mail-route-dialog,.mail-editor-link-dialog) :is(input:not([type=checkbox]),.e-select-trigger){box-sizing:border-box;min-width:0;width:100%;height:var(--mail-field);min-height:var(--mail-field);padding:7px 10px;border:1px solid var(--e-ui-line);border-radius:var(--mail-radius);background:var(--e-ui-surface);color:var(--e-ui-ink);font:400 13px/20px var(--e-ui-font)}
body.mail-atlas :is(.mail-search-options-panel,.mail-list-filter-panel,.mail-route-dialog,.mail-editor-link-dialog,.mail-settings-page) :is(input:not([type=checkbox]),.e-select-trigger):not([aria-invalid=true]):is(:focus,[aria-expanded=true]){border-color:var(--e-ui-accent);outline:none;box-shadow:none}
body.mail-atlas :is(.mail-search-options-panel,.mail-list-filter-panel,.mail-route-dialog,.mail-editor-link-dialog) input[aria-invalid=true]{border-color:var(--e-ui-danger)}
body.mail-atlas .e-dialog{max-height:calc(100dvh - 32px);overflow:auto}
body.mail-atlas .e-dialog :is(input[aria-invalid=true],[role=alert]){border-color:var(--e-ui-danger)}
#app .mail-compose-envelope .e-select-trigger{height:var(--mail-field);min-height:var(--mail-field);border-radius:var(--mail-radius);font:400 13px/20px var(--e-ui-font);padding:7px 10px}
#app :is(.mail-editor-tool,.mail-editor-formats .e-select-trigger){height:32px;min-height:32px;border-radius:5px;font:400 12px/20px var(--e-ui-font);transition:background-color 120ms,color 120ms}
#app .mail-editor-tool:hover:not(:disabled){background:var(--e-ui-selected);color:var(--e-ui-accent)}
#app .mail-editor-tool:disabled:hover{background:transparent;color:var(--e-ui-muted)}
#app #vtrans button{display:inline-flex;align-items:center;justify-content:center;height:var(--mail-control);min-height:var(--mail-control);border-radius:var(--mail-radius);padding:6px 10px;font:500 13px/20px var(--e-ui-font);text-decoration:none;transition:background-color 120ms,color 120ms}
#app #vtrans button:hover:not(:disabled){background:var(--e-ui-soft)}
#app #vatts button.mini{display:inline-grid;place-items:center;width:var(--mail-control);height:var(--mail-control);min-height:var(--mail-control);padding:8px;border:0;border-radius:var(--mail-radius);background:transparent;color:var(--e-ui-muted)}
#app #vbig .bigcode{cursor:pointer;min-height:44px;border:0;font-family:ui-monospace,monospace}
#app #vatts button.mini svg{width:17px;height:17px}
#app #vatts button.mini:hover{color:var(--e-ui-danger);background:var(--e-ui-soft)}
/* Bottom surfaces share one material, frame and motion vocabulary. */
:root:has(body.mail-atlas){--e-ui-motion-exit:160ms}
body.mail-atlas :is(.e-toast[data-variant=card],.mail-selection-toolbar,dialog.mail-search-sheet.e-modal,dialog.mail-action-sheet.e-modal){border:1px solid var(--e-ui-line);border-radius:var(--mail-float-radius);background:var(--e-ui-surface);color:var(--e-ui-ink);box-shadow:var(--mail-float-shadow)}
body.mail-atlas .e-toast-region{transition:bottom 280ms cubic-bezier(.16,1,.3,1)}
body.mail-atlas .e-toast-slot[data-front=true] :is(.e-toast-copy,.e-toast-symbol,.e-toast-action){animation:mail-feedback-content 160ms cubic-bezier(.16,1,.3,1)}
@keyframes mail-feedback-content{from{opacity:.6;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
/* Mail adapts the shared card density and safe area; its timer, stack and
interrupted motion remain owned by Foundation. Short feedback has no empty row. */
body.mail-atlas .e-toast[data-variant=card]{display:grid;grid-template-columns:28px minmax(0,1fr) auto 32px;align-items:center;min-height:var(--mail-float-min);padding:8px 10px 8px 14px;gap:8px}
body.mail-atlas .e-toast-symbol{grid-column:1;grid-row:1}body.mail-atlas .e-toast-copy{grid-column:2;grid-row:1}body.mail-atlas .e-toast-action{grid-column:3;grid-row:1}body.mail-atlas .e-toast-close{grid-column:4;grid-row:1}
body.mail-atlas .e-toast[data-countdown=true]{padding-bottom:8px}
body.mail-atlas .e-toast-lifetime{display:none}
body.mail-atlas .e-toast-time-track{position:static;grid-column:3;grid-row:1;align-self:end;margin:0 10px 6px;height:2px;z-index:1;pointer-events:none;background:color-mix(in srgb,var(--e-ui-accent) 14%,transparent)}body.mail-atlas .e-toast-time-progress{opacity:.65}
body.mail-atlas .e-toast[data-countdown=true] .e-toast-action{padding-bottom:11px}
body.mail-atlas .e-toast-symbol{border-radius:50%}
body.mail-atlas .e-toast-action{min-height:44px;padding:8px 12px;border:0;border-radius:14px;background:var(--e-ui-selected);color:var(--e-ui-accent)}
body.mail-atlas .e-toast-close{width:32px;height:44px;min-width:32px;border-radius:12px}
body.mail-atlas .e-toast-close:hover{background:var(--e-ui-soft)}
@media(max-width:860px){
 body.mail-atlas{--mail-control:44px;--mail-field:44px;--mail-radius:12px}
 #app>header .logo{font-size:21px;gap:10px}
 .mail-split-gutter{display:none!important}
 .mail-side-tools{margin:0 6px 12px}
 #side[data-e-drawer-mobile=true]{overflow-x:hidden!important;overflow-y:auto!important}
 #side .item{min-height:44px;padding-block:0}
 #side .mail-nav-action{min-height:44px;align-items:center}
 #side button.sec.tap{min-height:44px;margin-block:8px 0;align-items:center}
 #app .mail-side-tools>.mail-new-compose{height:44px;min-height:44px}
 #side .sec{margin-top:18px}
 #app #list .mail-workspace-title{height:56px;min-height:56px}
 #app .mail-segments>button{min-height:44px;padding-inline:10px}

 .mail-order-footer{align-items:flex-start;flex-direction:column;gap:10px}
 .mail-order-handle{width:44px;height:44px}
 #app .mail-compose-heading{gap:4px;flex-wrap:wrap;padding:4px 8px}
 #app .mail-compose-heading h1{font-size:15px;flex:1}
 #app .mail-compose-heading>[data-compose-close]{width:36px}
 #app .mail-compose-toolbar{gap:0;margin-left:auto}
 #app .mail-compose-toolbar [data-compose-send]{padding:6px 10px;height:34px;min-height:34px;position:relative;margin:0 3px}
 #app .mail-compose-toolbar [data-compose-send]::before{content:'';position:absolute;inset:-5px 0}
 #app .mail-compose-toolbar [data-compose-save],#app .mail-compose-toolbar [data-compose-discard],#app .mail-compose-toolbar .mail-sender-settings{width:44px;padding:7px}
 #app .mail-compose-toolbar [data-compose-save]>span{display:none}
 .mail-directory-avatar{display:none}.mail-directory-heading{gap:8px;margin-bottom:12px}
 .mail-directory-heading h1{font-size:18px}.mail-directory-header{padding-bottom:24px}
 .mail-directory-actions{margin-top:16px}
 body.mail-atlas :is(.mail-search-options-panel,.mail-list-filter-panel,.mail-route-dialog,.mail-editor-link-dialog) :is(input:not([type=checkbox]),.e-select-trigger){font-size:16px}
 #app :is(.mail-editor-tool,.mail-editor-formats .e-select-trigger){height:44px;min-height:44px;min-width:36px}
 #app .mail-editor-formats .mail-editor-tool{width:36px}
 #app .mail-color-tool{height:44px;min-width:36px;position:relative}
 #app .mail-color-tool input{width:28px;height:28px;min-height:28px}
 #app .mail-compose-people-button{width:44px;min-height:44px;border-radius:var(--mail-radius)}
 #app .mail-compose-heading>[data-compose-close],#app .mail-directory-back,#app .mail-important-toggle{width:44px}
 #app .mail-address{min-height:44px;align-items:center}
 body.mail-atlas #login input{font-size:16px}
 #app>header .mail-search-options{width:44px;height:44px}
 body.mail-atlas .e-toast-region{left:var(--mail-float-gap);right:var(--mail-float-gap);width:auto;max-width:var(--mail-float-width);margin-inline:auto;bottom:var(--mail-selection-toast-bottom,calc(var(--mail-float-gap) + env(safe-area-inset-bottom)))}
 .mail-search-options-panel{width:calc(100vw - 24px);padding:16px!important;max-height:var(--e-popover-available-height,calc(100dvh - 24px))}
 .mail-search-options-panel form{max-height:calc(var(--e-popover-available-height,100dvh - 24px) - 34px)}
 .mail-search-options-panel .mail-search-actions{position:static;background:var(--e-ui-surface);padding:12px 0 0;margin:6px 0 0}
 .mail-search-options-panel .mail-search-actions>button{min-height:44px}
}
@media(max-width:600px){.mail-search-options-panel .mail-search-grid{grid-template-columns:minmax(0,1fr)}}
@media(max-width:360px){#app .mail-editor-insert .mail-editor-tool:not(.mail-format-toggle)>span{display:none}}
@media(prefers-reduced-motion:reduce){:root:has(body.mail-atlas){--e-ui-motion-exit:0ms}body.mail-atlas .e-toast-slot[data-front=true] :is(.e-toast-copy,.e-toast-symbol,.e-toast-action){animation:none}#app{--mail-motion:0ms}.mail-split-gutter,.mail-segment-indicator,.e-toast-region,.e-toast[data-variant=card]{transition:none}#mail-refresh[data-spinning] svg{animation:none}}
`;
