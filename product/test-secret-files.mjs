import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {loadSecrets,validateConfig} from './config.mjs';

test('referenced credentials rotate without rewriting instance or role; Python and JS agree',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mail-secret-'));
 try{
  const config={schema:1,mode:'personal',origin:'http://localhost:8787',data_root:'.',owner:{id:'owner',email:'owner@example.test'},auth:{mode:'local'},secrets_file:'role.json',secret_files:[{path:'provider.env',format:'env'},{path:'identity.json',format:'json',keys:{MAIL_OIDC_SECRET:'/origins/https:~1~1mail.test/secret'}}]};
  await writeFile(join(root,'role.json'),JSON.stringify({MAIL_WORKER_TOKEN:'role',MAIL_OVERRIDE:'saved'}));
  await writeFile(join(root,'identity.json'),JSON.stringify({origins:{'https://mail.test':{secret:'oidc'}}}));
  await writeFile(join(root,'provider.env'),'MAIL_PROVIDER_PASSWORD="old"\nMAIL_OVERRIDE=provider\nMAIL_LITERAL=$(never-evaluated)\n');
  const path=join(root,'config.json');await writeFile(path,JSON.stringify(config));
  const checked=validateConfig(config,{base:root});assert.equal((await loadSecrets(checked,{}))('MAIL_PROVIDER_PASSWORD'),'old');
  await writeFile(join(root,'provider.env'),'MAIL_PROVIDER_PASSWORD=new\nMAIL_OVERRIDE=provider\nMAIL_LITERAL=$(never-evaluated)\n');
  const current=await loadSecrets(checked,{MAIL_OIDC_SECRET:'environment'});assert.equal(current('MAIL_PROVIDER_PASSWORD'),'new');assert.equal(current('MAIL_OVERRIDE'),'saved');assert.equal(current('MAIL_OIDC_SECRET'),'environment');assert.equal(current('MAIL_LITERAL'),'$(never-evaluated)');
  const script="import importlib.util,json,pathlib; p=pathlib.Path('"+new URL('./secret-files.py',import.meta.url).pathname+"');s=importlib.util.spec_from_file_location('secrets',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);c=pathlib.Path('"+path+"');print(json.dumps(m.load(json.loads(c.read_text()),c.parent)))";
  const values=JSON.parse(execFileSync('python3',['-c',script],{encoding:'utf8',env:{PATH:process.env.PATH}}));assert.equal(values.MAIL_PROVIDER_PASSWORD,'new');assert.equal(values.MAIL_OVERRIDE,'saved');assert.equal(values.MAIL_OIDC_SECRET,'oidc');assert.equal(values.MAIL_WORKER_TOKEN,'role');
  await rm(join(root,'provider.env'));await rm(join(root,'identity.json'));const unavailable=await loadSecrets(checked,{});assert.equal(unavailable('MAIL_WORKER_TOKEN'),'role');assert.throws(()=>unavailable('MAIL_PROVIDER_PASSWORD'),/product_secret_missing/);assert.throws(()=>unavailable('MAIL_OIDC_SECRET'),/product_secret_source_unavailable/);
 }finally{await rm(root,{recursive:true,force:true});}
});
