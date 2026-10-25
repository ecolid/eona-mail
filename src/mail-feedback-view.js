// Mail owns operation identity and recovery; Foundation owns the visible card,
// stack, focus, lifetime and motion. One operation updates its existing card.
export function createMailFeedbackPresenter(present,timers={}){
 const versions=new Map();let serial=0;
 const show=(message,options={})=>{
  const original=options.action,id=options.id||(original?'mail-operation:'+ ++serial:undefined);
  if(id){const previous=versions.get(id);versions.delete(id);versions.set(id,{version:(previous?.version||0)+1,message,tone:options.tone});if(versions.size>128)versions.delete(versions.keys().next().value)}
  let running=null,action;
  if(original?.run)action={label:original.label,run:()=>{
   if(running)return running;
   running=(async()=>{
    let pending=versions.get(id)?.version;const timer=(timers.set||setTimeout)(()=>{if(versions.get(id)?.version===pending){show(original.pending||'正在处理…',{id,tone:'info',duration:0});pending=versions.get(id)?.version}},120);
    try{
     const result=await original.run();
     if(result===false||result?.ok===false){const last=versions.get(id);throw Error(last?.tone==='error'?last.message:'操作未完成，请重试')}
     if(versions.get(id)?.version===pending)show(original.done||'操作已完成',{id,tone:'success'});
    }catch(error){if(versions.get(id)?.version===pending||versions.get(id)?.tone==='error')show(error.message||'操作未完成，请重试',{id,tone:'error',action:original})}
    (timers.clear||clearTimeout)(timer);return false; // A newer state owns this card; the prior action must not close it.
   })().finally(()=>{running=null});return running;
  }};
  const {action:unused,...rest}=options;
  return present(message,{...(action?{countdown:true,duration:12000}:{}),...rest,...(id?{id}:{}),...(action?{action}:{})});
 };
 return show;
}
