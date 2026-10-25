// Serialize idempotent flag writes while the visible state follows the latest click.
export function createMailToggleQueue(write,{apply,failed=()=>{},settled=()=>{}}){
 const entries=new Map();let epoch=0;
 const drive=async(key,entry,generation)=>{
  try{while(entry.desired!==entry.confirmed){const value=entry.desired;try{await write(key,value,{quiet:entry.quiet});if(generation!==epoch)return;entry.confirmed=value}catch(error){if(generation!==epoch)return;if(entry.desired===value){entry.error=error;entry.desired=entry.confirmed;apply(key,entry.confirmed);failed(error,key,{quiet:entry.quiet})}}}}
  finally{if(generation===epoch&&entries.get(key)===entry){apply(key,entry.confirmed);entries.delete(key);if(!entry.error)settled(key,entry.confirmed,{previous:entry.initial,undoable:entry.undoable,quiet:entry.quiet,current:()=>generation===epoch})}}
  return !entry.error;
 };
 return {
  set(key,value,initial=false,{undoable=true,quiet=false}={}){let entry=entries.get(key);if(!entry){entry={confirmed:!!initial,initial:!!initial,desired:!!value,undoable,quiet};entries.set(key,entry);const generation=epoch;entry.pending=Promise.resolve().then(()=>drive(key,entry,generation))}else{entry.desired=!!value;entry.undoable=undoable;entry.quiet=quiet;}apply(key,entry.desired);return entry.pending},
  pending:key=>entries.get(key)?.desired,
  clear(){epoch++;entries.clear()},
 };
}
