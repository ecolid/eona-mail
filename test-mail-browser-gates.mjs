import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {scenarios,validateEvidence} from './test/browser/scenarios.mjs';
test('browser evidence rejects missing, incomplete, unbound and failed results',()=>{
  const source={sourceCommit:'a'.repeat(40),manifestVerified:true,workingTree:null};
  for(const value of [null,{}, {status:'running'}, {status:'passed',source,checks:{}},
    {status:'failed',source,checks:{x:false}}, {status:'passed',source:{...source,manifestVerified:false},checks:{x:true}},
    {status:'passed',source,checks:{x:true},error:'timeout'}])assert.throws(()=>validateEvidence(value,source.sourceCommit));
  assert.throws(()=>validateEvidence({status:'passed',source,checks:{x:true}},'b'.repeat(40)),/source_mismatch/);
  assert.equal(validateEvidence({status:'passed',source,checks:{x:true}},source.sourceCommit).status,'passed');
});
test('browser registry is unique and release waits for its required jobs',()=>{
  assert.equal(new Set(scenarios.map(s=>s.id)).size,scenarios.length);
  const workflow=readFileSync(new URL('./.github/workflows/mail.yml',import.meta.url),'utf8');
  assert.match(workflow,/needs: \[check, browser, coverage\]/);
  assert.match(workflow,/browser: \[chromium, webkit\]/);
  assert.doesNotMatch(workflow,/continue-on-error/);
});
