import {test,expect} from '@playwright/test';
import {prepare,evidence} from '../runner.mjs';

const base='http://127.0.0.1:8793';
const control=(page,group,mode)=>page.request.post(base+'/__review/control',{data:{group,mode}});
test.beforeEach(async({page})=>{for(const group of ['read','write','body','options','settings','draft','send','file','routes'])await control(page,group,'normal')});
const pick=async(f,folder)=>{await f.evaluate(folder=>{state.folder=folder;state.q='';state.cur=null;return loadList()},folder)};

test('sidebar-inbox-authoritative-refresh-failure-recovery',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'},1280);
  const count=f.locator('[data-pick=inbox] .n');
  await expect(count).toHaveText(/^\d+$/);const before=Number(await count.textContent());
  // The same compact workspace response consumed by the existing 30s poll.
  // Change only the authoritative source projection; do not patch UI state.
  await page.route('**/api/mail-workspace?view=compact',async route=>{
    const response=await route.fetch({headers:{...route.request().headers(),'if-none-match':''}}),value=await response.json();
    value.folders.find(x=>x.folder==='inbox').count=before+3;
    await route.fulfill({response,json:value,headers:{...response.headers(),etag:'"ci-count-projection"'}});
  });
  await count.evaluate(n=>n.dataset.reviewIdentity='same-counter');
  await f.evaluate(()=>MailWorkspace.load(true));
  await expect(count).toHaveText(String(before+3));
  await expect(count).toHaveAttribute('data-review-identity','same-counter');
  await page.unroute('**/api/mail-workspace?view=compact');
  await control(page,'read','fail-once');
  await f.evaluate(()=>MailWorkspace.load(true).catch(()=>{}));
  await expect(count).toHaveText('—');
  await f.evaluate(()=>MailWorkspace.load(true));
  await expect(count).toHaveText(String(before));
  await evidence(info,{method:'controlled-authoritative-response-existing-poll-owner',before,updated:before+3,failure:'unknown',recovered:before,inPlace:true});
});

test('batch-partial-failure-retry-and-trash-restore',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'},320,true);
  const items=f.locator('.mail[data-mail-id]');
  const ids=await items.evaluateAll(nodes=>nodes.slice(0,3).map(n=>n.dataset.mailId));
  expect(ids).toHaveLength(3);
  await f.locator('[data-mail-select-toggle]').click();
  for(const id of ids)await f.locator(`.mail-action-row:has([data-mail-id="${id}"]) .mail-row-check`).click();
  await control(page,'write','fail-once');
  const toolbar=f.locator('.mail-selection-toolbar');
  await toolbar.locator('[data-list-action=trash]').click();
  await expect(f.locator('.e-toast-message')).toContainText('1 封未完成');
  await expect(f.locator('.mail-action-row[data-selected]')).toHaveCount(1);
  await expect(f.locator(`.mail[data-mail-id="${ids[0]}"]`)).toBeVisible();
  const emptyRows=await f.locator('.mail-action-row').evaluateAll(nodes=>nodes.filter(n=>!n.querySelector('.mail-open')).length);
  expect(emptyRows).toBe(0);
  const feedback=await f.locator('.e-toast[data-variant=card]').evaluate(n=>({rect:n.getBoundingClientRect().toJSON(),bottom:n.ownerDocument.querySelector('.mail-selection-toolbar').getBoundingClientRect().top}));
  expect(feedback.rect.bottom).toBeLessThanOrEqual(feedback.bottom);
  await toolbar.locator('[data-list-action=trash]').click();
  await expect(f.locator('#app')).not.toHaveAttribute('data-mail-selecting');
  await pick(f,'trash');
  for(const id of ids)await expect(f.locator(`.mail[data-mail-id="${id}"]`)).toBeVisible();
  await f.locator('[data-mail-select-toggle]').click();
  for(const id of ids)await f.locator(`.mail-action-row:has([data-mail-id="${id}"]) .mail-row-check`).click();
  await toolbar.locator('[data-list-action=restore]').click();
  await expect(f.locator('#app')).not.toHaveAttribute('data-mail-selecting');
  await expect(f.locator('.mail-open')).toHaveCount(0);
  await pick(f,'inbox');
  for(const id of ids)await expect(f.locator(`.mail[data-mail-id="${id}"]`)).toBeVisible();
  await expect(f.locator('[data-mail-select-toggle]')).toBeEnabled();
  await evidence(info,{method:'browser-controls-real-api-isolated-store',ids,partialRetained:1,retryRemoved:1,restored:3,emptyRows,feedback});
});

