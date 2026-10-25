// Original bytes and identity stay immutable. These helpers only derive display
// metadata, with provenance supplied by MIME headers or the source mailbox.
export function receivedAtFromDate(value,now=Date.now()){
 const t=Date.parse(String(value||''));
 return Number.isFinite(t)&&t<=now+5*60*1000&&t>=Date.UTC(1990,0,1)?new Date(t).toISOString().slice(0,19).replace('T',' '):null;
}
export function dateFromReceived(value){
 const tail=String(value||'').split(';').pop().trim();return tail&&Number.isFinite(Date.parse(tail))?tail:'';
}
export function mailSourceReceivedAt(parsed,internalDate,now=Date.now()){
 return receivedAtFromDate(parsed.date,now)||(parsed.headers||[]).filter(h=>h.key.toLowerCase()==='received').map(h=>receivedAtFromDate(dateFromReceived(h.value),now)).find(Boolean)||receivedAtFromDate(internalDate,now);
}
function binaryText(bytes){let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return text}
function mimeHeaders(text){const end=text.search(/\r?\n\r?\n/);return text.slice(0,end<0?65536:end).replace(/\r?\n[ \t]+/g,' ')}
function declaredCharsets(text,depth=0,result=new Set()){
 if(depth>12)return result;
 const headers=mimeHeaders(text),type=headers.match(/(?:^|\n)content-type:\s*([^\r\n]*)/i)?.[1]||'';
 const charset=type.match(/(?:^|;)\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
 if(charset)try{result.add(new TextDecoder(charset[1]||charset[2]).encoding)}catch{}
 const boundary=type.match(/(?:^|;)\s*boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
 if(/^multipart\//i.test(type)&&boundary){
  const marker='--'+(boundary[1]||boundary[2]),pattern=new RegExp('(?:^|\\r?\\n)'+marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(--)?[ \\t]*(?:\\r?\\n|$)','g');let start=null,match;
  while((match=pattern.exec(text))){if(start!==null)declaredCharsets(text.slice(start,match.index),depth+1,result);if(match[1]){start=null;break}start=pattern.lastIndex}
  // Legacy provider originals may omit the closing delimiter. The last MIME
  // part still declares its charset; an actual epilogue is never a part.
  if(start!==null)declaredCharsets(text.slice(start),depth+1,result);
 }
 return result;
}
export async function repairMailHeaderEncoding(raw,parsed,parser){
 if(![parsed.subject,parsed.from?.name].some(v=>String(v||'').includes('\ufffd')))return parsed;
 const bytes=raw instanceof Uint8Array?raw:new Uint8Array(raw),text=binaryText(bytes),headers=mimeHeaders(text),charsets=[...declaredCharsets(text)].filter(c=>c!=='utf-8');
 const result={...parsed};
 for(const [key,property] of [['subject','subject'],['from','from']]){
  const old=key==='from'?parsed.from?.name:parsed.subject;if(!String(old||'').includes('\ufffd'))continue;
  const line=headers.split(/\r?\n/).find(h=>h.toLowerCase().startsWith(key+':'));
  let recovered;
  if(line&&charsets.length===1){const value=Uint8Array.from(line,c=>c.charCodeAt(0));try{
   // Valid UTF-8 is never reinterpreted as a legacy charset.
   let validUTF8=true;try{new TextDecoder('utf-8',{fatal:true}).decode(value)}catch{validUTF8=false}
   if(!validUTF8){const decoded=new TextDecoder(charsets[0],{fatal:true}).decode(value);recovered=await parser.parse(new TextEncoder().encode(decoded+'\r\n\r\n'))}
  }catch{}}
  if(key==='subject'&&recovered?.subject&&!recovered.subject.includes('\ufffd'))result[property]=recovered.subject;
  if(key==='from')result.from={...parsed.from,name:recovered?.from?.address===parsed.from?.address&&!recovered.from.name.includes('\ufffd')?recovered.from.name:''};
 }
 return result;
}
