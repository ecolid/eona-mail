import test from 'node:test';
import assert from 'node:assert/strict';
import PostalMime from 'postal-mime';
import {mailSourceReceivedAt,repairMailHeaderEncoding} from './src/mail-source-metadata.js';
const now=Date.UTC(2026,9,25);
test('source time prefers valid message date, then Received, then provider time, never import time',()=>{
 const internal='2014-02-07T07:30:56Z',headers=[{key:'received',value:'by old-provider; Fri, 7 Feb 2014 15:30:55 +0800'}];
 assert.equal(mailSourceReceivedAt({date:'Thu, 6 Feb 2014 15:00:00 +0800',headers},internal,now),'2014-02-06 07:00:00');
 assert.equal(mailSourceReceivedAt({date:'bad',headers},internal,now),'2014-02-07 07:30:55');
 assert.equal(mailSourceReceivedAt({},internal,now),'2014-02-07 07:30:56');
 assert.equal(mailSourceReceivedAt({date:'2099-01-01'},internal,now),'2014-02-07 07:30:56');
 assert.equal(mailSourceReceivedAt({},null,now),null);
});
const legacy=Buffer.concat([Buffer.from('From: "'),Buffer.from('5151d3cacfe4b9dcc0edd4b1','hex'),Buffer.from('" <friends@example.test>\r\nSubject: '),Buffer.from('b8e6cbdfd0c2bac3d3d1c4e3b5c4456d61696cb5d8d6b7','hex'),Buffer.from('\r\nContent-Type: multipart/alternative; boundary="example"\r\n\r\n--example\r\nContent-Type: text/plain; charset=gb2312\r\n\r\nOriginal body\r\n--example--\r\n')]);
test('unencoded legacy headers use the declared MIME charset, preserving original bytes and parser identity',async()=>{
 const bytes=Buffer.from(legacy),parsed=await PostalMime.parse(bytes);assert(parsed.subject.includes('\ufffd'));
 const fixed=await repairMailHeaderEncoding(bytes,parsed,PostalMime);
 assert.equal(fixed.subject,'告诉新好友你的Email地址');assert.equal(fixed.from.name,'QQ邮箱管理员');assert.equal(fixed.from.address,parsed.from.address);
 assert(parsed.subject.includes('\ufffd'));assert.deepEqual(bytes,legacy);assert.equal(fixed.text,parsed.text);
});
test('valid UTF-8 and RFC2047 headers retain their declared decoding; undeclared bad sender falls back to address',async()=>{
 for(const subject of ['UTF-8 中文','=?gb2312?B?uObL39DCusPT0cTjtcRFbWFpbLXW1rc=?=']){
  const bytes=Buffer.from('From: Sender <sender@example.test>\r\nSubject: '+subject+'\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody'),parsed=await PostalMime.parse(bytes);assert.deepEqual(await repairMailHeaderEncoding(bytes,parsed,PostalMime),parsed);
 }
 const bytes=Buffer.concat([Buffer.from('From: '),Buffer.from('bac3b6b9cdf8','hex'),Buffer.from('<sender@example.test>\r\nSubject: valid\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody')]);
 const fixed=await repairMailHeaderEncoding(bytes,await PostalMime.parse(bytes),PostalMime);assert.equal(fixed.from.name,'');assert.equal(fixed.from.address,'sender@example.test');assert.equal(fixed.subject,'valid');
});

test('legacy multipart missing its final delimiter retains the last part charset, but ignores epilogue declarations',async()=>{
 const unfinished=legacy.subarray(0,legacy.indexOf('--example--'));
 const repaired=await repairMailHeaderEncoding(unfinished,await PostalMime.parse(unfinished),PostalMime);assert.equal(repaired.subject,'告诉新好友你的Email地址');assert.equal(repaired.from.name,'QQ邮箱管理员');
 const withEpilogue=Buffer.concat([legacy,Buffer.from('Content-Type: text/plain; charset=windows-1252\r\n\r\nEpilogue')]);
 assert.equal((await repairMailHeaderEncoding(withEpilogue,await PostalMime.parse(withEpilogue),PostalMime)).subject,'告诉新好友你的Email地址');
});
