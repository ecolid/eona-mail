import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

test('standalone Foundation exposes only caller configured applications and account links',async({page},info)=>{
 const root=resolve(process.env.MAIL_PRODUCT_ROOT||fileURLToPath(new URL('../../../',import.meta.url)));
 const js=await readFile(resolve(root,'vendor/eona-foundation/eona-foundation.js'),'utf8');
 const css=await readFile(resolve(root,'vendor/eona-foundation/eona-foundation.css'),'utf8');
 const unexpected=[];
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname!=='127.0.0.1'){unexpected.push(url.origin);return route.abort();}
  return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="zh"><meta charset="utf-8"><body><header style="display:flex;justify-content:space-between;padding:12px"><strong>Mail</strong><div id="tools"></div></header><main>Standalone Foundation</main></body></html>'});
 });
 await page.goto('http://127.0.0.1:8791/__foundation-profile');
 await page.addStyleTag({content:css});await page.addScriptTag({content:js});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:800});
  await page.evaluate(()=>{window.profileTools?.dispose();window.profileTools=EonaUI.mountTools(document.getElementById('tools'));profileTools.setIdentity('first@example.test')});
  await expect(page.getByRole('button',{name:'应用',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'账号：first@example.test',exact:true}).click();
  await expect(page.locator('.e-account-menu a')).toHaveCount(0);await page.keyboard.press('Escape');
  await page.evaluate(()=>{
   profileTools.dispose();window.profileTools=EonaUI.mountTools(document.getElementById('tools'),{applications:[['Mail','https://mail.customer.test/','mail','mail'],['Library','https://library.customer.test/','bookmark','library']],accountUrl:'https://identity.customer.test/settings'});
   profileTools.setIdentity('second@example.test');
  });
  await page.getByRole('button',{name:'应用',exact:true}).click();
  await expect(page.locator('.e-app-grid a')).toHaveCount(2);
  await expect(page.locator('.e-app-grid a svg')).toHaveCount(2);
  await expect(page.locator('.e-app-grid img')).toHaveCount(0);
  expect(await page.locator('.e-app-grid a').evaluateAll(nodes=>nodes.map(n=>n.href))).toEqual(['https://mail.customer.test/','https://library.customer.test/']);
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'账号：second@example.test',exact:true}).click();
  await expect(page.getByRole('link',{name:'账号与安全',exact:true})).toHaveAttribute('href','https://identity.customer.test/settings');
  await page.keyboard.press('Escape');
  const box=await page.locator('#tools').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath('standalone-'+width+'.png')});
 }
 expect(unexpected).toEqual([]);
 await page.evaluate(()=>profileTools.dispose());
 await expect(page.locator('.e-tools,.e-app-menu,.e-account-menu')).toHaveCount(0);
});
