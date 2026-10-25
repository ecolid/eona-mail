// Parse once and bind the complete query as JSON. INSTR treats wildcards literally.
export function mailSearchTerms(value) {
 return [...String(value||'').normalize('NFKC').trim().slice(0,500).matchAll(/(-?)(?:(from|to|subject|body|summary|filename|attachment|in|after|before|is|has):)?("[^"]*"|[^\s]+)/gi)].map(m=>({exclude:!!m[1],field:(m[2]||'').toLowerCase(),value:m[3].replace(/^"|"$/g,'')})).filter(t=>t.value);
}
export function buildMailSearch(value) {
 if(String(value||'').length>500)throw Error('搜索条件最多500个字符');
 const terms=mailSearchTerms(value);if(!terms.length)return {sql:'',args:[],rank:'0+0',rankArgs:[],terms};
 const normalized=terms.map(term=>{const t={...term};
  if(t.field==='after'||t.field==='before'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(t.value)||!Number.isFinite(Date.parse(t.value))||new Date(t.value).toISOString().slice(0,10)!==t.value)throw Error('日期请使用 YYYY-MM-DD');
   t.value=new Date(Date.parse(t.value)-8*3600000).toISOString().slice(0,19).replace('T',' ');
  }else if(t.field==='is'){t.value=t.value.toLowerCase();if(!['unread','read','starred'].includes(t.value))throw Error('is 支持 unread、read、starred');}
  else if(t.field==='has'&&!['attachment','attachments'].includes(t.value.toLowerCase()))throw Error('has 支持 attachment');return t;
 });
 const v="json_extract(eona_query_term.value,'$.value')",f="json_extract(eona_query_term.value,'$.field')",excluded="json_extract(eona_query_term.value,'$.exclude')";
 const contains=c=>`instr(lower(COALESCE(${c},'')),lower(${v}))>0`;
 const fields={from:['from_addr','from_name'],to:['to_addr','alias','origin_to'],subject:['subject'],body:['text_body'],summary:['ai_summary']};
 const filenames=`EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(attachment_keys) THEN attachment_keys ELSE '[]' END) AS mail_attachment WHERE ${contains("CASE WHEN mail_attachment.type='object' THEN json_extract(mail_attachment.value,'$.name') ELSE '' END")})`;
 const text=Object.entries(fields).map(([field,columns])=>`WHEN '${field}' THEN (${columns.map(contains).join(' OR ')})`).join(' ');
 const match=`CASE ${f} ${text} WHEN 'filename' THEN ${filenames} WHEN 'attachment' THEN ${filenames} WHEN 'in' THEN (${v}='any' OR folder=${v}) WHEN 'after' THEN received_at>=${v} WHEN 'before' THEN received_at<${v} WHEN 'is' THEN CASE ${v} WHEN 'unread' THEN is_read=0 WHEN 'read' THEN is_read=1 WHEN 'starred' THEN is_starred=1 END WHEN 'has' THEN has_attachments=1 ELSE (${['subject','from_addr','from_name','to_addr','alias','origin_to','ai_summary','text_body'].map(contains).join(' OR ')} OR ${filenames}) END`;
 const serialized=JSON.stringify(normalized),ranked=normalized.some(t=>!t.exclude&&!['in','after','before','is','has'].includes(t.field));
 return {sql:` AND NOT EXISTS(SELECT 1 FROM json_each(?) AS eona_query_term WHERE COALESCE((${match}),0)=CASE WHEN ${excluded} THEN 1 ELSE 0 END)`,args:[serialized],rank:ranked?`(SELECT COALESCE(sum(CASE WHEN ${excluded} OR ${f} IN ('in','after','before','is','has') THEN 0 WHEN ${f} IN ('','from') AND (${fields.from.map(contains).join(' OR ')}) THEN 12 WHEN ${f} IN ('','subject') AND ${contains('subject')} THEN 8 WHEN ${f} IN ('','filename','attachment') AND ${filenames} THEN 6 WHEN ${f} IN ('','to') AND (${fields.to.map(contains).join(' OR ')}) THEN 4 WHEN ${f} IN ('','summary') AND ${contains('ai_summary')} THEN 2 ELSE 1 END),0) FROM json_each(?) AS eona_query_term)`:'0+0',rankArgs:ranked?[serialized]:[],terms};
}

export function mailSearchMatches(row,terms){
 const textTerms=terms.filter(t=>!t.exclude&&!['in','after','before','is','has'].includes(t.field));
 const matches=(field,value)=>textTerms.some(t=>(!t.field||t.field===field||field==='filename'&&t.field==='attachment')&&String(value||'').normalize('NFKC').toLowerCase().includes(t.value.toLowerCase()));
 let attachments=[];try{attachments=JSON.parse(row.attachment_keys||'[]')}catch{}
 const names=Array.isArray(attachments)?attachments.filter(a=>a&&typeof a.name==='string'&&matches('filename',a.name)).map(a=>a.name):[];
 const fields={subject:row.subject,from:[row.from_addr,row.from_name].join(' '),to:[row.to_addr,row.alias,row.origin_to].join(' '),summary:row.ai_summary,body:row.text_preview};
 return {match_fields:[...Object.entries(fields).filter(([field,value])=>matches(field,value)).map(([field])=>field),...(names.length?['filename']:[])],attachment_names:names};
}
