import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {once} from 'node:events';
const source=resolve(process.env.MAIL_PRODUCT_ROOT||'.');
const {serveProduct}=await import(pathToFileURL(join(source,'product/runtime.mjs')));
const {passwordHash}=await import(pathToFileURL(join(source,'product/local-auth.mjs')));

test('untrusted mail image GET cannot mark another mail read, while explicit reading persists',async({browser})=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const root=await mkdtemp(join(tmpdir(),'mail-security-')),origin='http://127.0.0.1:'+port,password='synthetic-browser-password';
 let app,context,externalCalls=0;
 try{
  const hash=await passwordHash(password);
  app=await serveProduct({schema:1,mode:'personal',origin,port,owner:{id:'owner',email:'owner@example.test'},auth:{mode:'local'},data_root:root,accounts:[],ai:{endpoint:'https://model.example.test',token_env:'AI_TOKEN',model:'synthetic'}},{secrets:()=>hash,fetcher:()=>{externalCalls++;throw Error('unexpected_external_network')}});
  await app.store.objects.put('synthetic-html','<img src="'+origin+'/api/email/2" width="1" height="1"><img src="'+origin+'/api/ai-backfill?limit=20"><img src="'+origin+'/api/test-push"><p>Synthetic untrusted content</p>',{httpMetadata:{contentType:'text/html'}});
  for(const [id,subject,html]of[[1,'Untrusted synthetic mail','synthetic-html'],[2,'Unopened synthetic target',null]])await app.store.db.prepare("INSERT INTO emails(id,alias,from_addr,subject,text_body,html_key,is_read,received_at) VALUES(?,'owner@example.test','sender@example.test',?,'Synthetic body',?,0,'2026-10-28 00:00:00')").bind(id,subject,html).run();
  context=await browser.newContext();const login=await context.request.post(origin+'/api/login',{data:{password}});expect(login.status()).toBe(200);
  const page=await context.newPage(),images=[],writes=[],errors=[],actions=[];
  page.on('response',response=>{const path=new URL(response.url()).pathname;if(['/api/ai-backfill','/api/test-push'].includes(path))actions.push({path,status:response.status()});});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  page.on('request',request=>{const url=new URL(request.url());if(url.pathname==='/api/email/2'&&request.resourceType()==='image')images.push(url.pathname);if(request.method()==='POST'&&url.pathname.endsWith('/read'))writes.push(url.pathname);});
  await page.goto(origin);await page.locator('[data-mail-id="1"]').first().click();
  await expect.poll(()=>images.length).toBeGreaterThan(0);
  await expect.poll(()=>actions.length).toBe(2);expect(actions.every(x=>x.status===405)).toBe(true);expect(externalCalls).toBe(0);
  expect((await app.store.db.prepare('SELECT is_read FROM emails WHERE id=2').first()).is_read).toBe(0);
  await expect.poll(async()=>(await app.store.db.prepare('SELECT is_read FROM emails WHERE id=1').first()).is_read).toBe(1);
  expect(writes).toContain('/api/email/1/read');
  await page.locator('[data-mail-id="2"]').first().click();
  await expect.poll(async()=>(await app.store.db.prepare('SELECT is_read FROM emails WHERE id=2').first()).is_read).toBe(1);
  expect(writes).toContain('/api/email/2/read');expect(errors).toEqual([]);
 }finally{await context?.close();await app?.close();await rm(root,{recursive:true,force:true});}
});