test('settings-failure-retry-cancel-and-reentry',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'},390);
  await pick(f,'settings');
  const name=f.locator('#mail-settings-form [name=default_name]');
  const previous=await name.inputValue(),value='CI saved '+info.project.name;
  await name.fill(value);await control(page,'settings','fail-once');
  await f.locator('#mail-settings-form [type=submit]').click();
  await expect(f.locator('#mail-settings-form [role=status]')).toContainText('暂时失败');
  await expect(name).toHaveValue(value);
  await f.locator('#mail-settings-form [type=submit]').click();
  await expect(f.locator('#mail-settings-form')).toHaveAttribute('data-dirty','false');
  await name.fill('Discard this unsaved name');
  await f.locator('[data-settings-reset]').click();
  await expect(name).toHaveValue(value);
  await pick(f,'inbox');await pick(f,'settings');
  await expect(name).toHaveValue(value);
  await evidence(info,{method:'browser-form-real-api',previous,saved:value,failedInputPreserved:true,cancelRestored:true,reentry:true});
});

test('source-health-truth-states-and-failed-refresh',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'},320,true);
  await pick(f,'settings');await f.locator('[data-settings-tab=sync]').click();
  const panel=f.locator('#mail-settings-panel-sync');
  await expect(panel.locator('[data-source-account]')).toHaveCount(4);
  for(const text of ['已覆盖','缺 1 封','连接失败','检查已过期'])await expect(panel).toContainText(text);
  const first=panel.locator('details').first();await first.locator('summary').click();
  await expect(first).toHaveAttribute('open','');
  await control(page,'read','fail-once');await panel.locator('[data-refresh-source]').click();
  await expect(panel.locator('[role=status]')).toContainText('暂时无法读取');
  await expect(panel.locator('[data-source-account]')).toHaveCount(4);
  await panel.locator('[data-refresh-source]').click();
  await expect(panel.locator('[role=status]')).toBeEmpty();
  await expect(first).toHaveAttribute('open','');
  const overflow=await panel.evaluate(n=>n.scrollWidth>n.clientWidth+1);expect(overflow).toBe(false);
  await evidence(info,{method:'real-health-view-synthetic-provider-states',states:['complete','incomplete','error','stale'],failurePreservesSnapshot:true,retryPreservesDisclosure:true,overflow});
});

test('rich-draft-assets-link-save-and-reopen',async({page},info)=>{
  const f=await prepare(page,{port:8793,path:'/journeys'},320,true);
  await f.locator('#mail-menu').click();await f.locator('[data-new-mail]').click();
  const form=f.locator('#mail-compose-form'),subject='CI rich draft '+info.project.name;
  await form.locator('[name=to]').fill('friend@example.test');
  await form.locator('[name=subject]').fill(subject);
  await form.locator('[contenteditable=true]').fill('A persistent rich draft.');
  await f.locator('[data-editor=link]').click();
  await f.locator('.mail-editor-link-dialog [name=text]').fill('Review link');
  await f.locator('.mail-editor-link-dialog [name=url]').fill('https://example.test/review');
  await f.locator('.mail-editor-link-dialog [type=submit]').click();
  await form.locator('[data-editor-file]').setInputFiles({name:'review.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic attachment only.')});
  await expect(form.locator('.mail-editor-file')).toContainText('review.txt');
  await form.locator('[data-editor-image]').setInputFiles({name:'pixel.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9ioAAAAASUVORK5CYII=','base64')});
  await expect(form.locator('[contenteditable=true] img')).toHaveCount(1);
  await f.locator('[data-compose-save]').click();
  const drafts=async()=>{const r=await page.request.get(base+'/api/mail-workspace');return (await r.json()).drafts};
  await expect.poll(async()=>(await drafts()).find(d=>d.subject===subject)?.attachments?.length||0).toBe(1);
  await f.locator('[data-compose-close]').click();await pick(f,'drafts');
  await f.locator('.mail-action-row').filter({hasText:subject}).locator('.mail-open').click();
  await f.locator('[data-workspace-edit]').click();
  await expect(form.locator('[contenteditable=true] a').filter({hasText:'Review link'})).toHaveAttribute('href','https://example.test/review');
  const image=form.locator('[contenteditable=true] img');await expect(image).toHaveCount(1);
  await expect.poll(()=>image.evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
  await expect(form.locator('.mail-editor-file')).toContainText('review.txt');
  const url=await form.locator('.mail-editor-file a').getAttribute('href');
  const attachment=await page.request.get(base+url);expect(attachment.ok()).toBe(true);
  expect(await attachment.text()).toBe('Synthetic attachment only.');
  await evidence(info,{method:'browser-editor-real-upload-isolated-store',subject,linkPreserved:true,imageDecoded:true,attachmentReadback:true});
});
