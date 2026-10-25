import {projectDraft} from './mail-send.js';
import {mailDocumentAssets} from './mail-rich-document.js';
export const MAIL_FILE_LIMIT=5*1024*1024,MAIL_TOTAL_LIMIT=15*1024*1024;
export const assetMeta=row=>({id:row.id,name:row.name,type:row.mime,size:row.size,url:'/api/mail-workspace/assets/'+row.id});
export async function mailAssetRequest(request,db,owner,input){
 const path=new URL(request.url).pathname,json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
 const match=/^\/api\/mail-workspace\/assets\/([a-zA-Z0-9-]{1,80})$/.exec(path);
 if(match&&request.method==='GET'){
  const row=await db.prepare('SELECT * FROM mail_assets WHERE owner=? AND id=?').bind(owner,match[1]).first();if(!row)return json({error:'文件不存在或已移除。'},404);
  const bytes=Uint8Array.from(atob(row.data_base64),c=>c.charCodeAt(0));
  return new Response(bytes,{headers:{'content-type':row.mime,'content-length':String(bytes.length),'content-disposition':(/^(image\/(?:png|jpeg|gif|webp))$/.test(row.mime)?'inline':'attachment')+"; filename*=UTF-8''"+encodeURIComponent(row.name),'cache-control':'private,no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 }
 if(match&&request.method==='DELETE'){
  const row=await db.prepare('SELECT * FROM mail_drafts WHERE owner=? AND id=?').bind(owner,input?.draft_id).first();if(!row||row.rev!==input.rev)return json({error:'草稿已有更新，请重新核对。'},409);
  const draft=projectDraft(row),id=match[1];if([...mailDocumentAssets(draft.document),...draft.attachments.map(a=>a.id)].includes(id))return json({error:'请先从草稿移除文件。'},409);
  const pinned=await db.prepare("SELECT id FROM mail_outbox WHERE owner=? AND payload_json LIKE ? UNION ALL SELECT id FROM mail_drafts WHERE owner=? AND envelope_json LIKE ? LIMIT 1").bind(owner,'%'+id+'%',owner,'%'+id+'%').first();if(pinned)return json({ok:true,retained:true});
  await db.prepare('DELETE FROM mail_assets WHERE owner=? AND id=?').bind(owner,id).run();return json({ok:true});
 }
 if(path!=='/api/mail-workspace/assets'||request.method!=='POST')return null;
 const {draft_id,name,type,data}=input||{};
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(draft_id||'')||typeof name!=='string'||!name.trim()||name.length>240||/[\x00-\x1f/\\]/.test(name)||typeof data!=='string'||data.length>Math.ceil(MAIL_FILE_LIMIT/3)*4||!data||!/^[A-Za-z0-9+/]*={0,2}$/.test(data)||data.length%4)return json({error:'文件无效，每个文件最多5MB。'},400);
 const draft=await db.prepare('SELECT * FROM mail_drafts WHERE owner=? AND id=?').bind(owner,draft_id).first();if(!draft)return json({error:'请先保存草稿再添加文件。'},409);
 if(await db.prepare("SELECT id FROM mail_outbox WHERE owner=? AND draft_id=? AND state IN ('sending','unknown') LIMIT 1").bind(owner,draft_id).first())return json({error:'发送结果待确认，暂不能修改附件。'},409);
 const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0)),size=bytes.length;if(size>MAIL_FILE_LIMIT)return json({error:'每个文件最多5MB。'},413);
 const current=projectDraft(draft),used=await readMailAssets(db,owner,draft_id,[...mailDocumentAssets(current.document),...current.attachments.map(a=>a.id)]);if(used.length>=20||used.reduce((n,a)=>n+a.size,0)+size>MAIL_TOTAL_LIMIT)return json({error:'每封最多20个文件、合计15MB。'},413);
 let mime=/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(type||'')?type.toLowerCase():'application/octet-stream';
 const signature=mime==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/gif'?String.fromCharCode(...bytes.slice(0,6)).match(/^GIF8[79]a$/):mime==='image/webp'?String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP':false;
 if(mime.startsWith('image/')&&!signature)return json({error:'正文图片仅支持有效的PNG、JPG、GIF、WebP文件。'},400);
 // Unsafe active types may be attachments, never inline executable content.
 if(!signature&&['text/html','image/svg+xml','application/xhtml+xml'].includes(mime))mime='application/octet-stream';
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const saved=await db.prepare('INSERT INTO mail_assets(owner,id,draft_id,name,mime,size,data_base64,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(size),0) FROM mail_assets WHERE owner=? AND draft_id=?)+?<=? AND (SELECT COUNT(*) FROM mail_assets WHERE owner=? AND draft_id=?)<100').bind(owner,id,draft_id,name,mime,size,data,now,owner,draft_id,size,100*1024*1024,owner,draft_id).run();
 if(!saved.meta.changes)return json({error:'这封草稿的文件存储已满，请新建草稿后再添加。'},413);
 return json({asset:assetMeta({id,name,mime,size})});
}
export async function readMailAssets(db,owner,draftId,ids){
 if(!Array.isArray(ids)||ids.length>20||ids.some(id=>!/^[a-zA-Z0-9-]{1,80}$/.test(id)))throw Error('附件记录无效。');
 const unique=[...new Set(ids)],assets=[];
 for(const id of unique){const row=await db.prepare('SELECT * FROM mail_assets WHERE owner=? AND id=?').bind(owner,id).first();if(!row)throw Error('图片或附件已失效，请重新添加。');assets.push(row)}
 if(assets.reduce((n,a)=>n+a.size,0)>MAIL_TOTAL_LIMIT)throw Error('附件合计超过15MB。');return assets;
}
