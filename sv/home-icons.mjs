import {readFile} from 'node:fs/promises';

// Only these public brand assets may be fetched before the account check.
// iOS fetches home-screen icons separately from the signed-in mailbox page.
const types={
  'icon-32.png':'image/png',
  'icon-180.png':'image/png',
  'icon-192.png':'image/png',
  'icon-512.png':'image/png',
  'favicon.ico':'image/x-icon',
  'manifest.webmanifest':'application/manifest+json',
};
export async function openMailIcons(publicHost){
  const assets=new Map();
  for(const version of ['mail-v1','mail-v2']){
    for(const [name,type] of Object.entries(types))assets.set('/assets/'+version+'/'+name,{type,body:await readFile(new URL('../assets/'+version+'/'+name,import.meta.url))});
  }
  assets.set('/assets/mail-v1/icon.svg',{type:'image/svg+xml',body:await readFile(new URL('../assets/mail-v1/icon.svg',import.meta.url))});
  assets.set('/apple-touch-icon.png',assets.get('/assets/mail-v2/icon-180.png'));
  assets.set('/favicon.ico',assets.get('/assets/mail-v2/favicon.ico'));
  return request=>{
    const u=new URL(request.url),asset=assets.get(u.pathname);
    if(!asset)return null;
    if(u.hostname!==publicHost)return new Response(null,{status:404,headers:{'cache-control':'no-store'}});
    if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{allow:'GET, HEAD','cache-control':'no-store'}});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{
      'content-type':asset.type,
      'content-length':String(asset.body.length),
      'cache-control':u.pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'public, max-age=3600',
      'x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer',
      ...(asset.type==='image/svg+xml'?{'content-security-policy':"default-src 'none'; sandbox"}:{})
    }});
  };
}
