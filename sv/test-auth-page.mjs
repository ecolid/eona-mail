import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {authPage,isAuthDocument} from './auth-page.mjs';
for(const error of ['logged_out','login_flow_missing','login_flow_expired','login_flow_revoked','login_validation_failed','recent_authentication_required','application_forbidden','account_login_not_enabled','identity_unavailable','application_unavailable']){
  const response=authPage(error,{action:'/auth/start?return=%2Fmail&reauth=1'}),html=await response.text();
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  const css=html.match(/<style>([\s\S]*?)<\/style>/)[1],hash=createHash('sha256').update(css).digest('base64');
  assert.ok(response.headers.get('content-security-policy').includes("'sha256-"+hash+"'"));
  assert.ok(!/https?:\/\//.test(html));assert.ok(!html.includes('<img'));assert.ok(html.includes('aria-label="Eona"'));assert.ok(html.includes('prefers-color-scheme:dark'));assert.ok(html.includes('return=%2Fmail&amp;reauth=1'));assert.ok(!html.includes('<script'));
}
for(const action of ['//evil.test','https://evil.test','/\\evil.test','/\nLocation:evil'])assert.throws(()=>authPage('logged_out',{action}),/action_invalid/);
assert.ok(isAuthDocument(new Request('https://mail.example.invalid/auth/start',{headers:{accept:'text/html'}})));
assert.ok(!isAuthDocument(new Request('https://mail.example.invalid/auth/start',{method:'POST',headers:{accept:'text/html'}})));
console.log('auth-page: 10 shared states, dark/mobile styles, CSP hash, no scripts, escaped local actions, no-store/no-referrer passed');
