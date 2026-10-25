import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openStore} from './store.mjs';import {sourceHealthAPI,sourceHealth} from './source-health.mjs';
const account={id:'one',address:'owner@example.test',imap:{discovery:'all',folders:[{name:'INBOX',kind:'inbox'}]}};
const fixture=async t=>{const root=await mkdtemp(join(tmpdir(),'mail-health-')),config={mode:'personal',owner:{id:'owner'},accounts:[account],data_root:root,origin:'http://127.0.0.1:8799'},store=await openStore(config);t.after(async()=>{store.close();await rm(root,{recursive:true,force:true})});return {store,config};};
test('coverage remains unknown before inventory; new folders are discovered and gaps are counted, not reported healthy',async t=>{
 const {store,config}=await fixture(t);let time=1000000000000;const options={clock:()=>time};
 assert.equal((await sourceHealth(store.db,config,options)).accounts[0].coverage,'stale');
 const folders=[{name:'INBOX',kind:'inbox'},{name:'项目/归档',kind:'archive'},{name:'Junk',kind:'junk'}];
 await sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'connected',folders},store,config,options);
 let health=await sourceHealth(store.db,config,options);assert.equal(health.accounts[0].folders.length,3);assert.equal(health.accounts[0].coverage,'stale');
 for(const f of folders)await sourceHealthAPI('/internal/product/source-coverage',{account:'one',folder:f.name,validity:'1',uids:f.name==='INBOX'?['1']:[]},store,config,options);
 health=await sourceHealth(store.db,config,options);assert.equal(health.accounts[0].connection,'connected');assert.equal(health.accounts[0].coverage,'incomplete');assert.equal(health.accounts[0].folders[0].missing_count,1);
 time+=300001;health=await sourceHealth(store.db,config,options);assert.equal(health.accounts[0].connection,'stale');assert.equal(health.accounts[0].coverage,'stale');
});
test('failed LIST retains known folders and last success; failed folder cannot report empty/complete',async t=>{
 const {store,config}=await fixture(t),folders=[{name:'INBOX',kind:'inbox'},{name:'Projects',kind:'archive'}];
 await sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'connected',folders},store,config);
 for(const f of folders)await sourceHealthAPI('/internal/product/source-coverage',{account:'one',folder:f.name,validity:'1',uids:[]},store,config);
 assert.equal((await sourceHealth(store.db,config)).accounts[0].coverage,'complete');
 await sourceHealthAPI('/internal/product/source-coverage',{account:'one',folder:'Projects',error:'source_folder_unavailable'},store,config);
 assert.equal((await sourceHealth(store.db,config)).accounts[0].coverage,'error');
 await sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'error',folders:[]},store,config);
 const h=(await sourceHealth(store.db,config)).accounts[0];assert.equal(h.connection,'error');assert.equal(h.folders.length,2);assert.ok(h.last_success);
});
test('discovery does not expand a configured-only account or accept invented write roles',async t=>{
 const {store,config}=await fixture(t);config.accounts=[{...account,imap:{folders:account.imap.folders}}];
 await assert.rejects(()=>sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'connected',folders:[{name:'Other',kind:'archive'}]},store,config),/scope_invalid/);
 config.accounts=[account];await assert.rejects(()=>sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'connected',folders:[{name:'Other',kind:'trash'}]},store,config),/scope_invalid/);
 await assert.rejects(()=>sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'connected',folders:[{name:'INBOX',kind:'archive'}]},store,config),/scope_invalid/);
});
test('UIDVALIDITY changes and a removed directory cannot erase an unresolved original',async t=>{
 const {store,config}=await fixture(t),folders=[...account.imap.folders,{name:'Old project',kind:'archive'}];
 await sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'connected',folders},store,config);
 await store.db.prepare('INSERT INTO product_source_status(account,folder,validity,last_uid,backfill_cursor,backfill_until,state,gaps_json,checked_at) VALUES(?,?,?,?,?,?,?,?,?)').bind('one','Old project','old',9,9,9,'error',JSON.stringify([{uid:'9',validity:'old',historical:true,retry_after:0}]),new Date().toISOString()).run();
 for(const f of folders)await sourceHealthAPI('/internal/product/source-coverage',{account:'one',folder:f.name,validity:'2',uids:[]},store,config);
 let h=(await sourceHealth(store.db,config)).accounts[0];assert.equal(h.coverage,'incomplete');assert.equal(h.folders[1].missing_count,1);
 await sourceHealthAPI('/internal/product/source-inventory',{account:'one',state:'connected',folders:account.imap.folders},store,config);
 h=(await sourceHealth(store.db,config)).accounts[0];assert.equal(h.coverage,'incomplete');assert.equal(h.folders[1].error,'source_directory_removed');assert.equal(h.folders[1].missing_count,1);
});
