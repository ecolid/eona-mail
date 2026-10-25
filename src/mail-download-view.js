// A failed file read belongs to the current workspace, never to page navigation.
export function createMailDownload({fetcher,save,notice=()=>{},owner=()=>0,unauthorized=()=>{}}){
 const pending=new Map();let generation=0;
 return {
  run(path,{name='mail.eml',label='文件'}={}){
   if(pending.has(path))return pending.get(path).promise;
   if(!/^\/api\/(?:email\/\d+\/raw|file\?key=)/.test(path))return Promise.resolve({ok:false});
   const controller=new AbortController(),epoch=generation,identity=owner();
   const current=()=>epoch===generation&&identity===owner();
   const timer=setTimeout(()=>controller.abort(),15000);
   const promise=Promise.resolve().then(async()=>{
    try{
     const response=await fetcher(path,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
     if(response.status===401){unauthorized();throw Error('登录已失效，请重新登录。')}
     if(!response.ok)throw Error(response.status===404?label+'已不可用，当前邮件已保留。':label+'暂时无法下载，请重试。');
     const blob=await response.blob();if(!current()||controller.signal.aborted)return {ok:false,cancelled:true};
     await save(blob,String(name).replace(/[\\/\x00-\x1f]/g,'_').slice(0,180)||'download');
     return {ok:true};
    }catch(error){if(current()&&!controller.signal.aborted)notice(error.name==='TypeError'?'网络连接已中断，请重试下载。':error.message);else if(current())notice('下载读取超时，请重试。');return {ok:false}}
    finally{clearTimeout(timer);if(pending.get(path)?.promise===promise)pending.delete(path)}
   });pending.set(path,{promise,controller});return promise;
  },
  dispose(){generation++;for(const item of pending.values())item.controller.abort();pending.clear()}
 };
}

export function mailDownloadBrowserScript(){return createMailDownload.toString()+`;const mailDownloadURLs=new Map();
const mailDownloads=createMailDownload({fetcher:(...args)=>fetch(...args),owner:()=>MailWorkspace.identityGeneration,unauthorized:()=>{mailResources.clear();show(false)},notice:message=>mailToast(message,{tone:'error'}),save:(blob,name)=>{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.hidden=true;document.body.append(link);link.click();link.remove();const timer=setTimeout(()=>{URL.revokeObjectURL(url);mailDownloadURLs.delete(url)},60000);mailDownloadURLs.set(url,timer)}});
window.addEventListener('pagehide',()=>{mailDownloads.dispose();for(const [url,timer]of mailDownloadURLs){clearTimeout(timer);URL.revokeObjectURL(url)}mailDownloadURLs.clear()});
async function downloadMailResource(node,path,options){if(node.getAttribute('aria-busy')==='true')return;const disabled=node.disabled;node.setAttribute('aria-busy','true');if('disabled'in node)node.disabled=true;try{await mailDownloads.run(path,options)}finally{node.removeAttribute('aria-busy');if('disabled'in node)node.disabled=disabled}}
`;}
