// Structured editor input is rendered from an allowlist; browser HTML is never trusted.
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function mailAssetId(src){const m=/^(?:https?:\/\/[^/]+)?\/api\/mail-workspace\/assets\/([a-zA-Z0-9-]{1,80})$/.exec(String(src));return m?.[1]||null}
const link=value=>/^(?:https?:\/\/|mailto:|tel:)[^\s<>"\x00-\x1f]+$/i.test(String(value))?String(value):null;
const color=value=>/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(String(value))||/^rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)$/.test(String(value));
export function normalizeMailDocument(value){
 if(value==null)return null;
 if(!value||!Array.isArray(value.ops)||value.ops.length>10000||JSON.stringify(value).length>180000)throw Error('邮件排版内容过长或无效。');
 const ops=[];let chars=0;
 for(const op of value.ops){
  let insert;if(typeof op.insert==='string'){chars+=op.insert.length;if(chars>50000)throw Error('邮件正文最多50000字。');insert=op.insert}
  else if(op.insert&&typeof op.insert.image==='string'&&(mailAssetId(op.insert.image)||/^https:\/\/[^\s<>"\x00-\x1f]+$/i.test(op.insert.image)))insert={image:mailAssetId(op.insert.image)?'/api/mail-workspace/assets/'+mailAssetId(op.insert.image):op.insert.image};
  else if(op.insert?.divider===true)insert={divider:true};
  else throw Error('邮件含不支持的插入内容。');
  const a={},raw=op.attributes||{};
  for(const key of ['bold','italic','underline','strike','code','blockquote'])if(raw[key]===true)a[key]=true;
  if(raw['code-block'])a['code-block']=true;
  for(const key of ['color','background'])if(color(raw[key]))a[key]=raw[key];
  if(['serif','monospace'].includes(raw.font))a.font=raw.font;
  if(['small','large','huge'].includes(raw.size))a.size=raw.size;
  if(['sub','super'].includes(raw.script))a.script=raw.script;
  if(link(raw.link))a.link=link(raw.link);
  if([1,2,3,4,5,6].includes(raw.header))a.header=raw.header;
  if(['ordered','bullet','checked','unchecked'].includes(raw.list))a.list=raw.list;
  if(['center','right','justify'].includes(raw.align))a.align=raw.align;
  if(raw.direction==='rtl')a.direction='rtl';
  if(Number.isInteger(raw.indent)&&raw.indent>=1&&raw.indent<=8)a.indent=raw.indent;
  if(typeof insert==='object'&&insert.image)for(const key of ['width','height'])if(/^\d{1,4}$/.test(String(raw[key])))a[key]=String(raw[key]);
  ops.push({...Object.keys(a).length?{attributes:a}:{},insert});
 }
 return {ops};
}
export function mailDocumentAssets(document){return [...new Set((document?.ops||[]).map(o=>mailAssetId(o.insert?.image)).filter(Boolean))]}
export function renderMailDocument(document,{imageSource=id=>'/api/mail-workspace/assets/'+id}={}){
 if(!document)return null;document=normalizeMailDocument(document);
 let lines=[],buffer='',plain='',list=null;
 const closeList=()=>{if(list){lines.push('</'+list+'>');list=null}};
 const line=a=>{
  const style=['margin:0 0 10px','line-height:1.65',a.align?'text-align:'+a.align:'',a.indent?'margin-left:'+a.indent*24+'px':'',a.direction?'direction:rtl':''].filter(Boolean).join(';');
  const tag=a.header?'h'+a.header:a.blockquote?'blockquote':a['code-block']?'pre':'p';
  if(a.list){const kind=a.list==='ordered'?'ol':'ul';if(list!==kind){closeList();lines.push('<'+kind+'>');list=kind}lines.push('<li style="'+style+'">'+(buffer||'<br>')+'</li>')}
  else{closeList();lines.push('<'+tag+' style="'+style+'">'+(buffer||'<br>')+'</'+tag+'>')}
  buffer='';
 };
 for(const op of document.ops){const a=op.attributes||{};
  if(typeof op.insert==='object'){
   if(op.insert.divider){closeList();if(buffer)line({});lines.push('<hr style="border:0;border-top:1px solid #d8dde5;margin:16px 0">');plain+='\n';continue}
   const src=op.insert.image,id=mailAssetId(src),safe=id?imageSource(id):src;
   if(!safe)throw Error('图片已失效，请重新插入。');
   buffer+='<img src="'+escape(safe)+'" alt="图片" style="max-width:100%;height:auto"'+(a.width?' width="'+a.width+'"':'')+'>';plain+='[图片]';continue;
  }
  const parts=op.insert.split('\n');for(let i=0;i<parts.length;i++){
   let html=escape(parts[i]);plain+=parts[i];
   for(const [key,tag]of [['bold','strong'],['italic','em'],['underline','u'],['strike','s'],['code','code']])if(a[key])html='<'+tag+'>'+html+'</'+tag+'>';
   if(a.script)html='<'+(a.script==='sub'?'sub':'sup')+'>'+html+'</'+(a.script==='sub'?'sub':'sup')+'>';
   const style=[a.color?'color:'+a.color:'',a.background?'background-color:'+a.background:'',a.font?'font-family:'+(a.font==='serif'?'Georgia,serif':'monospace'):'',a.size?'font-size:'+({small:'12px',large:'20px',huge:'28px'}[a.size]):''].filter(Boolean).join(';');
   if(style)html='<span style="'+escape(style)+'">'+html+'</span>';
   if(a.link)html='<a href="'+escape(a.link)+'" target="_blank" rel="noopener noreferrer">'+html+'</a>';
   buffer+=html;if(i<parts.length-1){plain+='\n';line(a)}
  }
 }
 if(buffer)line({});closeList();return {html:'<div style="font:15px/1.65 Arial,sans-serif;overflow-wrap:anywhere">'+lines.join('')+'</div>',text:plain.trimEnd()};
}
