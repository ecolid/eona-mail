// Auth is checked by the caller before any cached private response is read.
const projections=new WeakMap();
export async function mailConditionalRead(request,db,read,scope='archive'){
 let cache=projections.get(db);if(!cache){cache=new Map();projections.set(db,cache)}
 const key=scope+' '+request.url,token=db.changeToken?.(),previous=cache.get(key);
 const respond=entry=>new Response(request.headers.get('if-none-match')===entry.etag?null:entry.body,{status:request.headers.get('if-none-match')===entry.etag?304:200,headers:{'content-type':'application/json',etag:entry.etag,'cache-control':'private,no-cache'}});
 if(token&&previous?.token===token&&Date.now()-previous.at<15000&&request.headers.get('cache-control')!=='no-cache')return respond(previous);
 const response=await read();if(response.status!==200)return response;
 const body=await response.text(),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
 const etag='"'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')+'"',entry={body,etag,token,at:Date.now()};
 cache.set(key,entry);while(cache.size>32)cache.delete(cache.keys().next().value);return respond(entry);
}
