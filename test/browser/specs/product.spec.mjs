import {test,expect} from '@playwright/test';
import {prepare,evidence} from '../runner.mjs';

// Real page wiring, synthetic workspace. No external connector or SMTP exists.
test('filter-live-continuity-and-anchor',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'});
  const trigger=f.locator('.mail-list-filter'),select=f.locator('[data-mail-select-toggle]');
  await trigger.click();const panel=f.locator('.mail-list-filter-panel');
  const before=await trigger.boundingBox(),selectBefore=await select.boundingBox();
  await f.evaluate(()=>{
    window.__filterFrames=[];window.__filterSampling=true;
    window.__filterNodes={panel:document.querySelector('.mail-list-filter-panel'),trigger:document.querySelector('.mail-list-filter'),scroll:document.getElementById('mail-list-scroll')};
    const sample=()=>{if(!window.__filterSampling)return;const p=document.querySelector('.mail-list-filter-panel'),b=document.querySelector('.mail-list-filter');
      window.__filterFrames.push({rows:document.querySelectorAll('#list .mail-open').length,placeholder:!!document.querySelector('#list .mail-page-skeleton'),same:p===__filterNodes.panel&&b===__filterNodes.trigger&&document.getElementById('mail-list-scroll')===__filterNodes.scroll,open:p.matches(':popover-open'),x:b.getBoundingClientRect().x});requestAnimationFrame(sample)};sample();
  });
  // Hold the actual list request. Assertions inspect the waiting interval itself.
  let release;const gate=new Promise(r=>release=r);let requested=false;
  await page.route('**/api/emails?**',async route=>{requested=true;await gate;await route.continue()});
  await panel.locator('[data-filter-name=has][data-filter-value=yes]').click();
  await expect.poll(()=>requested).toBe(true);
  await expect(f.locator('#q')).toHaveValue('has:attachment');
  expect(await f.locator('#list .mail-open').count()).toBeGreaterThan(0);
  expect(await panel.evaluate(n=>n.matches(':popover-open'))).toBe(true);
  release();await page.unroute('**/api/emails?**');
  await expect(f.locator('#list .mail-open')).toHaveCount(1);
  await panel.locator('[data-filter-name=has][data-filter-value=yes]').click();
  await expect(f.locator('#q')).toHaveValue('');
  await expect.poll(()=>f.locator('#list .mail-open').count()).toBeGreaterThan(1);
  await panel.locator('[data-filter-name=read][data-filter-value=unread]').click();
  await expect(trigger).toHaveAttribute('aria-label','清除全部筛选');await trigger.click();
  await expect(f.locator('#q')).toHaveValue('');
  const samples=await f.evaluate(()=>{__filterSampling=false;return __filterFrames});
  expect(samples.length).toBeGreaterThan(1);
  expect(samples.every(s=>s.rows>0&&!s.placeholder&&s.same)).toBe(true);
  expect(samples.filter(s=>s.open).every(s=>Math.abs(s.x-before.x)<1)).toBe(true);
  expect((await trigger.boundingBox()).width).toBeCloseTo(before.width,1);
  expect((await select.boundingBox()).x).toBeCloseTo(selectBefore.x,1);
  await evidence(info,{method:'browser-click-and-controlled-response',samples,before,after:await trigger.boundingBox()});
});

for(const folder of ['inbox','sent','drafts','contacts','important','subscriptions','trash'])test(`selection-${folder}`,async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'});
  await f.evaluate(folder=>{state.folder=folder;state.q='';state.cur=null;return loadList()},folder);
  const toggle=f.locator('[data-mail-select-toggle]');await expect(toggle).toBeVisible();
  const before=await toggle.boundingBox();
  // Empty scope keeps its disabled action slot; it must not appear selectable.
  const rows=f.locator('.mail-action-row');const count=await rows.count();
  if(!count){await expect(toggle).toBeDisabled();await evidence(info,{folder,count,emptyDisabled:true});return}
  await toggle.click();await expect(toggle).toHaveAttribute('aria-label','取消选择');
  const toolbar=f.locator('.mail-selection-toolbar');await toolbar.locator('[data-list-action=all]').click();
  await expect(f.locator('.mail-action-row[data-selected]')).toHaveCount(count);
  await expect(toolbar.locator('[data-list-action=all]')).toHaveAttribute('aria-pressed','true');
  // The only selected count is in the fixed heading.
  expect(await toolbar.textContent()).not.toMatch(/已选\s*\d/);
  await toolbar.locator('[data-list-action=all]').click();await expect(f.locator('.mail-action-row[data-selected]')).toHaveCount(0);
  await toggle.click();await expect(f.locator('#app')).not.toHaveAttribute('data-mail-selecting');
  const after=await toggle.boundingBox();expect(after.x).toBeCloseTo(before.x,1);expect(after.width).toBeCloseTo(before.width,1);
  await evidence(info,{folder,count,before,after,selectAllAndClear:true});
});

