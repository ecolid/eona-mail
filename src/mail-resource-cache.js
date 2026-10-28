// Private, bounded, session-only cache. Navigation reads are immediate; expiry
// starts one background validation. Explicit refresh and recovery reads await it.
export function createMailResourceCache(load,{now=Date.now,changed=()=>{},failed=()=>{},limit=80}={}){
 const entries=new Map();let generation=0;
 const keyFor=path=>{const u=new URL(path,'https://mail.invalid');u.searchParams.delete('fresh');return u.pathname+u.search};
 const matchesScope=(key,prefix)=>prefix==='/api/mail-workspace'||/^\/api\/email\/\d+$/.test(prefix)?key===prefix||key.startsWith(prefix+'?'):key.startsWith(prefix);
 const ttl=path=>path.startsWith('/api/mail-workspace/correspondence?')&&!/[?&]offset=/.test(path)?60000:/^\/api\/(email\/\d+(?:\/html\?format=json)?|mail-workspace\/sent\/[a-zA-Z0-9-]+)$/.test(path)?300000:/^\/api\/(emails|mail-workspace\/sent)(\?|$)/.test(path)?30000:/^\/api\/mail-workspace(\?|$)/.test(path)?30000:/^\/api\/(aliases|routes|mail-layout|search\/options)(\?|$)/.test(path)?60000:0;
 const refresh=(path,options={})=>{
  const key=keyFor(path);let entry=entries.get(key);if(entry?.pending)return entry.pending;
  if(!entry){entry={at:0,value:undefined,version:0};entries.set(key,entry)}
  const epoch=generation,version=entry.version;
  const pending=Promise.resolve().then(()=>load(path,{...options,etag:entry.etag})).then(result=>{
   if(epoch!==generation||version!==entry.version)throw Object.assign(Error('资料版本已变化，请重新读取。'),{name:'MailReadSuperseded'});
   const previous=entry.value,value=result.unchanged?previous:result.value;
   if(value===undefined)throw Error('缓存校验结果无效');
   const different=previous!==undefined&&JSON.stringify(previous)!==JSON.stringify(value);
   entry.value=value;entry.etag=result.etag;entry.at=now();entry.error=null;
   if(different)changed(key,value);return value;
  }).catch(error=>{if(epoch===generation&&version===entry.version){entry.error=error;failed(key,error)}throw error}).finally(()=>{if(entry.pending===pending)entry.pending=null});
  entry.pending=pending;
  while(entries.size>limit){const candidate=[...entries].find(([k,e])=>k!==key&&!e.pending);if(!candidate)break;entries.delete(candidate[0])}
  return pending;
 };
 return {
  peek:path=>entries.get(keyFor(path))?.value,
  async read(path,options={}){if(!ttl(keyFor(path)))return (await load(path,options)).value;const e=entries.get(keyFor(path));if(!options.fresh&&e?.value!==undefined){if(now()-e.at>=ttl(keyFor(path)))refresh(path,options).catch(()=>{});return structuredClone(e.value)}return structuredClone(await refresh(path,options))},
  invalidate(prefix='',{discard=false}={}){for(const [key,e]of entries)if(matchesScope(key,prefix)){e.at=-Infinity;e.version++;e.pending=null;e.etag=null;if(discard)e.value=undefined}},
  update(prefix,change){for(const [key,e]of entries)if(matchesScope(key,prefix)&&e.value!==undefined)e.value=change(structuredClone(e.value))},
  clear(){generation++;entries.clear()},
 };
}
export function mailMutationPrefixes(path){
 if(/\/drafts\/[^/]+\/editing$/.test(path))return [];
 if(path.startsWith('/api/mail-workspace/settings'))return ['/api/mail-workspace','/api/mail-layout','/api/routes','/api/aliases'];
 if(path.startsWith('/api/mail-workspace/send'))return ['/api/mail-workspace','/api/mail-workspace/sent','/api/mail-workspace/correspondence','/api/emails'];
 if(path.startsWith('/api/mail-workspace/'))return ['/api/mail-workspace'];
 if(path.startsWith('/api/email/')&&['star','unstar'].includes(path.split('/').pop()))return ['/api/emails',path.replace(/\/[^/]+$/,''),'/api/routes','/api/aliases','/api/search/options','/api/mail-workspace'];
 if(path.startsWith('/api/email/'))return ['/api/emails',path.replace(/\/[^/]+$/,''),'/api/routes','/api/aliases','/api/search/options','/api/mail-workspace','/api/mail-workspace/correspondence'];
 return [''];
}
export function mailResourceCacheBrowserScript(){return createMailResourceCache.toString()+';'+mailMutationPrefixes.toString()+';';}
