export async function seedDemo(store,config){
  for(let i=0;i<18;i++){
    const raw=Buffer.from(['From: '+(i%2?'项目联系人':'产品更新')+' <sender'+i+'@example.test>','To: '+config.owner.email,'Subject: '+(i%2?'项目进展与下一步安排':'产品更新与阅读示例')+' '+(i+1),'Date: '+new Date(Date.now()-i*3600000).toUTCString(),'Message-ID: <demo-'+i+'@example.test>','MIME-Version: 1.0','Content-Type: text/plain; charset=utf-8','','这是一封合成的演示邮件，用于体验阅读、搜索、分类和批量操作。\n\n正文与附件均不来自真实邮箱。'].join('\r\n'));
    await store.ingest(raw,{account:'demo',folder:'INBOX',validity:'demo',uid:String(i+1),kind:'inbox',historical:true,seen:i%3===0});
  }
  await store.db.prepare("INSERT OR IGNORE INTO mail_drafts(owner,id,to_addr,subject,body,rev,updated_at,envelope_json) VALUES(?,'demo-draft','friend@example.test','演示草稿','可以在这里继续编辑。',1,?,'{}')").bind(config.owner.id,new Date().toISOString()).run();
}
