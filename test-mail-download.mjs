import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailDownload} from './src/mail-download-view.js';

test('missing originals and attachments report a local failure and never trigger a download',async()=>{
 const saves=[],notices=[];const download=createMailDownload({fetcher:async()=>new Response('gone',{status:404}),save:(...args)=>saves.push(args),notice:m=>notices.push(m)});
 assert.equal((await download.run('/api/email/42/raw',{label:'原始邮件'})).ok,false);
 assert.equal((await download.run('/api/file?key=att%2Fgone',{label:'附件'})).ok,false);
 assert.equal(saves.length,0);assert.match(notices[0],/原始邮件已不可用/);assert.match(notices[1],/附件已不可用/);
});
test('duplicate activation coalesces while a real body is pending; a later attempt can retry',async()=>{
 let finish,calls=0;const saved=[];const download=createMailDownload({fetcher:async()=>{calls++;await new Promise(r=>finish=r);return new Response('original')},save:async(blob,name)=>saved.push([await blob.text(),name])});
 const a=download.run('/api/email/42/raw',{name:'mail-42.eml'}),b=download.run('/api/email/42/raw');assert.equal(a,b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);finish();await a;
 assert.deepEqual(saved,[['original','mail-42.eml']]);const again=download.run('/api/email/42/raw');await new Promise(r=>setImmediate(r));assert.equal(calls,2);finish();assert.equal((await again).ok,true);
});
test('an interrupted body, changed owner and disposed page cannot save the wrong account data',async()=>{
 let current='owner-a',saveCount=0,complete;const notices=[];
 const download=createMailDownload({owner:()=>current,fetcher:async()=>({ok:true,status:200,blob:()=>new Promise(r=>complete=r)}),save:()=>saveCount++,notice:m=>notices.push(m)});
 const reading=download.run('/api/email/1/raw');await new Promise(r=>setImmediate(r));current='owner-b';complete(new Blob(['old']));assert.equal((await reading).cancelled,true);assert.equal(saveCount,0);assert.deepEqual(notices,[]);
 const disposed=download.run('/api/email/2/raw');await new Promise(r=>setImmediate(r));download.dispose();complete(new Blob(['old']));assert.equal((await disposed).cancelled,true);assert.equal(saveCount,0);
 const broken=createMailDownload({fetcher:async()=>({ok:true,status:200,blob:async()=>{throw new TypeError('interrupted')}}),save:()=>saveCount++,notice:m=>notices.push(m)});
 assert.equal((await broken.run('/api/email/3/raw')).ok,false);assert.match(notices.at(-1),/网络连接已中断/);assert.equal(saveCount,0);
});
