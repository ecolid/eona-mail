import {inlineSourceHash,translateInline,validateInlineSegments,validateTranslatedText} from './translation-inline.js';

// Text-node caches are shared across different browser/background chunk sizes.
export async function cachedSegments(env,emailId,segments,options={}) {
 validateInlineSegments(segments);
 await env.MAILDB.prepare(`CREATE TABLE IF NOT EXISTS translation_segment_cache(
  email_id INTEGER NOT NULL,source_hash TEXT NOT NULL,source_text TEXT NOT NULL,
  translated TEXT NOT NULL,model TEXT,created_at TEXT DEFAULT(datetime('now')),
  PRIMARY KEY(email_id,source_hash))`).run();
 const keys=await Promise.all(segments.map(text=>inlineSourceHash([text])));
 const unique=[...new Set(keys)],found=new Map();
 for(let i=0;i<unique.length;i+=80){
  const slice=unique.slice(i,i+80);
  const {results}=await env.MAILDB.prepare('SELECT * FROM translation_segment_cache WHERE email_id=? AND source_hash IN ('+slice.map(()=>'?').join(',')+')').bind(emailId,...slice).all();
  for(const row of results||[]){try{validateTranslatedText(row.source_text,row.translated);if(!options.refresh)found.set(row.source_hash,row);}catch{}}
 }
 const missing=[];const seen=new Set();
 for(let i=0;i<keys.length;i++)if(!found.has(keys[i])&&!seen.has(keys[i])){seen.add(keys[i]);missing.push({key:keys[i],source:segments[i]});}
 let model=found.values().next().value?.model||'';
 if(missing.length&&options.cacheOnly)return null;
 if(missing.length){
  if(!env.AI)throw Error('translation_unavailable');
  const neighborContext=options.neighborContext||missing.flatMap(x=>{const i=keys.indexOf(x.key);return segments.slice(Math.max(0,i-2),i+3)}).join('\n').slice(0,4000);
  const result=await translateInline(env,missing.map(x=>x.source),{...options,neighborContext,onValidated:async(i,translated,usedModel)=>{
   const x=missing[i];
   await env.MAILDB.prepare(`INSERT INTO translation_segment_cache(email_id,source_hash,source_text,translated,model)
    VALUES(?,?,?,?,?) ON CONFLICT(email_id,source_hash) DO UPDATE SET source_text=excluded.source_text,translated=excluded.translated,model=excluded.model,created_at=datetime('now')`).bind(emailId,x.key,x.source,translated,usedModel).run();
   found.set(x.key,{source_text:x.source,translated,model:usedModel});
   await options.onValidated?.(i,translated,usedModel);
  }});model=result.model;
 }
 const translated=keys.map((key,i)=>{const row=found.get(key);if(row?.source_text!==segments[i]||typeof row.translated!=='string')throw Error('translation_cache_invalid');return row.translated;});
 return {version:1,model,translated,cached:missing.length===0};
}
