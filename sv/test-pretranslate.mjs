import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SQLiteD1} from './storage.mjs';
import {pretranslate,htmlTranslationSegments} from './pretranslate.mjs';
import {cachedInlineTranslation,fetchWithIdentity} from '../src/index.js';
import {protectTranslationText} from '../src/translation-inline.js';

const body='Please review the update. Your project has new information and a status report for this week.';
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'mail-pretranslate-'));const path=join(root,'mail.db');let db=new SQLiteD1(path);
 await db.exec(`CREATE TABLE emails(id INTEGER PRIMARY KEY,subject TEXT,text_body TEXT,html_key TEXT,folder TEXT DEFAULT 'inbox',ai_tries INTEGER DEFAULT 0,created_at TEXT DEFAULT(datetime('now')),received_at TEXT);
 CREATE TABLE backup_state(k TEXT PRIMARY KEY,v TEXT);
 CREATE TABLE ai_usage(day TEXT PRIMARY KEY,calls INTEGER,in_tokens INTEGER,out_tokens INTEGER,tr_in_tokens INTEGER,tr_out_tokens INTEGER);`);
 let calls=0;let chain=Promise.resolve();
 const env={PUBLIC_HOST:'mail.example.invalid',MAILDB:db,MAIL_PRETRANSLATE_ENABLED:'1',AI_DAILY_NEURONS:'8000',AI:{run:async(model,input)=>{
  assert.equal(model,'@cf/meta/llama-3.3-70b-instruct-fp8-fast');calls++;
  return {response:{items:JSON.parse(input.messages.at(-1).content).items.map(x=>({id:x.id,text:'译 '+x.text}))},usage:{prompt_tokens:100,completion_tokens:80}};
 }},TRANSLATION_RUN:fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;}};
 const reopen=()=>{db.close();db=new SQLiteD1(path);env.MAILDB=db;return db;};
 try{await fn({env,get db(){return db;},calls:()=>calls,reopen});}finally{db.close();await rm(root,{recursive:true,force:true});}
}

test('static extraction keeps browser text/entity boundaries and excludes hidden or executable mail',()=>{
 const html='<html><head><style>p{color:red}</style></head><body><p>'+body+'</p><table><tr><td>Tom &amp; Sony</td><td><b>Notice</b> 12</td></tr></table><p hidden>Hidden</p><span style="display: none">Preheader</span><script>fetch("https://example.invalid")</script><svg><text>SVG</text></svg></body></html>';
 assert.deepEqual(htmlTranslationSegments(html),[body,'Tom & Sony','Notice','12']);
 const p=protectTranslationText('Renewal: October 12, 2026 at 1:08 AM (PDT).');
 assert.equal(p.source,'Renewal: __KEEP_0_0__.');assert.equal(p.restore(p.source),'Renewal: October 12, 2026 at 1:08 AM (PDT).');
});

