import {test,expect} from '@playwright/test';
import {scenarios,validateEvidence} from '../scenarios.mjs';
import {prepare,run,evidence} from '../runner.mjs';
for(const scenario of scenarios.filter(s=>!s.performance)){
  test(scenario.id,async({page},info)=>{
    // Trace/screenshot instrumentation changes measured rendering cost.
    // Other scenarios retain a trace on failure; performance records raw JSON.

    await prepare(page,scenario);
    const value=await run(page,scenario);await evidence(info,value);
    validateEvidence(value,process.env.GITHUB_SHA);
  });
}
for(const [width,dark] of [[320,true],[1280,false]])test(`body-layout-${width}`,async({page},info)=>{
  const scenario=scenarios.find(s=>s.id==='body-attachment-commit');
  await prepare(page,scenario,width,dark);const value=await run(page,scenario);
  await evidence(info,value);validateEvidence(value,process.env.GITHUB_SHA);
  await page.screenshot({path:info.outputPath('settled.png'),fullPage:true});
});

test('first-native-scroll-after-return',async({page},info)=>{
  const target=await prepare(page,{port:8793,path:'/preview?width=390&height=800'});
  const row=target.locator('#list .mail-open').first();await row.click();
  await expect(target.locator('#app')).toHaveAttribute('data-mail-reader-phase','active');
  await expect(target.locator('#view iframe')).toHaveAttribute('data-mail-ready','true');
  // Hold an unfinished visual exit so the very first trusted wheel must retire it.
  await target.evaluate(()=>{window.returnToMailList();for(const a of document.getElementById('mail-reader-page').getAnimations())a.pause()});
  const scroll=target.locator('#mail-list-scroll'),before=await scroll.evaluate(n=>({y:n.scrollTop,head:n.parentElement.querySelector('.mail-results-bar,.mail-workspace-title').getBoundingClientRect().y}));
  await scroll.hover({position:{x:190,y:160}});await page.mouse.wheel(0,320);
  await expect.poll(()=>scroll.evaluate(n=>n.scrollTop)).toBeGreaterThan(before.y);
  const after=await target.evaluate(()=>({y:document.getElementById('mail-list-scroll').scrollTop,head:document.querySelector('.mail-results-bar,.mail-workspace-title').getBoundingClientRect().y,reader:document.getElementById('mail-reader-page').getClientRects().length,phase:document.getElementById('app').dataset.mailReaderPhase}));
  await evidence(info,{method:'trusted-browser-wheel',before,after});
  expect(after.reader).toBe(0);expect(after.phase).toBe('list');expect(after.head).toBeCloseTo(before.head,1);
  await row.click();await expect(target.locator('#app')).toHaveAttribute('data-mail-reader-phase','active');
});

