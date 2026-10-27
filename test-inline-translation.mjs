import {test} from 'node:test';import assert from 'node:assert/strict';
import {translateInline,protectTranslationText,validateInlineSegments,validateTranslatedText} from './src/translation-inline.js';
import {fetchWithIdentity,testHooks} from './src/index.js';
import {SQLiteD1} from './sv/storage.mjs';
import {cachedSegments} from './src/translation-cache.js';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const mockAI={run:async(model,input)=>({response:JSON.stringify({items:JSON.parse(input.messages.at(-1).content).items.map(x=>({id:x.id,text:'译文 '+x.text}))}),usage:{prompt_tokens:30,completion_tokens:30}})};
test('translation preserves domains, brands, URLs, prices and verification codes',()=>{const text='OpenAI UptimeRobot servers.eona.top https://example.test/path?token=123 sample@example.test $18.28 2026-10-12 003480';const p=protectTranslationText(text);assert.equal(p.restore(p.source),text);assert.throws(()=>p.restore('译文'),/identifier_missing/);});
test('markers cannot move between segments, duplicate or collide with literal mail text',()=>{
 const a=protectTranslationText('Price $18.28',0),b=protectTranslationText('Code 004210',1);
 assert.throws(()=>b.restore(a.source),/identifier_unknown/);
 assert.throws(()=>a.restore(a.source+' __KEEP_0_0__'),/identifier_duplicate/);
 const text='Literal __KEEP_0__ and __KEEP_0_1__ beside 123%45';
 const p=protectTranslationText(text,2);assert.equal(p.restore(p.source),text);
 assert.equal(protectTranslationText('123$45').restore(protectTranslationText('123$45').source),'123$45');
});
test('protected-only nodes preserve exact dates, brands and codes without a model purchase',async()=>{
 const source=['OpenAI','003480','October 12, 2026 at 1:08 AM (PDT)','https://example.test/link?code=123'];
 const r=await translateInline({AI:{run:async()=>{throw Error('unnecessary_purchase');}}},source);
 assert.deepEqual(r.translated,source);
});
test('fragment repair leaves the protected values outside model output',async()=>{
 let calls=0;
 const r=await translateInline({AI:{run:async(model,input)=>{
  calls++;const packet=JSON.parse(input.messages.at(-1).content);
  if(calls===1)return {response:{items:[{id:0,text:'wrong __KEEP_99_0__'}]}};
  assert(packet.read_only_context);assert.equal(packet.items.length,2);
  assert(packet.items.every(x=>!/__KEEP_|003480|OpenAI/.test(x.text)));
  return {response:{items:packet.items.map((x,i)=>({...x,text:i===0?'登录 ':' 验证码 '}))}};
 }}},['Login OpenAI verification code 003480']);
 assert.equal(r.translated[0],'登录 OpenAI 验证码 003480');
});
test('only invalid items are repaired and every additional call passes the quota gate',async()=>{
 let calls=0,gates=0;const committed=[];
 const r=await translateInline({AI:{run:async(model,input)=>{
  const items=JSON.parse(input.messages.at(-1).content).items;calls++;
  if(calls===1)items[1].text='wrong __KEEP_0_0__';else assert.equal(items.length,1);
  return {response:{items}};
 }}},['Price 123','Code 004210','Hello'],{gate:async()=>{gates++;return true;},onValidated:async(id)=>committed.push(id)});
 assert.deepEqual(r.translated,['Price 123','Code 004210','Hello']);assert.equal(calls,2);assert.equal(gates,2);assert.deepEqual(committed,[0,2,1]);
});
test('validated nodes survive a failed repair and the next request resumes only missing nodes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'translation-partial-'));const db=new SQLiteD1(join(root,'mail.db'));
 try{
  let calls=0;const env={MAILDB:db,AI:{run:async(model,input)=>{calls++;const packet=JSON.parse(input.messages.at(-1).content),items=packet.items;
   return {response:{items:items.map(x=>({...x,text:packet.read_only_context?.includes('__KEEP_')||x.id===1?'wrong __KEEP_99_0__':x.text}))}};
  }}};
  await assert.rejects(cachedSegments(env,1,['Price 123','Code 456','Hello']),/fragment_identifier/);
  assert.equal(await db.prepare('SELECT count(*) n FROM translation_segment_cache').first('n'),2);
  env.AI.run=async(model,input)=>{calls++;const items=JSON.parse(input.messages.at(-1).content).items;assert.equal(items.length,1);return {response:{items}};};
  const r=await cachedSegments(env,1,['Price 123','Code 456','Hello']);assert.deepEqual(r.translated,['Price 123','Code 456','Hello']);assert.equal(calls,3);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
test('full translation splits long input without truncation and checks every segment',async()=>{const source=Array.from({length:25},(_,i)=>'Paragraph '+i+' '+('word '.repeat(80)));let calls=0;const r=await translateInline({AI:{run:async(...args)=>{calls++;return mockAI.run(...args)}},TRANSLATE_MODEL:'@cf/meta/llama-3.3-70b-instruct-fp8-fast'},source);assert.ok(calls>1);assert.equal(r.truncated,false);assert.equal(r.translated.length,source.length);assert.ok(r.translated.at(-1).endsWith(source.at(-1)));});
test('missing IDs cannot be cached as a successful translation',async()=>{await assert.rejects(translateInline({AI:{run:async()=>({response:'{"items":[]}'})}},['First','Second']),/segment_count/);});
test('input bounds and quota prevent unbounded model calls',async()=>{assert.throws(()=>validateInlineSegments(['x'.repeat(8001)]),/size_limit/);let called=false;await assert.rejects(translateInline({AI:{run:async()=>{called=true;}}},['mail'],{gate:async()=>false}),/budget/);assert.equal(called,false);});
test('authenticated root labels own login mode before scripts execute',async()=>{
 const db=new SQLiteD1(':memory:');try{
  const r=await fetchWithIdentity(new Request('https://mail.eona.top/'),{PUBLIC_HOST:'mail.eona.top',MAILDB:db}, {authenticated:true});
  const html=await r.text();assert.equal(r.status,200);assert.match(html,/<body data-account-auth="true" data-mail-density="compact" class="e-ui">/);assert.match(html,/#login\{[^}]*display:none/);assert.match(html,/body\[data-account-auth\] #login\{display:none!important/);assert.equal(r.headers.get('cache-control'),'no-store');
 }finally{db.close()}
});
test('real HTML response permits parent text translation while prohibiting active mail content',async()=>{const source='<table><tr><td>Hello</td></tr></table><script>throw Error("untrusted")</script>';const env={PUBLIC_HOST:'mail.eona.top',MAILDB:{prepare:()=>({bind:()=>({first:async()=>({html_key:'html/test'})})})},ATTACH:{get:async()=>({body:source})}};const r=await fetchWithIdentity(new Request('https://mail.eona.top/api/email/1/html'),env,{authenticated:true});assert.equal(r.status,200);const policy=r.headers.get('content-security-policy');assert.match(policy,/sandbox allow-same-origin;/);assert.match(policy,/script-src 'none'/);assert.match(policy,/connect-src 'none'/);assert.match(policy,/form-action 'none'/);assert.doesNotMatch(policy,/allow-scripts|allow-forms|allow-popups|allow-top-navigation/);const rendered=await r.text();assert.match(rendered,/<td>Hello<\/td>/);assert.doesNotMatch(rendered,/<script\b/);assert.match(source,/<script\b/);assert.equal(r.headers.get('cache-control'),'no-store');});
test('browser input translates once, cache reuses exact source and leaves originals unchanged',async()=>{const root=await mkdtemp(join(tmpdir(),'translation-cache-'));const db=new SQLiteD1(join(root,'mail.db'));try{await db.exec('CREATE TABLE emails(id INTEGER PRIMARY KEY,subject TEXT,text_body TEXT);INSERT INTO emails VALUES(1,\'Monitor is UP: servers.eona.top\',\'Original body\');CREATE TABLE backup_state(k TEXT PRIMARY KEY,v TEXT);CREATE TABLE ai_usage(day TEXT PRIMARY KEY,calls INTEGER,in_tokens INTEGER,out_tokens INTEGER,tr_in_tokens INTEGER,tr_out_tokens INTEGER);');let calls=0;const env={PUBLIC_HOST:'mail.eona.top',MAILDB:db,AI:{run:async(...args)=>{calls++;return mockAI.run(...args);}},AI_DAILY_NEURONS:'8000'};const post=()=>fetchWithIdentity(new Request('https://mail.eona.top/api/email/1/translate',{method:'POST',headers:{origin:'https://mail.eona.top','content-type':'application/json'},body:JSON.stringify({format:'inline-v1',segments:['Hello','Best,']})}),env,{authenticated:true});let r=await post();assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).cached,false);r=await post();assert.equal((await r.json()).cached,true);assert.equal(calls,1);const other=()=>fetchWithIdentity(new Request('https://mail.eona.top/api/email/1/translate',{method:'POST',headers:{origin:'https://mail.eona.top','content-type':'application/json'},body:JSON.stringify({format:'inline-v1',segments:['Another section']})}),env,{authenticated:true});assert.equal((await(await other()).json()).cached,false);assert.equal((await(await post()).json()).cached,true);assert.equal(calls,2);assert.equal(await db.prepare('SELECT count(*) AS n FROM translations_inline_parts').first('n'),2);assert.equal((await db.prepare('SELECT text_body FROM emails WHERE id=1').first()).text_body,'Original body');}finally{db.close();await rm(root,{recursive:true,force:true});}});
test('invalid old cached translation is replaced by validated text',async()=>{
 const root=await mkdtemp(join(tmpdir(),'translation-repair-')),db=new SQLiteD1(join(root,'mail.db'));
 try{const env={MAILDB:db,AI:mockAI};await cachedSegments(env,1,['could replace him? (']);await db.prepare('UPDATE translation_segment_cache SET translated=?').bind('可能取代他（'+']}]]'.repeat(130)).run();assert.equal(await cachedSegments(env,1,['could replace him? ('],{cacheOnly:true}),null);const repaired=await cachedSegments(env,1,['could replace him? (']);assert.equal(repaired.cached,false);assert.equal((await cachedSegments(env,1,['could replace him? ('])).cached,true);}finally{db.close();await rm(root,{recursive:true,force:true});}
});

test('provider JSON tails cannot enter cached prose',()=>{assert.throws(()=>validateTranslatedText('will not renew the contract (','不会续约（"}, {'),/text_invalid/);});

test('session-cached HTML transport preserves the sandbox document and an equally restrictive content policy',async()=>{
 const html='<p>Original mail</p><script>unsafe()</script>',env={MAILDB:{prepare:()=>({bind:()=>({first:async()=>({html_key:'fixture'})})})},ATTACH:{get:async()=>({body:html})}};
 const r=await fetchWithIdentity(new Request('https://mail.eona.top/api/email/1/html?format=json'),env,{authenticated:true});const content=await r.json();assert.match(content.html,/<p>Original mail<\/p>/);assert.doesNotMatch(content.html,/<script\b/);assert.match(html,/<script\b/);for(const directive of ["script-src 'none'","connect-src 'none'","form-action 'none'","base-uri 'none'"])assert(content.policy.includes(directive));assert.equal(r.headers.get('cache-control'),'no-store');
});