test('search-first-press-clear-close-and-submit',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'});
  await f.locator('.mail-search-options').click();
  const words=f.locator('input[name=words]');await words.fill('邮件主题 1259');await words.focus();
  // Reduced viewport models keyboard occlusion; actual OS IME remains device evidence.
  await page.locator('#screen').evaluate(n=>n.style.height='400px');
  const clear=f.locator('.mail-search-options-panel .e-search-clear');
  await clear.dispatchEvent('pointerdown',{pointerType:'touch',pointerId:31,isPrimary:true,button:0});
  await expect(words).toHaveValue('');
  await words.fill('邮件主题 1259');await f.locator('.mail-search-options-panel [type=submit]').click();
  await expect(f.locator('#q')).toHaveValue('邮件主题 1259');
  await expect(f.locator('#list .mail-open')).toHaveCount(1);
  await f.locator('.mail-search-options').click();await words.focus();
  await f.locator('.mail-search-sheet-close').dispatchEvent('pointerdown',{pointerType:'touch',pointerId:32,isPrimary:true,button:0});
  await expect(f.locator('.mail-search-options-panel')).not.toBeVisible();
  await evidence(info,{method:'synthetic-touch-press-and-browser-submit',keyboard:'viewport-height-model',matchedRows:1,clearFirstPress:true,closeFirstPress:true});
});

test('row-swipe-tray-reversal-and-staggered-pair',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/row-actions'});
  const command=async name=>{await page.locator(`[data-test="${name}"]`).click();await expect(page.locator('#result')).toHaveAttribute('data-command',name);return JSON.parse(await page.locator('#result').textContent()).latest};
  const reverse=await command('swipe-cycle');expect(reverse.openRows).toBe(0);expect(reverse.reading).toBe(false);
  const pair=await command('two-sequential');expect(pair.selecting).toBe(true);expect(pair.selected.length).toBeGreaterThan(1);
  const end=await command('release');expect(end.reading).toBe(false);expect(end.pressed).toBe(0);
  await evidence(info,{method:'synthetic-source-events',reverse,pair,end});
});

test('draft-save-reopen-and-single-isolated-send',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'},1280);
  const control=mode=>page.request.post('http://127.0.0.1:8793/__review/control',{data:{group:'draft',mode}});
  const subject='CI synthetic draft '+info.project.name;
  await f.locator('[data-new-mail]').click();
  const form=f.locator('#mail-compose-form');await expect(form).toBeVisible();
  await form.locator('[name=to]').fill('friend@example.test');await form.locator('[name=subject]').fill(subject);
  await form.locator('[contenteditable=true]').fill('Persist this synthetic body.');
  await control('fail');await form.locator('[data-compose-save]').click();
  await expect(form.locator('[data-compose-retry]')).toBeVisible();
  await expect(form.locator('[name=subject]')).toHaveValue(subject);
  await control('normal');await form.locator('[data-compose-retry]').click();
  const drafts=async()=>{const r=await page.request.get('http://127.0.0.1:8793/api/mail-workspace');return (await r.json()).drafts};
  await expect.poll(async()=>(await drafts()).find(d=>d.subject===subject)?.body||'').toContain('Persist this synthetic body.');
  await f.locator('[data-compose-close]').click();await expect(form).not.toBeVisible();
  await f.evaluate(()=>{state.folder='drafts';state.q='';return loadList()});
  await f.locator('.mail-action-row').filter({hasText:subject}).locator('.mail-open').click();
  await f.locator('[data-workspace-edit]').click();await expect(form).toBeVisible();
  await expect(form.locator('[contenteditable=true]')).toContainText('Persist this synthetic body.');
  const trace=async()=>{const r=await page.request.get('http://127.0.0.1:8793/__review/trace');return r.json()};
  const before=(await trace()).sends;
  await form.locator('[data-compose-send]').evaluate(b=>{b.click();b.click()});
  await expect.poll(async()=>(await trace()).sends).toBe(before+1);
  await expect(form).not.toBeVisible();
  expect((await drafts()).some(d=>d.subject===subject)).toBe(false);
  await evidence(info,{method:'browser-form-and-isolated-transport',saveFailurePreservesInput:true,retryPersisted:true,reopened:true,sends:1});
});
