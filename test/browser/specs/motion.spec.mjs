import {test,expect} from '@playwright/test';
import {scenarios,validateEvidence} from '../scenarios.mjs';

async function prepare(page,scenario,width=390,dark=false){
  await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(u.hostname)||['data:','blob:','about:'].includes(u.protocol)?route.continue():route.abort('blockedbyclient');
  });
  await page.goto(`http://127.0.0.1:${scenario.port}${scenario.path}`);
  const nested=scenario.path!=='/';
  const target=nested?page.frames().find(f=>f.parentFrame()):page.mainFrame();
  await expect.poll(()=>target.locator('#list .mail-open').count()).toBeGreaterThan(0);
  if(nested)await page.locator('iframe').evaluate((f,width)=>f.style.width=width+'px',width);
  else await page.setViewportSize({width,height:800});
  if(dark)await target.evaluate(()=>window.EonaUI.setAppearance('dark'));
  await target.evaluate(()=>document.fonts.ready);
  return target;
}
async function run(page,scenario){
  // Controls intentionally dispatch the same synthetic paths as the human review.
  // Native browser scrolling is tested separately below.
  if(scenario.label)await page.getByRole('button',{name:scenario.label,exact:true}).evaluate(b=>b.click());
  else await page.locator(scenario.button).click();
  let value;
  await expect.poll(async()=>{
    value=scenario.dataset?await page.evaluate(key=>{
      try{return JSON.parse(document.documentElement.dataset[key]||'null')}catch{return null}
    },scenario.dataset):await page.locator(scenario.result).evaluate(n=>{try{return JSON.parse(n.textContent)}catch{return null}});
    return value&&(value.status&&value.status!=='running'||typeof value.pass==='boolean');
  },{timeout:105000}).toBeTruthy();
  return value;
}
async function evidence(info,value,name='evidence'){
  await info.attach(name,{body:JSON.stringify(value,null,2),contentType:'application/json'});
}

for(const scenario of scenarios){
  test.describe(scenario.id,()=>{
  if(scenario.performance)test.use({trace:'off'});
  test(scenario.id,async({page},info)=>{
    // Trace/screenshot instrumentation changes measured rendering cost.
    // Other scenarios retain a trace on failure; performance records raw JSON.

    await prepare(page,scenario);
    const value=await run(page,scenario);await evidence(info,value);
    validateEvidence(value,process.env.GITHUB_SHA);
  });
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

test.describe('regression-detector',()=>{
test.use({trace:'off'});
test('gate-catches-root-invalidation-regression',async({page},info)=>{
  const scenario=scenarios.find(s=>s.id==='render-budget');const target=await prepare(page,scenario);
  await target.evaluate(()=>document.addEventListener('touchmove',e=>{
    document.getElementById('app').style.setProperty('--mail-ci-injected-regression',String(e.touches[0]?.clientY));
  },true));
  const value=await run(page,scenario);await evidence(info,value,'expected-rejected-regression');
  expect(value.checks.localMotionWrites).toBe(false);
  expect(()=>validateEvidence(value,process.env.GITHUB_SHA)).toThrow('browser_scenario_failed');
});

});
