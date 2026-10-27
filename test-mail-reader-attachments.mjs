import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {MAIL_ICONS} from './src/mail-experience-assets.js';
import {mailReaderAttachments} from './src/mail-reader-view.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons=MAIL_ICONS;
const nodes=root=>[root,...(root.childNodes||[]).flatMap(nodes)];
test('reader attachments expose download and local deletion separately with escaped identity and exact size',()=>{
 const html=mailReaderAttachments([{key:'att/a&b',name:'长文件<报告>.txt',size:12}],esc,icons,{id:4});
 const doc=parseFragment(html),all=nodes(doc),link=all.find(n=>n.tagName==='a'),button=all.find(n=>n.tagName==='button');
 assert.equal(link.attrs.find(a=>a.name==='href').value,'/api/file?key=att%2Fa%26b');assert.equal(link.attrs.find(a=>a.name==='aria-label').value,'下载附件 长文件<报告>.txt');assert(button.attrs.some(a=>a.name==='data-att-del'&&a.value==='att/a&b'));assert.match(html,/12 B/);assert.doesNotMatch(html,/undefined/);assert.match(html,/lucide-download/);assert.doesNotMatch(html,/<报告>/);
});
test('received, sent and draft readers share file structure and missing originals stay visible without download',()=>{
 for(const kind of ['sent','drafts']){const html=mailReaderAttachments([{id:'asset-one',name:'report.pdf',size:2048}],esc,icons,{kind});assert.match(html,/mail-reader-file-copy/);assert.match(html,/2 KB/);assert.match(html,/\/api\/mail-workspace\/assets\/asset-one/);assert.doesNotMatch(html,/data-att-del/)}
 const unavailable=mailReaderAttachments([{name:'past.pdf',deleted:'已删除',deleted_at:'2026-01-01'}],esc,icons);assert.match(unavailable,/past.pdf/);assert.match(unavailable,/已删除/);assert.doesNotMatch(unavailable,/<a |<button/);assert.equal(mailReaderAttachments([],esc,icons),'');
});
