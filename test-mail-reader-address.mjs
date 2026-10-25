import test from 'node:test';
import assert from 'node:assert/strict';
import {mailAddressParts,mailAddressSearch,mailPersonSearch,mailReaderHeader} from './src/mail-reader-view.js';
import {sendRecipients} from './src/mail-send.js';
import {mailSearchTerms} from './src/mail-search.js';
const escape=s=>String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
test('recipient parsing keeps quoted display-name commas and every mailbox',()=>{
 assert.deepEqual(mailAddressParts('"Last, First" <one@example.test>, 二号 <two@example.test>; three@example.test'),[{name:'Last, First',address:'one@example.test',searchable:true},{name:'二号',address:'two@example.test',searchable:true},{name:'',address:'three@example.test',searchable:true}]);
});
test('address action replaces own positive field and preserves keywords and other filters',()=>{
 const query='"Customer Invoice" from:old@example.test to:recipient@example.test filename:pdf -subject:spam';
 const actual=mailSearchTerms(mailAddressSearch(query,'from','billing@example.test',mailSearchTerms));
 assert.deepEqual(actual,mailSearchTerms('"Customer Invoice" to:recipient@example.test filename:pdf -subject:spam from:billing@example.test'));
});
test('address action removes contradicting exclusion but keeps unrelated exclusions',()=>{
 assert.equal(mailAddressSearch('-from:a@example.test -from:spam@example.test from:old@example.test','from','a@example.test',mailSearchTerms),'-from:spam@example.test from:a@example.test');
});
test('invalid addresses or overlong combined query do not silently rewrite scope',()=>{
 assert.throws(()=>mailAddressSearch('','from','x@foo.test from:other',mailSearchTerms),/无法用于搜索/);
 assert.throws(()=>mailAddressSearch('x'.repeat(490),'to','recipient@example.test',mailSearchTerms),/500/);
});
test('display-name searching quotes phrases and keeps the other query fields',()=>{
 assert.equal(mailPersonSearch('filename:pdf from:old to:owner@example.test','from','Cloud Services',mailSearchTerms),'filename:pdf to:owner@example.test from:"Cloud Services"');
 assert.throws(()=>mailPersonSearch('','from','bad" from:other',mailSearchTerms),/无法用于搜索/);
});
test('send recipient parsing keeps names and multiple recipients and rejects injected headers',()=>{
 assert.deepEqual(sendRecipients('"Last, First" <person+tag@example.test>; Next <next@example.test>'),[{name:'Last, First',address:'person+tag@example.test'},{name:'Next',address:'next@example.test'}]);
 assert.throws(()=>sendRecipients('one@example.test\r\nBcc:other@example.test'),/无效/);
});
test('envelope escapes untrusted names, renders individual recipient actions and explicit summary ownership',()=>{
 const html=mailReaderHeader({id:1,subject:'<subject>',from_name:'<sender>',from_addr:'sender@example.test',to_addr:'one@example.test,two@example.test',received_at:'2026-10-18',ai_summary:'<summary>',ai_category:'工作',labels:{tags:['工作','提醒']},folder:'inbox'},escape,{},String);
 assert.match(html,/&lt;sender>/);assert.doesNotMatch(html,/<sender>/);assert.equal((html.match(/data-mail-address-field="to"/g)||[]).length,2);assert.equal((html.match(/>工作<\/span>/g)||[]).length,1);assert.match(html,/aria-label="AI摘要"/);assert.match(html,/data-mail-more/);assert.doesNotMatch(html,/id="mail-actions"/);assert.match(html,/data-mail-contact/);
});
