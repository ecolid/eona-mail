import {buildMailSearch} from './mail-search.js';
import {projectSent} from './mail-send.js';

export function projectSentList(row){
 if(!row)return null;const p=JSON.parse(row.payload_json);
 return {id:row.id,draft_id:row.draft_id,draft_rev:row.draft_rev,from:p.from,to:p.to||[],cc:p.cc||[],bcc:p.bcc||[],subject:p.subject||'',body:String(p.body||'').slice(0,160),attachments:(p.attachments||[]).map(a=>({name:a.name})),raw_url:p.raw_key?'/api/mail-workspace/sent/'+row.id+'/raw':null,state:row.state,created_at:row.created_at,updated_at:row.updated_at};
}

// Reuse the archive query contract over account-owned sent projections. The
// payload remains authoritative; counts, pages and selected membership agree.
export async function mailSentSearch(url,db,owner){
 const raw=url.searchParams.get('q')||'';let query;try{query=buildMailSearch(raw)}catch(error){error.mailQuery=true;throw error}
 const limit=Math.max(1,Math.min(50,Math.floor(Number(url.searchParams.get('limit')))||50)),offset=Math.max(0,Math.min(1000000,Math.floor(Number(url.searchParams.get('offset')))||0));
 const cte=`WITH sent_scope AS (SELECT *,json_extract(payload_json,'$.subject') AS subject,json_extract(payload_json,'$.body') AS text_body,json_extract(payload_json,'$.from.address') AS from_addr,json_extract(payload_json,'$.from.name') AS from_name,json_extract(payload_json,'$.to')||json_extract(payload_json,'$.cc')||json_extract(payload_json,'$.bcc') AS to_addr,json_extract(payload_json,'$.from.address') AS alias,'' AS origin_to,'' AS ai_summary,COALESCE(json_extract(payload_json,'$.attachments'),'[]') AS attachment_keys,CASE WHEN json_array_length(json_extract(payload_json,'$.attachments'))>0 THEN 1 ELSE 0 END AS has_attachments,1 AS is_read,0 AS is_starred,'sent' AS folder,replace(substr(created_at,1,19),'T',' ') AS received_at FROM mail_outbox WHERE owner=? AND state IN ('sent','partial')) `;
 const where=' FROM sent_scope WHERE 1=1'+query.sql,args=[owner,...query.args];
 const total=await db.prepare(cte+'SELECT COUNT(*) AS n'+where).bind(...args).first();
 const page=await db.prepare(cte+'SELECT *'+where+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(...args,limit,offset).all();
 const selected=url.searchParams.get('selected_id');let match=null;
 if(selected)match=await db.prepare(cte+'SELECT *'+where+' AND id=?').bind(...args,selected).first();
 const project=url.searchParams.get('view')==='compact'?projectSentList:projectSent;
 return {messages:page.results.map(project),total:total.n,next:offset+page.results.length<total.n?offset+page.results.length:null,selected_matches:!!match,selected_message:project(match)};
}