test('new foreign arrivals precompute the exact foreground node cache; older messages stay untouched and classification attempts do not block',()=>fixture(async f=>{
 await f.db.prepare("INSERT INTO emails(id,subject,text_body,created_at,received_at) VALUES(1,'Old mail',?,'2000-01-01','2000-01-01')").bind(body).run();
 const html='<p>'+body+'</p><p>Best,</p><p>Sony</p>';
 const rows=[[2,'Project update',body,'html/new',0],[3,'中文邮件','请查看本周项目进展和状态报告。请查看本周项目进展和状态报告。',null,0],[4,'Historical import',body,null,3],[5,'Late sender date',body,null,0]];
 for(const row of rows)await f.db.prepare('INSERT INTO emails(id,subject,text_body,html_key,ai_tries,received_at) VALUES(?,?,?,?,?,?)').bind(...row,'2001-01-01').run();
 f.env.ATTACH={get:async()=>({size:html.length,text:async()=>html})};
 const before=(await f.db.prepare('SELECT * FROM emails ORDER BY id').all()).results;
 const stats=await pretranslate(f.env,(id,segments)=>cachedInlineTranslation(f.env,id,segments,{automatic:true}),{limit:5});
 assert.equal(stats.queued,3);assert.equal(stats.translated,3);assert.equal(f.calls(),3);
 const post=segments=>fetchWithIdentity(new Request('https://mail.example.invalid/api/email/2/translate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({format:'inline-v1',segments})}),f.env,{authenticated:true});
 const response=await post([body,'Sony']);assert.equal(response.status,200);const data=await response.json();assert.equal(data.cached,true);assert.equal(data.translated.length,3);assert.equal(f.calls(),3);
 assert.deepEqual((await f.db.prepare('SELECT * FROM emails ORDER BY id').all()).results,before);
 f.reopen();const again=await pretranslate(f.env,(id,segments)=>cachedInlineTranslation(f.env,id,segments,{automatic:true}));assert.equal(again.queued,0);assert.equal(again.translated,0);assert.equal(f.calls(),3);
}));

test('quota exhaustion leaves a durable next-day job and calls no model',()=>fixture(async f=>{
 await f.db.prepare('INSERT INTO emails(id,subject,text_body) VALUES(1,?,?)').bind('Project update',body).run();
 f.env.AI_DAILY_NEURONS='1';
 const r=await pretranslate(f.env,(id,segments)=>cachedInlineTranslation(f.env,id,segments,{automatic:true}));
 assert.equal(r.stopped,'translation_budget');assert.equal(f.calls(),0);
 const job=await f.db.prepare('SELECT state,error,next_try FROM mail_pretranslate_jobs WHERE email_id=1').first();
 assert.equal(job.state,'pending');assert.equal(job.error,'translation_budget');assert.ok(job.next_try>new Date().toISOString().slice(0,10));
 f.reopen();await pretranslate(f.env,(id,s)=>cachedInlineTranslation(f.env,id,s,{automatic:true}));assert.equal(f.calls(),0);
}));

test('a failed later chunk resumes completed chunks without paying for them again',()=>fixture(async f=>{
 const segments=Array.from({length:5},(_,i)=>'Paragraph '+i+' '+body.repeat(10));const html=segments.map(x=>'<p>'+x+'</p>').join('');
 await f.db.prepare('INSERT INTO emails(id,subject,text_body,html_key) VALUES(1,?,?,?)').bind('Project update',body,'html/long').run();
 f.env.ATTACH={get:async()=>({size:html.length,text:async()=>html})};let requests=0;
 const translate=async(id,s)=>{if(++requests===2)throw Error('translation_unavailable');return cachedInlineTranslation(f.env,id,s,{automatic:true});};
 await pretranslate(f.env,translate,{limit:1});const firstCalls=f.calls();assert.equal(firstCalls,1);
 const persisted=await f.db.prepare('SELECT count(*) AS n FROM translation_segment_cache').first('n');assert.ok(persisted>1);
 f.reopen();await f.db.prepare("UPDATE mail_pretranslate_jobs SET next_try='' WHERE email_id=1").run();
 const completed=await pretranslate(f.env,(id,s)=>cachedInlineTranslation(f.env,id,s,{automatic:true}),{limit:1});
 assert.equal(completed.translated,1);assert.equal(f.calls(),3);
}));

test('concurrent foreground/background requests share one successful purchase',()=>fixture(async f=>{
 const source=['Project update',body,'Sony'];
 const [a,b]=await Promise.all([cachedInlineTranslation(f.env,1,source,{automatic:true}),cachedInlineTranslation(f.env,1,source)]);
 assert.equal(f.calls(),1);assert.equal(a.cached,false);assert.equal(b.cached,true);assert.deepEqual(a.translated,b.translated);
}));

test('unknown provider usage remains reserved across restarts and stops further purchases',()=>fixture(async f=>{
 let purchases=0;f.env.AI.run=async()=>{purchases++;throw Error('upstream_timeout');};
 await assert.rejects(cachedInlineTranslation(f.env,1,['Project update',body]),/timeout/);
 const key='translation_reserved:'+new Date().toISOString().slice(0,10);
 const reserved=Number(await f.db.prepare('SELECT v FROM backup_state WHERE k=?').bind(key).first('v'));assert.ok(reserved>0);assert.equal(purchases,1);
 f.reopen();f.env.AI_DAILY_NEURONS=String(reserved+1);
 await assert.rejects(cachedInlineTranslation(f.env,2,['Other update',body]),/translation_budget/);assert.equal(purchases,1);
 assert.equal(Number(await f.db.prepare('SELECT v FROM backup_state WHERE k=?').bind(key).first('v')),reserved);
}));

test('a ready mail cache returns while a different background translation is still running',()=>fixture(async f=>{
 const ready=['Project update',body];await cachedInlineTranslation(f.env,1,ready);
 const original=f.env.AI.run;let release,started;
 const running=new Promise(resolve=>{started=resolve;});
 f.env.AI.run=async(...args)=>{started();await new Promise(resolve=>{release=resolve;});return original(...args);};
 const background=cachedInlineTranslation(f.env,2,['Another project',body+' Additional information.'],{automatic:true});
 await running;
 try{
  const result=await Promise.race([cachedInlineTranslation(f.env,1,ready),new Promise((_,reject)=>setTimeout(()=>reject(Error('ready_cache_blocked')),100))]);
  assert.equal(result.cached,true);
 }finally{release();await background;}
}));

test('account-aware queue wakes old budget deferrals and retries a low balance within minutes',()=>fixture(async f=>{
 await f.db.prepare('INSERT INTO emails(id,subject,text_body) VALUES(1,?,?)').bind('Project update',body).run();
 f.env.AI_DAILY_NEURONS='1';
 const translate=(id,s)=>cachedInlineTranslation(f.env,id,s,{automatic:true});
 await pretranslate(f.env,translate);
 f.env.TRANSLATION_QUOTA=async()=>null;
 const retryAt=new Date(Date.now()+240000).toISOString();
 const after=await pretranslate(f.env,async()=>{throw Object.assign(Error('translation_budget'),{budget:{retry_at:retryAt}});});
 assert.equal(after.stopped,'translation_budget');
 const job=await f.db.prepare('SELECT next_try FROM mail_pretranslate_jobs WHERE email_id=1').first();
 assert.equal(job.next_try,retryAt.slice(0,19).replace('T',' '));
 await pretranslate(f.env,()=>assert.fail('fresh pause was replayed prematurely'));
 assert.equal(f.calls(),0);
}));

test('multilingual, subject-only, and overlong HTML arrive in the same durable queue',()=>fixture(async f=>{
 const japanese='ご注文の発送準備が整いました。';
 const korean='주문이 접수되었습니다.';
 const large=Array.from({length:550},(_,i)=>i+'番目の案内の内容をご確認ください。').join('\n');
 const rows=[
  [1,'請確認','中文前言。'+japanese.repeat(8),null],
  [2,korean,'',null],
  [3,'通知','', 'html/large'],
  [4,'中文通知','系统运转正常。暂不需要处理。',null]
 ];
 for(const row of rows)await f.db.prepare('INSERT INTO emails(id,subject,text_body,html_key) VALUES(?,?,?,?)').bind(...row).run();
 f.env.ATTACH={get:async()=>({size:large.length,text:async()=>'<p>'+large+'</p>'})};
 const stats=await pretranslate(f.env,(id,s)=>cachedInlineTranslation(f.env,id,s,{automatic:true}),{limit:6});
 assert.equal(stats.translated,3);
 assert.equal(stats.stopped,'');
 const [titleOnly,long]=await Promise.all([
  f.db.prepare('SELECT translated AS value FROM translation_segment_cache WHERE email_id=2').first('value'),
  f.db.prepare('SELECT count(*) AS n FROM translation_segment_cache WHERE email_id=3').first('n')
 ]);
 assert.match(titleOnly,/^译 /u);
 assert(long>2);
 assert.equal(await f.db.prepare('SELECT count(*) AS n FROM mail_pretranslate_jobs WHERE state!=\'done\'').first('n'),0);
}));

test('a transient failed mail leaves a retry and the next due mail can finish',()=>fixture(async f=>{
 for(const id of [1,2])await f.db.prepare('INSERT INTO emails(id,subject,text_body) VALUES(?,?,?)').bind(id,'Status update',body).run();
 const translate=(id,s)=>id===2?Promise.reject(Error('translation_unavailable')):cachedInlineTranslation(f.env,id,s,{automatic:true});
 const stats=await pretranslate(f.env,translate);
 assert.equal(stats.translated,1);
 const rows=(await f.db.prepare('SELECT state,error FROM mail_pretranslate_jobs ORDER BY email_id').all()).results;
 assert.deepEqual(rows.map(row=>({...row})),[{state:'done',error:null},{state:'pending',error:'translation_unavailable'}]);
}));
