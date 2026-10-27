import {test,expect} from '@playwright/test';
import {scenarios,validateEvidence} from '../scenarios.mjs';
import {prepare,run,evidence} from '../runner.mjs';
test.use({trace:'off'});
for(const scenario of scenarios.filter(s=>s.performance))test(scenario.id,async({page},info)=>{await prepare(page,scenario);const value=await run(page,scenario);await evidence(info,value);validateEvidence(value,process.env.GITHUB_SHA)});
test('gate-catches-root-invalidation-regression',async({page},info)=>{
  const scenario=scenarios.find(s=>s.id==='render-budget');const target=await prepare(page,scenario);
  await target.evaluate(()=>document.addEventListener('touchmove',e=>{
    document.getElementById('app').style.setProperty('--mail-ci-injected-regression',String(e.touches[0]?.clientY));
  },true));
  const value=await run(page,scenario);await evidence(info,value,'expected-rejected-regression');
  expect(value.checks.localMotionWrites).toBe(false);
  expect(()=>validateEvidence(value,process.env.GITHUB_SHA)).toThrow('browser_scenario_failed');
});

