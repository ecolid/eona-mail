import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from './store.mjs';
import {planMigration,migrateData} from './migration.mjs';
const owner={id:'owner-migration',email:'owner@example.test'};
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'mail-migration-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'legacy'),config={mode:'personal',origin:'http://127.0.0.1:18789',owner,data_root:source,accounts:[{id:'one',address:owner.email,imap:{folders:[{name:'INBOX',kind:'inbox'}]}}]};
 const store=await openStore(config);const raw=Buffer.from('Message-ID: <migration@example.test>\r\nFrom: sender@example.test\r\nTo: owner@example.test\r\nSubject: retained original\r\n\r\nOriginal body\r\n');
 const result=await store.ingest(raw,{account:'one',folder:'INBOX',validity:'8',uid:'1',kind:'inbox',historical:true,internal_date:'2014-02-07T07:30:56Z'});
 await store.db.prepare("INSERT INTO mail_drafts(owner,id,to_addr,subject,body,rev,updated_at,envelope_json) VALUES(?,'editing','x@example.test','Do not overwrite','Unsaved elsewhere',7,'2026-10-25','{}')").bind(owner.id).run();
 await store.db.exec('DROP TABLE product_meta');store.close();return {root,source,config,id:result.id};
}
test('migration preserves identities, originals and draft revisions and opens independently',async t=>{
 const f=await fixture(t),plan=await planMigration(f.source,owner.id),destination=join(f.root,'independent');
 const dry=await migrateData({source:f.source,owner:owner.id});assert.equal(dry.sha256,plan.sha256);await assert.rejects(access(destination));
 const receipt=await migrateData({source:f.source,destination,owner:owner.id,expectedPlan:plan.sha256,apply:true});assert.equal(receipt.originalsVerified,1);
 assert.equal((await planMigration(f.source,owner.id)).sha256,plan.sha256);
 const app=await openStore({...f.config,data_root:destination});t.after(()=>app.close());
 assert.equal((await app.db.prepare('SELECT id FROM emails').first()).id,f.id);
 assert.equal((await app.db.prepare("SELECT rev FROM mail_drafts WHERE id='editing'").first()).rev,7);
 const again=await app.ingest(Buffer.from('Message-ID: <migration@example.test>\r\nFrom: sender@example.test\r\nTo: owner@example.test\r\nSubject: retained original\r\n\r\nOriginal body\r\n'),{account:'one',folder:'INBOX',validity:'8',uid:'2',kind:'inbox',historical:true,internal_date:'2014-02-07T07:30:56Z'});assert.equal(again.id,f.id);
 await assert.rejects(()=>migrateData({source:f.source,destination,owner:owner.id,expectedPlan:plan.sha256,apply:true}),/destination_exists/);
});
test('migration refuses a changed source, wrong owner and missing originals',async t=>{
 const f=await fixture(t),plan=await planMigration(f.source,owner.id),destination=join(f.root,'refused');
 await assert.rejects(()=>planMigration(f.source,'another-owner'),/owner_mismatch/);
 const db=new DatabaseSync(join(f.source,'mail.db'));db.prepare("UPDATE mail_drafts SET body='New user edit',rev=8 WHERE id='editing'").run();db.close();
 await assert.rejects(()=>migrateData({source:f.source,destination,owner:owner.id,expectedPlan:plan.sha256,apply:true}),/source_changed/);await assert.rejects(access(destination));
 const newPlan=await planMigration(f.source,owner.id);await rm(join(f.source,'objects'),{recursive:true});
 await assert.rejects(()=>migrateData({source:f.source,destination,owner:owner.id,expectedPlan:newPlan.sha256,apply:true}));await assert.rejects(access(destination));
});
