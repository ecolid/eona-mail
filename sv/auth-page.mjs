import {createHash} from 'node:crypto';

const css=`:root{color-scheme:light dark;--paper:#fff;--ink:#242821;--muted:#535b4c;--action:#566343;--hover:#3f4c33}*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#f4eedf;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink)}main{width:min(100%,448px);padding:40px;background:var(--paper);border-radius:12px;box-shadow:0 12px 40px rgba(33,41,29,.14)}.brand{display:block;margin:0 auto 32px;text-align:center;font-size:28px;font-weight:600;letter-spacing:-.04em;color:var(--ink)}h1{margin:0 0 16px;font-size:28px;line-height:1.3;font-weight:500;letter-spacing:-.02em;text-wrap:balance}p{margin:0;line-height:1.65;color:var(--muted);overflow-wrap:anywhere}.action{display:flex;align-items:center;justify-content:center;min-height:48px;margin-top:32px;padding:12px 20px;border-radius:4px;background:var(--action);color:#fff;text-decoration:none;font-weight:500;line-height:1.5}.action:hover{background:var(--hover)}.action:focus-visible{outline:3px solid var(--action);outline-offset:4px}::selection{background:#d8e0ca;color:#242821}@media(prefers-color-scheme:dark){:root{--paper:#1c1e21;--ink:#f0f1ed;--muted:#c5cbbd;--action:#566343;--hover:#65744e}}@media(max-width:560px){main{padding:32px 24px}body{background-attachment:scroll}.brand{margin-bottom:28px}}`;
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
  return new Response(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Eona</title><style>${css}</style></head><body><main aria-labelledby="title"><div class="brand" aria-label="Eona">Eona</div><h1 id="title">${escape(title)}</h1>${description?`<p>${escape(description)}</p>`:''}<a class="action" href="${escape(action)}">${escape(label)}</a></main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; style-src 'sha256-${styleHash}'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,...headers}});
}
