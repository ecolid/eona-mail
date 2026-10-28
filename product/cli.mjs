#!/usr/bin/env node
import {mkdir,writeFile,unlink,access} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {passwordHash} from './local-auth.mjs';
import {readConfig,loadSecrets} from './config.mjs';
import {serveProduct} from './runtime.mjs';
import './sync-mime.mjs';
import {migrateData} from './migration.mjs';
import {pathToFileURL,fileURLToPath} from 'node:url';

export async function initialize({directory,origin,email,mode='personal',password}){
  const root=resolve(directory),file=join(root,'mail.json');
  if(!['personal','demo'].includes(mode))throw Error('invalid_mode');
  try{await access(file);throw Error('configuration_already_exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const owner={id:'owner-'+randomUUID(),email};
  const credentials={MAIL_WORKER_TOKEN:randomBytes(32).toString('base64url')};
  if(mode==='personal')credentials.MAIL_PASSWORD_HASH=await passwordHash(password);
  const config={schema:1,mode,origin,data_root:'./data',secrets_file:'./credentials.json',owner,auth:{mode:'local'},accounts:[]};
  if(mode==='demo')config.demo_limits={max_sessions:16,idle_ms:900000};
  const {validateConfig}=await import('./config.mjs');validateConfig(config,{base:root});
  await mkdir(root,{recursive:true,mode:0o700});
  await writeFile(join(root,'credentials.json'),JSON.stringify(credentials,null,2)+'\n',{flag:'wx',mode:0o600});
  try{await writeFile(file,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});}
  catch(error){await unlink(join(root,'credentials.json'));throw error;}
  return file;
}
export async function workerOnce(path,{fetcher=fetch,task='all'}={}){
  if(!['all','sources','workspace','jobs'].includes(task))throw Error('product_worker_task_invalid');
  const config=await readConfig(path);if(config.mode==='demo')throw Error('demo_has_no_external_worker');
  const secrets=await loadSecrets(config);
  async function runPython(file){return new Promise(resolve=>{
    const child=spawn('python3',[fileURLToPath(new URL(file,import.meta.url)),'--config',resolvePath(path)],{stdio:['ignore','pipe','pipe']});
    const timeout=setTimeout(()=>child.kill(),10*60*1000);timeout.unref();
    let output='';child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536)child.kill();});
    child.stderr.on('data',()=>{});child.on('error',()=>{clearTimeout(timeout);resolve({ok:false})});child.on('exit',code=>{clearTimeout(timeout);resolve({ok:code===0,output:output.trim()})});
  });}
  const result=['all','sources'].includes(task)?await runPython('./imap-worker.py'):null;
  const synchronization=config.sync?.enabled&&['all','workspace'].includes(task)?await runPython('./workspace-worker.py'):null;
  if(!['all','jobs'].includes(task))return {ok:(!result||result.ok)&&(!synchronization||synchronization.ok),sources:result,synchronization,jobs:null};
  const response=await fetcher(new URL('/internal/product/run',config.internal_url||config.origin),{method:'POST',headers:{host:new URL(config.origin).host,authorization:'Bearer '+secrets('MAIL_WORKER_TOKEN')},redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('product_worker_run_failed');
  return {ok:(!result||result.ok)&&(!synchronization||synchronization.ok),sources:result,synchronization,jobs:await response.json()};
}
const resolvePath=path=>resolve(path);
async function main(){
  const [command,...args]=process.argv.slice(2),values={};
  for(let i=0;i<args.length;i++){
    if(['--once','--apply'].includes(args[i])){values[args[i].slice(2)]=true;continue;}
    if(!args[i].startsWith('--')||!args[i+1]||args[i+1].startsWith('--'))throw Error('invalid_arguments');
    values[args[i].slice(2)]=args[++i];
  }
  if(command==='migrate'){
    if(!values.source||!values.owner)throw Error('migration_source_and_owner_required');
    if(values.apply&&(!values.destination||!values['expected-plan']))throw Error('migration_destination_and_plan_required');
    console.log(JSON.stringify(await migrateData({source:values.source,destination:values.destination,owner:values.owner,expectedPlan:values['expected-plan'],apply:!!values.apply})));return;
  }
  if(command==='init'){
    if(!values.directory||!values.origin||!values.email)throw Error('init_requires_directory_origin_email');
    const mode=values.mode||'personal',key=values['password-env']||'MAIL_INITIAL_PASSWORD';
    const file=await initialize({directory:values.directory,origin:values.origin,email:values.email,mode,password:process.env[key]});
    console.log(JSON.stringify({config:file,mode}));return;
  }
  if(!values.config)throw Error('config_argument_required');
  if(command==='serve'){
    const app=await serveProduct(values.config);console.log(JSON.stringify({product:'mail',origin:app.config.origin,mode:app.config.mode}));
    let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);return;
  }
  if(command==='worker'){
    if(values.task&&!['all','sources','workspace','jobs'].includes(values.task))throw Error('product_worker_task_invalid');
    do{try{const result=await workerOnce(values.config,{task:values.task||'all'});console.log(JSON.stringify(result));if(values.once&&!result.ok)process.exitCode=1;}catch{console.log(JSON.stringify({error:'product_worker_failed'}));if(values.once)process.exitCode=1;}
      if(!values.once)await new Promise(resolve=>setTimeout(resolve,30000));
    }while(!values.once);return;
  }
  throw Error('unknown_command');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)main().catch(error=>{console.error(JSON.stringify({error:error.message}));process.exitCode=1;});
