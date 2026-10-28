import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SQLiteD1} from '../sv/storage.mjs';
import {openLocalAuth,passwordHash} from './local-auth.mjs';
const password='synthetic-login-password';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'mail-auth-concurrency-'));
 const first=new SQLiteD1(join(root,'auth.sqlite')),second=new SQLiteD1(join(root,'auth.sqlite'));
 t.after(async()=>{first.close();second.close();await rm(root,{recursive:true,force:true});});
 const hash=await passwordHash(password);let time=0;
 const config={origin:'http://127.0.0.1:8789',owner:{id:'owner',email:'owner@example.test'}};
 const options={clock:()=>time};
 const auth=await Promise.all([first,second].map(db=>openLocalAuth(db,config,()=>hash,options)));
 const login=(client,value=password,index=0)=>auth[index%2].route(new Request(config.origin+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:value})}),{client});
 return {first,login,advance:()=>{time+=900001;}};
}
test('local password limit atomically reserves attempts across concurrent connections',async t=>{
 const f=await fixture(t);
 const responses=await Promise.all(Array.from({length:12},(_,i)=>f.login('one','wrong',i)));
 assert.equal(responses.filter(r=>r.status===401).length,5);
 assert.equal(responses.filter(r=>r.status===429).length,7);
 assert.equal((await f.first.prepare('SELECT COUNT(*) n FROM product_login_attempts').first()).n,5);
 assert.equal((await f.login('one')).status,429);
 f.advance();assert.equal((await f.login('one')).status,200);
 assert.equal((await f.first.prepare('SELECT COUNT(*) n FROM product_login_attempts').first()).n,0);
});
test('global password limit also reserves capacity for distinct concurrent clients',async t=>{
 const f=await fixture(t);
 const responses=await Promise.all(Array.from({length:40},(_,i)=>f.login('client-'+i,'wrong',i)));
 assert.equal(responses.filter(r=>r.status===401).length,30);
 assert.equal(responses.filter(r=>r.status===429).length,10);
 assert.equal((await f.first.prepare('SELECT COUNT(*) n FROM product_login_attempts').first()).n,30);
 f.advance();assert.equal((await f.login('new')).status,200);
});
test('successful authentication clears this client failures without clearing others',async t=>{
 const f=await fixture(t);
 assert.equal((await f.login('one','wrong')).status,401);
 assert.equal((await f.login('two','wrong')).status,401);
 const response=await f.login('one');assert.equal(response.status,200);
 assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
 assert.equal((await f.first.prepare('SELECT COUNT(*) n FROM product_login_attempts').first()).n,1);
});

test('legacy Worker login reserves attempts atomically and fails closed on unavailable storage',async t=>{
 const {default:worker}=await import('../src/index.js');
 const db=new SQLiteD1(':memory:');t.after(()=>db.close());
 await db.exec('CREATE TABLE event_log(kind TEXT,detail TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
 const login=(client,storage=db)=>worker.fetch(new Request('https://mail.example.test/api/login',{method:'POST',headers:{'cf-connecting-ip':client,'content-type':'application/json'},body:JSON.stringify({password:'wrong'})}),{MAILDB:storage,INBOX_PASSWORD:password},{});
 const responses=await Promise.all(Array.from({length:12},()=>login('198.51.100.1')));
 assert.equal(responses.filter(r=>r.status===401).length,5);
 assert.equal(responses.filter(r=>r.status===429).length,7);
 const unavailable={prepare(){throw Error('synthetic unavailable storage');}};
 assert.equal((await login('198.51.100.2',unavailable)).status,503);
});
