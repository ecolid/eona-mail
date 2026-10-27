import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';

const email=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@]+@[^\s<>@]+$/.test(value);
const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(value);
const secretRef=value=>typeof value==='string'&&/^[A-Z][A-Z0-9_]{2,99}$/.test(value);
export function validateConfig(input,{base=process.cwd()}={}){
  if(!input||input.schema!==1||!['personal','demo'].includes(input.mode))throw Error('product_config_invalid');
  const origin=new URL(input.origin);
  if(origin.origin!==input.origin||origin.username||origin.password||!['https:','http:'].includes(origin.protocol))throw Error('product_origin_invalid');
  if(origin.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(origin.hostname))throw Error('product_http_requires_loopback');
  if(!input.data_root||!identifier(input.owner?.id)||!email(input.owner?.email))throw Error('product_owner_or_data_invalid');
  if(input.port!==undefined&&(!Number.isInteger(input.port)||input.port<1024||input.port>65535))throw Error('product_port_invalid');
  if(input.internal_url){const internal=new URL(input.internal_url);if(internal.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(internal.hostname)||internal.origin!==input.internal_url)throw Error('product_internal_url_invalid');}
  const root=resolve(base,input.data_root);
  const accounts=input.accounts||[];
  if(!Array.isArray(accounts)||new Set(accounts.map(a=>a.id)).size!==accounts.length)throw Error('product_accounts_invalid');
  for(const account of accounts){
    if(!identifier(account.id)||!email(account.address)||account.name?.length>200)throw Error('product_account_invalid');
    if(account.sync!==undefined&&(!account.sync||typeof account.sync.enabled!=='boolean'))throw Error('product_account_sync_invalid');
    for(const kind of ['imap','smtp']){
      const transport=account[kind];if(!transport)continue;
      if(typeof transport.host!=='string'||!/^[a-zA-Z0-9.:-]{1,253}$/.test(transport.host)||typeof transport.user!=='string'||/[\r\n]/.test(transport.user)||!secretRef(transport.password_env))throw Error('product_transport_invalid');
      if(kind==='smtp'&&![465,587].includes(transport.port))throw Error('product_smtp_port_invalid');
      if(kind==='imap'&&(transport.port!==993||!Array.isArray(transport.folders)||!transport.folders.length||transport.folders.some(f=>typeof f.name!=='string'||!f.name||f.name.length>300||/[\r\n\0]/.test(f.name)||!['inbox','sent','drafts','trash','archive','junk'].includes(f.kind))))throw Error('product_imap_folders_invalid');
    }
  }
  for(const account of accounts)if(account.imap?.provider!==undefined){
    if(account.imap.provider!=='gmail'||account.imap.host!=='imap.gmail.com')throw Error('product_imap_provider_invalid');
  }
  if(accounts.some(a=>a.imap&&a.imap.discovery!==undefined&&!['configured','all'].includes(a.imap.discovery)))throw Error('product_discovery_invalid');
  if(input.sync!==undefined&&(!input.sync||typeof input.sync.enabled!=='boolean'))throw Error('product_sync_invalid');
  if(accounts.some(a=>a.imap&&new Set(a.imap.folders.map(f=>f.name)).size!==a.imap.folders.length))throw Error('product_duplicate_folder');
  if(input.sync?.enabled&&accounts.some(a=>a.imap&&['inbox','trash'].some(k=>a.imap.folders.filter(f=>f.kind===k).length!==1)))throw Error('product_sync_role_ambiguous');
  if(input.sync?.enabled&&accounts.some(a=>a.imap&&!['sent','drafts','trash'].every(kind=>a.imap.folders.some(f=>f.kind===kind))))throw Error('product_sync_folders_required');
  if(input.mode==='demo'&&input.sync?.enabled)throw Error('demo_external_connections_forbidden');
  if(input.mode==='demo'&&(accounts.length||input.ai||input.notifications||input.readonly_token_env||input.auth?.mode==='oidc'))throw Error('demo_external_connections_forbidden');
  if(input.mode==='personal'&&!['local','oidc'].includes(input.auth?.mode))throw Error('product_auth_required');
  if(input.service_clients!==undefined){
    const clients=input.service_clients, scopes=['mail.read','mail.write','mail.drafts','mail.send','mail.status','mail.events'];
    if(input.mode!=='personal'||!Array.isArray(clients)||clients.length>32||new Set(clients.map(c=>c?.id)).size!==clients.length)throw Error('product_service_clients_invalid');
    for(const c of clients)if(!identifier(c.id)||!secretRef(c.token_env)||!Array.isArray(c.scopes)||!c.scopes.length||c.scopes.some(x=>!scopes.includes(x))||c.allowed_from_ids!==undefined&&(!Array.isArray(c.allowed_from_ids)||c.allowed_from_ids.some(id=>!accounts.some(a=>a.id===id&&a.smtp))))throw Error('product_service_client_invalid');
  }
  if(input.readonly_token_env!==undefined&&!secretRef(input.readonly_token_env))throw Error('product_readonly_token_invalid');
  if(input.auth?.mode==='oidc'){
    if(!input.origin.startsWith('https:')||!input.auth.issuer?.startsWith('https:')||!input.auth.client_id||!secretRef(input.auth.client_secret_env))throw Error('product_oidc_invalid');
    if(input.auth.scopes!==undefined&&(typeof input.auth.scopes!=='string'||!input.auth.scopes.split(/ +/).every(x=>['openid','profile','email','offline_access'].includes(x))||!input.auth.scopes.split(/ +/).includes('openid')))throw Error('product_oidc_scopes_invalid');
    const issuer=new URL(input.auth.issuer);
    if(issuer.username||issuer.password||issuer.search||issuer.hash||typeof input.auth.subject!=='string'||!input.auth.subject||input.auth.subject.length>256||/[\x00-\x1f]/.test(input.auth.subject))throw Error('product_oidc_owner_or_issuer_invalid');
  }
  for(const [key,value]of [['ai',input.ai],['notifications',input.notifications]])if(value){
    const endpoint=new URL(value.endpoint);
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||!secretRef(value.token_env))throw Error('product_'+key+'_invalid');
    if(key==='ai'&&(typeof value.model!=='string'||!value.model))throw Error('product_ai_model_required');
  }
  if(input.secret_files!==undefined&&(!Array.isArray(input.secret_files)||input.secret_files.some(f=>!f||typeof f.path!=='string'||!f.path||!['env','json'].includes(f.format)||f.format==='json'&&(!f.keys||Object.entries(f.keys).some(([k,v])=>!secretRef(k)||typeof v!=='string'||!v.startsWith('/'))))))throw Error('product_secret_files_invalid');
  return {...input,accounts,secret_files:(input.secret_files||[]).map(f=>({...f,path:resolve(base,f.path)})),data_root:root,secrets_file:resolve(base,input.secrets_file||root+'/credentials.json')};
}
export async function readConfig(path){return validateConfig(JSON.parse(await readFile(path,'utf8')),{base:dirname(resolve(path))});}
export async function loadSecrets(config,environment=process.env){
  const values={}, unavailable=new Set();
  for(const file of config.secret_files||[]){
    try{
      const raw=await readFile(file.path,'utf8');if(Buffer.byteLength(raw)>1024*1024)throw Error('secret_file_too_large');
      if(file.format==='env'){
        for(const line of raw.split(/\r?\n/)){const match=line.trim().match(/^([A-Z][A-Z0-9_]{2,99})\s*=(.*)$/);if(match)values[match[1]]=match[2].trim().replace(/^['"]|['"]$/g,'');}
      }else{
        const source=JSON.parse(raw);
        for(const [name,pointer]of Object.entries(file.keys)){let value=source;for(const part of pointer.slice(1).split('/'))value=value?.[part.replace(/~1/g,'/').replace(/~0/g,'~')];if(typeof value==='string'&&value)values[name]=value;else unavailable.add(name);}
      }
    }catch{for(const name of Object.keys(file.keys||{}))unavailable.add(name);}
  }
  Object.assign(values,JSON.parse(await readFile(config.secrets_file,'utf8')));
  return name=>{
    const value=environment[name]??values[name];
    if(typeof value!=='string'||!value)throw Error((unavailable.has(name)?'product_secret_source_unavailable:':'product_secret_missing:')+name);
    return value;
  };
}
export function accountSyncEnabled(config,account){return !!config.sync?.enabled&&account.sync?.enabled!==false;}
export function publicAccounts(config){return config.accounts.map(a=>({id:a.id,address:a.address,name:a.name||'',receive:!!a.imap,send:!!a.smtp,sync:accountSyncEnabled(config,a),folders:(a.imap?.folders||[]).map(f=>({...f}))}));}
