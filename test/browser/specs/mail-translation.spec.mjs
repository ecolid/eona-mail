import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {serveProduct} from '../../../product/runtime.mjs';
import {passwordHash} from '../../../product/local-auth.mjs';
import {cachedSegments} from '../../../src/translation-cache.js';
import {inlineSourceHash} from '../../../src/translation-inline.js';
import {splitTranslationNode} from '../../../src/mail-translation-view.js';

test('reads and restores a long plain text translation in Mail',async({browser})=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const root=await mkdtemp(join(tmpdir(),'mail-translation-'));
 const origin='http://127.0.0.1:'+port,password='synthetic-browser-password';
 const subject='Synthetic long newsletter';
 const body=Array.from({length:115},(_,i)=>'Section '+i+' with enough English text to exercise splitting an actual mail reader text node.').join('\n');
 const parts=splitTranslationNode(body);
 expect(body.length).toBeGreaterThan(8000);
 expect(parts.length).toBeGreaterThan(1);
 expect(parts.join('')).toBe(body);
 const pieces=parts.map((raw,i)=>({raw,source:raw.trim(),text:'第'+(i+1)+'段，保留 $& 和 $2。'}));
 const expected=pieces.map(part=>part.raw.replace(part.source,()=>part.text)).join('');
 let app,context;
 try{
  const hash=await passwordHash(password);
  app=await serveProduct({schema:1,mode:'personal',origin,port,owner:{id:'owner',email:'owner@example.test'},auth:{mode:'local'},data_root:root,accounts:[]},{secrets:()=>hash});
  const db=app.store.db;
  await db.prepare("INSERT INTO emails(id,alias,from_addr,subject,text_body,is_read,received_at) VALUES(1,'owner@example.test','sender@example.test',?,?,0,'2026-10-28 00:00:00')").bind(subject,body).run();
  await cachedSegments({MAILDB:db},1,[subject],{cacheOnly:true});
  for(const row of [{source:subject,text:'长信主题'},...pieces]){
   await db.prepare('INSERT INTO translation_segment_cache(email_id,source_hash,source_text,translated,model) VALUES(1,?,?,?,?)')
    .bind(await inlineSourceHash([row.source]),row.source,row.text,'fixture').run();
  }
  context=await browser.newContext();
  expect((await context.request.post(origin+'/api/login',{data:{password}})).status()).toBe(200);
  const page=await context.newPage();
  const requests=[];
  page.on('response',response=>{if(new URL(response.url()).pathname==='/api/email/1/translate')requests.push(response.status());});
  await page.goto(origin);await page.locator('[data-mail-id="1"]').first().click();
  const content=page.locator('#vbody pre');
  await expect.poll(()=>content.textContent()).toBe(body);
  let observed,released;
  const firstRequest=new Promise(resolve=>{observed=resolve;});
  const releaseFirst=new Promise(resolve=>{released=resolve;});
  await page.route('**/api/email/1/translate',async route=>{
   if(observed){
    observed();observed=null;
    await releaseFirst;
    await route.continue().catch(()=>{});
   }else await route.continue();
  });
  await page.getByRole('button',{name:'全文翻译'}).click();
  try{
   await firstRequest;
   await page.evaluate(()=>{
    document.querySelector('#vtrans [data-translation-action="dismiss"]').click();
    document.querySelector('#vtrans [data-translation-action="translate"]').click();
   });
  }finally{released();}
  await expect(page.getByRole('button',{name:'显示原文'})).toBeVisible();
  await expect.poll(()=>content.textContent()).toBe(expected);
  await expect(page.locator('#vhead h2')).toHaveText('长信主题');
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.every(status=>status===200)).toBe(true);
  await page.getByRole('button',{name:'显示原文'}).click();
  await expect.poll(()=>content.textContent()).toBe(body);
  await page.getByRole('button',{name:'显示译文'}).click();
  await expect.poll(()=>content.textContent()).toBe(expected);
 }finally{await context?.close();await app?.close();await rm(root,{recursive:true,force:true});}
});

test('reads legacy body and subject-only translations with the normal reader controls',async({browser})=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const root=await mkdtemp(join(tmpdir(),'mail-translation-history-'));
 const origin='http://127.0.0.1:'+port,password='synthetic-browser-password';
 let app,context;
 try{
  const hash=await passwordHash(password);
  app=await serveProduct({schema:1,mode:'personal',origin,port,owner:{id:'owner',email:'owner@example.test'},auth:{mode:'local'},data_root:root,accounts:[]},{secrets:()=>hash});
  const db=app.store.db;
  const subject='配送のお知らせ';
  const deliver='Your parcel has been delivered.';
  const insert=db.prepare("INSERT INTO emails(id,alias,from_addr,subject,text_body,is_read,received_at) VALUES(?,'owner@example.test','sender@example.test',?,?,1,'2026-10-28 00:00:00')");
  await insert.bind(1,'Delivery',deliver).run();
  await insert.bind(2,subject,'').run();
  await db.exec("CREATE TABLE IF NOT EXISTS translations(email_id INTEGER PRIMARY KEY,lang TEXT,model TEXT,paragraphs TEXT,translated TEXT,truncated INTEGER)");
  await db.prepare('INSERT INTO translations(email_id,lang,model,paragraphs,translated,truncated) VALUES(?,\'zh\',?,?,?,0)').bind(1,'fixture',JSON.stringify([deliver]),'["您的包裹已送达。"]').run();
  await cachedSegments({MAILDB:db},2,[subject],{cacheOnly:true});
  await db.prepare('INSERT INTO translation_segment_cache(email_id,source_hash,source_text,translated,model) VALUES(2,?,?,?,?)')
   .bind(await inlineSourceHash([subject]),subject,'配送通知','fixture').run();
  context=await browser.newContext();
  expect((await context.request.post(origin+'/api/login',{data:{password}})).status()).toBe(200);
  const page=await context.newPage();
  await page.goto(origin+'/?mail=1');
  await page.getByRole('button',{name:'全文翻译'}).click();
  await expect(page.locator('#vbody pre:visible')).toHaveText('您的包裹已送达。');
  await page.getByRole('button',{name:'显示原文'}).click();
  await expect(page.locator('#vbody pre:visible')).toHaveText(deliver);
  await page.goto(origin+'/?mail=2');
  await page.getByRole('button',{name:'全文翻译'}).click();
  await expect(page.locator('#vhead h2')).toHaveText('配送通知');
  await page.getByRole('button',{name:'显示原文'}).click();
  await expect(page.locator('#vhead h2')).toHaveText(subject);
 }finally{await context?.close();await app?.close();await rm(root,{recursive:true,force:true});}
});
