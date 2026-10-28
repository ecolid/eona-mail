import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,rm,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openProduct} from './runtime.mjs';
import {openDemoSessions} from './demo-sessions.mjs';
import {validateConfig} from './config.mjs';

const temp=async run=>{const root=await mkdtemp(join(tmpdir(),'mail-demo-lifecycle-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}};
const workspaceNames=async root=>(await readdir(root)).filter(name=>/^[a-f0-9]{64}$/.test(name));
const cookie=response=>response.headers.get('set-cookie')?.split(';')[0];
const request=(app,path='/api/emails',token,method='GET')=>app.handle(new Request(app.config.origin+path,{method,headers:token?{cookie:token}:{}}));
const fixture=closed=>async root=>{await mkdir(root,{recursive:true});await writeFile(join(root,'fixture'),'synthetic');return {async close(){closed.push(root);}};};

test('anonymous scanner traffic cannot allocate workspaces; page admission and idle capacity are bounded',async()=>temp(async root=>{
  let now=Date.now();
  const app=await openProduct({schema:1,mode:'demo',origin:'http://127.0.0.1:18789',owner:{id:'demo-test',email:'demo@example.test'},data_root:root,accounts:[],demo_limits:{max_sessions:1,idle_ms:60000}},{clock:()=>now});
  const directory=join(root,'demo-workspaces');
  try{
    const results=await Promise.all(Array.from({length:200},(_,i)=>request(app,i%2?'/api/unknown-'+i:'/debug/'+i)));
    assert.ok(results.every(r=>[401,404].includes(r.status)));assert.equal((await workspaceNames(directory)).length,0);
    assert.equal((await request(app,'/',null,'HEAD')).status,405);assert.equal((await workspaceNames(directory)).length,0);
    const first=await request(app,'/'),a=cookie(first);assert.equal(first.status,200);assert.match(first.headers.get('set-cookie'),/Max-Age=60/);
    assert.equal((await workspaceNames(directory)).length,1);
    const full=await request(app,'/');assert.equal(full.status,503);assert.equal(full.headers.get('retry-after'),'60');assert.equal((await full.json()).error,'demo_capacity_reached');
    const forged=await request(app,'/api/emails',a.replace(/=.*/,'='+'x'.repeat(43)));assert.equal(forged.status,401);assert.equal((await workspaceNames(directory)).length,1);
    for(let i=0;i<20;i++)assert.equal((await request(app,'/debug/unknown',a)).status,404);
    assert.equal((await workspaceNames(directory)).length,1);
    now+=60001;assert.equal((await request(app,'/api/emails',a)).status,401);assert.equal((await workspaceNames(directory)).length,0);
    const next=await request(app,'/');assert.equal(next.status,200);assert.notEqual(cookie(next),a);
  }finally{await app.close();}
}));

test('demo resource limits cannot alter personal mode or accept unbounded values',()=>{
  const c={schema:1,mode:'demo',origin:'http://127.0.0.1:18789',owner:{id:'demo-test',email:'demo@example.test'},data_root:'/tmp/synthetic',accounts:[]};
  for(const limits of [{max_sessions:0,idle_ms:60000},{max_sessions:65,idle_ms:60000},{max_sessions:1,idle_ms:1},{max_sessions:1,idle_ms:3600001},{max_sessions:1,idle_ms:60000,unknown:1}])assert.throws(()=>validateConfig({...c,demo_limits:limits}),/demo_limits_invalid/);
  assert.throws(()=>validateConfig({...c,mode:'personal',auth:{mode:'local'},demo_limits:{max_sessions:1,idle_ms:60000}}),/demo_limits_invalid/);
});

test('demo logout revokes its workspace, rotates browser namespace and refreshes an active cookie',async()=>temp(async root=>{
  let now=Date.now(),external=0;
  const app=await openProduct({schema:1,mode:'demo',origin:'http://127.0.0.1:18789',owner:{id:'demo-test',email:'demo@example.test'},data_root:root,accounts:[]},{clock:()=>now,fetcher:async()=>{external++;throw Error('unexpected_network');}});
  try{
    const a=cookie(await request(app,'/')),first=await request(app,'/api/emails',a),id=(await first.json()).emails[0].id;
    const page=await(await request(app,'/',a)).text(),namespace=JSON.parse(/window.MailProduct=(\{[^<]+)\<\/script>/.exec(page)[1]).workspaceId;
    assert.match(namespace,/^[a-f0-9]{64}$/);
    assert.equal(first.headers.get('x-mail-workspace'),namespace);
    await request(app,'/api/email/'+id+'/trash',a,'POST');
    now+=1800000;
    const active=await request(app,'/api/emails',a);assert.equal(cookie(active),a);assert.match(active.headers.get('set-cookie'),/Max-Age=3600/);
    now+=1800001;
    assert.equal((await(await request(app,'/api/emails',a)).json()).emails.length,17);
    const logout=await request(app,'/api/logout',a,'POST');assert.equal(logout.headers.getSetCookie().length,1);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
    assert.equal((await workspaceNames(join(root,'demo-workspaces'))).length,0);
    const denied=await request(app,'/api/emails',a);assert.equal(denied.status,401);assert.equal(denied.headers.get('x-mail-workspace'),'expired');
    const old=await request(app,'/',a),b=cookie(old);assert.notEqual(b,a);assert.equal((await(await request(app,'/api/emails',b)).json()).emails.length,18);
    assert.notEqual(old.headers.get('x-mail-workspace'),namespace);
    const rejected=await app.handle(new Request(app.config.origin+'/api/mail-workspace/drafts/stale-write',{method:'PUT',headers:{cookie:b,'content-type':'application/json','x-mail-workspace':namespace},body:JSON.stringify({rev:0,to:'friend@example.test',subject:'Stale draft',body:'Must not enter new workspace',from_id:'demo'})}));
    assert.equal(rejected.status,409);assert.equal((await rejected.json()).error,'workspace_changed');assert.equal(rejected.headers.get('x-mail-workspace'),old.headers.get('x-mail-workspace'));
    assert.ok(!(await(await request(app,'/api/mail-workspace',b)).json()).drafts.some(draft=>draft.id==='stale-write'));
    const nextPage=await(await request(app,'/',b)).text();assert.ok(!nextPage.includes('"workspaceId":"'+namespace+'"'));
    now+=3600001;
    const expired=await Promise.all(Array.from({length:4},()=>request(app,'/api/emails',b)));
    assert.deepEqual(expired.map(response=>response.status),[401,401,401,401]);
    for(const response of expired)assert.equal(response.headers.get('x-mail-workspace'),'expired');
    assert.equal((await workspaceNames(join(root,'demo-workspaces'))).length,0);
    assert.equal((await request(app,'/',b)).status,200);
    assert.equal(external,0);
  }finally{await app.close();}
  assert.equal((await workspaceNames(join(root,'demo-workspaces'))).length,0);
}));

test('demo instances on different localhost ports keep distinct browser cookies',async()=>temp(async root=>{
  const config={schema:1,mode:'demo',owner:{id:'demo-test',email:'demo@example.test'},accounts:[]};
  const options={fetcher:async()=>{throw Error('unexpected_network');}};
  const a=await openProduct({...config,origin:'http://127.0.0.1:18789',data_root:join(root,'a')},options);
  let b;
  try{
    b=await openProduct({...config,origin:'http://127.0.0.1:18790',data_root:join(root,'b')},options);
    const ca=cookie(await request(a,'/')),first=await request(a,'/api/emails',ca),id=(await first.json()).emails[0].id;
    await request(a,'/api/email/'+id+'/trash',ca,'POST');
    assert.equal((await request(b,'/api/emails',ca)).status,401);
    const second=await request(b,'/',ca),cb=cookie(second);assert.notEqual(ca.split('=')[0],cb.split('=')[0]);
    const jar=ca+'; '+cb;
    assert.equal((await(await request(a,'/api/emails',jar)).json()).emails.length,17);
    assert.equal((await(await request(b,'/api/emails',jar)).json()).emails.length,18);
  }finally{await b?.close();await a.close();}
}));

test('concurrent admission reserves the 64 workspace capacity before creating stores',async()=>temp(async root=>{
  const closed=[],sessions=await openDemoSessions({root,create:fixture(closed)});
  const attempts=await Promise.allSettled(Array.from({length:65},()=>sessions.acquire()));
  const leases=attempts.filter(result=>result.status==='fulfilled').map(result=>result.value);
  try{
    assert.equal(leases.length,64);assert.match(attempts.find(result=>result.status==='rejected').reason.message,/demo_capacity_reached/);
    assert.equal((await workspaceNames(root)).length,64);
  }finally{await Promise.all(leases.map(lease=>lease.release()));await sessions.close();}
  assert.equal(closed.length,64);assert.equal(new Set(closed).size,64);assert.equal((await workspaceNames(root)).length,0);
}));

test('expiration and revocation wait for active requests and close each store once',async()=>temp(async root=>{
  let now=0;const closed=[],sessions=await openDemoSessions({root,create:fixture(closed),clock:()=>now,maxSessions:1});
  try{
    const a=await sessions.acquire(),overlap=await sessions.acquire(a.key);now=3600001;
    await assert.rejects(sessions.acquire(a.key),/demo_capacity_reached/);assert.equal(closed.length,0);
    await a.release();assert.equal(closed.length,0);
    await overlap.release();assert.equal(closed.length,1);
    const b=await sessions.acquire();await b.revoke();await b.revoke();assert.equal(closed.length,1);
    await b.release();await b.release();assert.equal(closed.length,2);
  }finally{await sessions.close();}
  assert.equal(closed.length,2);
}));

test('shutdown waits for outstanding leases and is idempotent',async()=>temp(async root=>{
  const closed=[],sessions=await openDemoSessions({root,create:fixture(closed)}),lease=await sessions.acquire();
  let finished=false;const closing=sessions.close().then(()=>{finished=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(closed.length,0);
  await assert.rejects(sessions.acquire(),/demo_closed/);
  await lease.release();await closing;await sessions.close();assert.equal(closed.length,1);
}));

test('idle expired workspaces are reclaimed without another visitor',async()=>temp(async root=>{
  let now=0,notify;const reclaimed=new Promise(resolve=>{notify=resolve;});
  const sessions=await openDemoSessions({root,ttl:10,clock:()=>now,create:async root=>{await mkdir(root,{recursive:true});return {close:async()=>notify()};}});
  let timeout;
  try{
    const lease=await sessions.acquire();await lease.release();now=11;
    await Promise.race([reclaimed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('idle_cleanup_timeout')),2000);})]);
    // Closing also drains a cleanup that has closed the store but is removing files.
    await sessions.close();assert.equal((await workspaceNames(root)).length,0);
  }finally{clearTimeout(timeout);await sessions.close();}
}));

test('a live root cannot be reclaimed; after a process crash only owned directories are removed',async()=>temp(async root=>{
  await mkdir(join(root,'keep'));await writeFile(join(root,'keep','value'),'preserve');
  await symlink(join(root,'keep'),join(root,'a'.repeat(64)));
  const moduleUrl=new URL('./demo-sessions.mjs',import.meta.url).href;
  const program=`import {openDemoSessions} from ${JSON.stringify(moduleUrl)};import {mkdir} from 'node:fs/promises';const sessions=await openDemoSessions({root:${JSON.stringify(root)},create:async root=>{await mkdir(root,{recursive:true});return {close:async()=>{}}}});await sessions.acquire();console.log('ready');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','ignore']});
  let stopped=false;
  try{
    await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('child_not_ready')),10000);child.once('error',error=>{clearTimeout(timeout);reject(error);});child.once('exit',()=>{clearTimeout(timeout);reject(Error('child_exited_before_ready'));});child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});});
    await assert.rejects(openDemoSessions({root,create:fixture([])}),/demo_workspace_in_use/);
    const exited=once(child,'exit');child.kill('SIGKILL');await exited;stopped=true;
    const sessions=await openDemoSessions({root,create:fixture([])});
    try{assert.deepEqual(await workspaceNames(root),['a'.repeat(64)]);assert.equal(await readFile(join(root,'keep','value'),'utf8'),'preserve');}
    finally{await sessions.close();}
  }finally{if(!stopped){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
}));
