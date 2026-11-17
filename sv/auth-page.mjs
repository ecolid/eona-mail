import {createHash} from 'node:crypto';

const css=':root{color-scheme:light dark;--paper:#fcfbf7;--ink:#273329;--muted:#55624f;--action:#40564a;--hover:#354a3f;--edge:#d4d1c5;--wash:#f5f2e9}\n*{box-sizing:border-box}\nbody{margin:0;min-height:100svh;display:grid;place-items:center;padding:36px 20px;background:var(--wash);font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;color:var(--ink)}\nmain{position:relative;width:min(100%,368px);padding:44px 26px 24px;background:var(--paper);border-radius:12px;box-shadow:0 10px 35px rgba(44,51,37,.06)}\nmain::before{content:"";position:absolute;inset:0;border:1px solid var(--edge);border-radius:inherit;pointer-events:none;clip-path:polygon(0 0,18px 0,18px 22px,113px 22px,113px 0,100% 0,100% 100%,0 100%)}\n.brand{position:absolute;top:-22px;left:26px;font-size:32px;font-weight:740;letter-spacing:-.06em;line-height:1.2;color:var(--ink)}\n.title-row{display:flex;align-items:center;gap:12px}\n.status-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:10px;background:#eaece3;color:var(--muted)}\n.status-icon svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}\nh1{margin:0;font-size:22px;line-height:1.35;font-weight:620;letter-spacing:-.02em;text-wrap:balance}\np{margin:22px 0 0;font-size:14px;line-height:1.65;color:var(--muted);overflow-wrap:anywhere}\nfooter{display:flex;justify-content:flex-end;align-items:center;min-height:54px;margin-top:24px;padding-top:12px;border-top:1px solid var(--edge)}\n.action{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:6px;background:var(--action);color:#fff;text-decoration:none;font-size:14px;font-weight:550;line-height:1.4}\n.action:hover{background:var(--hover)}\n.action:focus-visible{outline:2px solid var(--muted);outline-offset:3px}\n::selection{background:#d8e0ca;color:#273329}\n@media(prefers-color-scheme:dark){:root{--paper:#20271f;--ink:#edf0e5;--muted:#bac8af;--action:#485e46;--hover:#536c50;--edge:#4a5343;--wash:#161d17}.status-icon{background:#30392c}main{box-shadow:none}}\n@media(max-width:359px){main{padding-inline:22px}.brand{left:22px}h1{font-size:21px}body{padding-inline:16px}}';
const styleHash=createHash('sha256').update(css).digest('base64');
const messages={
  logged_out:['已退出登录','', '重新登录'],
  login_flow_missing:['请重新登录','这次登录链接已失效。重新登录后可继续访问。','重新登录'],
  login_flow_expired:['请重新登录','这次登录链接已失效。重新登录后可继续访问。','重新登录'],
  login_flow_revoked:['登录已取消','这次登录已随退出失效。请重新登录。','重新登录'],
  login_validation_failed:['无法完成登录','登录验证未通过。请重新登录。','重新登录'],
  recent_authentication_required:['请重新验证','此操作需要重新确认身份。','重新验证'],
  application_forbidden:['无权访问','此账号无权访问这个应用。','重新登录'],
  account_login_not_enabled:['登录暂不可用','请稍后重试。','重试'],
  identity_unavailable:['暂时无法登录','账号服务暂时无法连接，请稍后重试。','重试'],
  application_unavailable:['暂时无法访问','应用暂时无法连接，请稍后重试。','重试'],
};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isAuthDocument=request=>request.method==='GET'&&request.headers.get('accept')?.includes('text/html');
export function authPage(error,{status=400,action='/auth/start',headers={}}={}){
  if(!action.startsWith('/')||action.startsWith('//')||/[\\\r\n]/.test(action))throw Error('auth_page_action_invalid');
  const [title,description,label]=messages[error]||messages.identity_unavailable;
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Eona</title><style>${css}</style></head><body><main aria-labelledby="title"><div class="brand" aria-label="Eona">eona</div><div class="title-row"><span class="status-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 8v5m0 3h.01"/><circle cx="12" cy="12" r="9"/></svg></span><h1 id="title">${escape(title)}</h1></div>${description?`<p>${escape(description)}</p>`:''}<footer><a class="action" href="${escape(action)}">${escape(label)}</a></footer></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; style-src 'sha256-${styleHash}'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,...headers}});
}
