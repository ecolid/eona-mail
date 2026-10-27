import {expect} from '@playwright/test';
export async function prepare(page,scenario,width=390,dark=false){
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
  await target.evaluate(()=>{document.documentElement.dataset.mailInputModel=JSON.stringify(window.MailReviewInput||{})});
  return target;
}
export async function run(page,scenario){
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
export async function evidence(info,value,name='evidence'){
  await info.attach(name,{body:JSON.stringify(value,null,2),contentType:'application/json'});
}
