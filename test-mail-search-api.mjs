import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker,{fetchWithIdentity} from './src/index.js';
import {SQLiteD1} from './sv/storage.mjs';
function fixture(){
 const db=new SQLiteD1(':memory:');db.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 const env={PUBLIC_HOST:'mail.eona.top',MAILDB:db,INBOX_PASSWORD:'fixture-password',READONLY_TOKENS:'fixture-readonly-'.padEnd(40,'x')};
 const insert=db.db.prepare('INSERT INTO emails(id,alias,from_addr,subject,text_body,to_addr,attachment_keys,received_at,folder) VALUES(?,?,?,?,?,?,?,?,?)');
 for(const [id,folder] of [[1,'inbox'],[2,'inbox'],[3,'trash']])insert.run(id,'owner@example.test','sender@example.test','Only title '+id,'Only body '+id,'Recipient Identity '+id,JSON.stringify([{name:'attachment-only-'+id+'.pdf',key:'att/opaque-hidden'}]),'2026-10-18 00:00:00',folder);
 const call=url=>fetchWithIdentity(new Request('https://mail.eona.top'+url),env,{authenticated:true});return {db,env,call};
}
test('archive API searches recipient and filename, counts and pages from the same predicate',async()=>{
 const s=fixture();try{
  let r=await(await s.call('/api/emails?q='+encodeURIComponent('"Recipient Identity 2" "attachment-only-2"')+'&limit=1')).json();assert.equal(r.total,1);assert.equal(r.emails[0].id,2);assert.deepEqual(r.emails[0].match_fields,['to','filename']);
  r=await(await s.call('/api/emails?q=in:any%20filename:pdf&limit=1')).json();assert.equal(r.total,3);assert.equal(r.emails.length,1);
  const page=await(await s.call('/api/emails?q=in:any%20filename:pdf&limit=1&offset=1')).json();assert.equal(page.total,3);assert.notEqual(page.emails[0].id,r.emails[0].id);
  r=await(await s.call('/api/emails?q=opaque-hidden')).json();assert.equal(r.total,0);
 }finally{s.db.close()}
});
test('selected mail membership follows the full predicate rather than the current page',async()=>{
 const s=fixture();try{
  const read=async query=>(await s.call('/api/emails?'+query)).json();
  let r=await read('q=sender&limit=1&selected_id=1');assert.deepEqual(r.emails.map(e=>e.id),[2]);assert.equal(r.selected_matches,true);assert.equal(r.selected_email.id,1);assert.equal(r.total,2);
  r=await read('q=Only%20title%201&selected_id=1');assert.equal(r.selected_matches,true);
  r=await read('selected_id=1');assert.equal(r.selected_matches,true);
  for(const q of ['q=absent','folder=trash','alias=other@example.test','starred=1','q=to:absent']){r=await read(q+'&selected_id=1');assert.equal(r.selected_matches,false);assert.equal(r.selected_email,null)}
  r=await read('q=in:any&selected_id=3');assert.equal(r.selected_matches,true);assert.equal(r.selected_email.folder,'trash');
  assert.equal((await s.call('/api/emails?selected_id=1%20OR%201=1')).status,400);
 }finally{s.db.close()}
});
test('folder choices follow new and removed source resources; failures never become an empty success',async()=>{
 const s=fixture();try{
  const options=async()=>await(await s.call('/api/search/options')).json();assert.deepEqual((await options()).folders.map(x=>x.value),['inbox','trash']);
  s.db.db.prepare('UPDATE emails SET folder=? WHERE id=2').run('archive');assert.deepEqual((await options()).folders.map(x=>x.value),['archive','inbox','trash']);
  s.db.db.prepare('DELETE FROM emails WHERE id=2').run();assert.deepEqual((await options()).folders.map(x=>x.value),['inbox','trash']);
  const original=s.env.MAILDB;s.env.MAILDB={prepare(){throw Error('source_unavailable')}};await assert.rejects(s.call('/api/search/options'),/source_unavailable/);s.env.MAILDB=original;
  assert.equal((await worker.fetch(new Request('https://mail.eona.top/api/search/options'),s.env)).status,401);
  assert.equal((await worker.fetch(new Request('https://mail.eona.top/api/search/options',{headers:{Authorization:'Bearer '+s.env.READONLY_TOKENS}}),s.env)).status,403);
 }finally{s.db.close()}
});

// A brand in an older subject must not bury the latest message from that sender.
test('list metadata reserves translation controls using the same full-detail rule without exposing extra body',async()=>{
 const s=fixture();try{
  s.db.db.prepare('UPDATE emails SET text_body=? WHERE id=1').run('中文'.repeat(160)+'This is an English mail whose content needs translation.');
  s.db.db.prepare('UPDATE emails SET text_body=? WHERE id=2').run('Please review the full attached English report and confirm this meeting.');
  const r=await(await s.call('/api/emails?selected_id=2')).json();const row=r.emails.find(e=>e.id===2);assert.equal(row.can_translate,true);assert.equal(r.selected_email.can_translate,true);assert.equal('translation_preview'in row,false);assert.equal('text_body'in row,false);
 }finally{s.db.close()}
});
test('mail search defaults to recency; relevance accounts for sender display name and keeps paging stable',async()=>{
 const s=fixture();try{
  s.db.db.exec("DELETE FROM emails");const add=s.db.db.prepare('INSERT INTO emails(id,alias,from_addr,from_name,subject,text_body,received_at,folder) VALUES(?,?,?,?,?,?,?,?)');
  add.run(1,'owner@example.test','sender@example.test','Assistant','Brand monitoring report','Brand','2026-09-01 00:00:00','inbox');
  add.run(2,'owner@example.test','billing@example.test','Brand Cloud','Invoice Payment Confirmation','Payment','2026-10-14 01:45:46','inbox');
  add.run(3,'owner@example.test','billing@example.test','Brand Cloud','Customer Invoice','Invoice','2026-10-14 00:04:10','inbox');
  const read=async query=>await(await s.call('/api/emails?q=brand'+query)).json();
  for(const sort of ['', '&sort=recent','&sort=relevance']){const r=await read(sort);assert.equal(r.total,3);assert.deepEqual(r.emails.map(e=>e.id),[2,3,1]);}
  assert.deepEqual((await read('&limit=1&offset=1')).emails.map(e=>e.id),[3]);
  assert.equal((await s.call('/api/emails?q=brand&sort=invalid')).status,400);
 }finally{s.db.close()}
});

test('ordinary lists carry a bounded plain-body preview before AI metadata is ready',async()=>{
 const s=fixture();try{
 s.db.db.prepare('UPDATE emails SET text_body=?,ai_summary=NULL WHERE id=2').run('正文'.repeat(500));
 const page=await(await s.call('/api/emails')).json(),row=page.emails.find(m=>m.id===2);
 assert.equal(row.body_preview,'正文'.repeat(120));assert.equal(row.text_body,undefined);
 const selected=await(await s.call('/api/emails?limit=1&selected_id=2')).json();assert.equal(selected.selected_email.body_preview,row.body_preview);
 }finally{s.db.close()}
});
