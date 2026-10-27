import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeMailHTML,mailHTMLDocument,mailHTMLPolicy} from './src/mail-html-policy.js';
import {parse} from 'parse5';

test('reading projection strips executable HTML, navigation overrides and automatic focus without changing the stored input',()=>{
 const html='<meta http-equiv="refresh" content="0;url=https://example.test"><base href="https://hostile.test/"><script>parent.stolen=true</script><svg><script>alert(1)</script><a xlink:href="java&#x09;script:alert(1)" onload="alert(1)">link</a></svg><iframe srcdoc="<script>alert(1)</script>"></iframe><object data="data:text/html,bad"></object><img src="x" onerror="alert(1)"><input autofocus formaction="https://hostile.test"><p onclick="alert(1)">Keep <b>formatting</b></p>';
 const result=sanitizeMailHTML(html);assert.doesNotMatch(result,/<(?:script|iframe|object|base|meta)\b|\bonerror=|\bonload=|\bonclick=|\bautofocus|\bformaction|javascript:/i);assert.match(result,/Keep <b>formatting<\/b>/);assert.match(html,/parent.stolen/);
});
test('first content is the fixed CSP, independent of email policy or API policy data',()=>{
 const html=sanitizeMailHTML('<html><head><meta http-equiv="Content-Security-Policy" content="script-src * unsafe-inline"><style>td{padding:12px}</style></head><body><table width="600"><tr><td><a href="https://example.test">Read</a><img src="https://example.test/p.png"></td></tr></table></body></html>');
 const result=mailHTMLDocument(html);assert(result.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="'+mailHTMLPolicy()+'">'));assert.equal((result.match(/http-equiv="Content-Security-Policy"/g)||[]).length,1);assert.match(mailHTMLPolicy(),/script-src 'none'/);assert.match(mailHTMLPolicy(),/connect-src 'none'/);assert.match(mailHTMLPolicy(),/form-action 'none'/);assert.match(mailHTMLPolicy(),/base-uri 'none'/);assert.match(html,/<table width="600">/);assert.match(html,/https:\/\/example.test\/p.png/);assert.doesNotThrow(()=>parse(result));
});
test('template contents and SVG/MathML namespaces cannot retain active descendants or handlers',()=>{
 const result=sanitizeMailHTML('<template><script>alert(1)</script><img src=x onerror=alert(1)></template><math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>"></table></mtext></math>');assert.doesNotMatch(result,/<script\b|\sonerror=/i);
});
test('script-blocked reader callbacks do not hide noscript fallback content',()=>{
 const result=sanitizeMailHTML('<html><head><noscript><style>p{line-height:1.6}</style></noscript></head><body><noscript><p>Readable fallback <b>content</b></p><script>unsafe()</script></noscript><p>Normal content</p></body></html>');assert.doesNotMatch(result,/<noscript\b|<script\b/i);assert.match(result,/<p>Readable fallback <b>content<\/b><\/p>/);assert.match(result,/Normal content/);
});
