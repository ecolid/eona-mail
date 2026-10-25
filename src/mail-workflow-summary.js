// Parse only facts present in a GitHub Actions notification. A failed run is
// distinct from another branch/commit and from another delivery of that run.
export function workflowMailSummary(row={}) {
  const address=String(row.from_addr||'').toLowerCase();
  if(!/(?:^|[<\s])(?:notifications|noreply)@github\.com(?:>|\s|$)/.test(address))return null;
  return workflowSubjectDetails(row.subject,row.text_body||row.textBody||'');
}
export function workflowSubjectDetails(subject='',text=''){
  const match=/\[([^\]\s]+\/[^\]\s]+)\]\s*Run (failed|cancelled|canceled|succeeded):\s*(.+?)\s+[–—-]\s+(.+?)\s*\(([a-f0-9]{7,40})\)\s*$/i.exec(String(subject||''));
  if(!match)return null;
  const [,repo,status,workflow,branch,commit]=match;
  text=String(text||'');
  const run=[...text.matchAll(/https:\/\/github\.com\/([^\s/]+\/[^\s/]+)\/actions\/runs\/(\d+)/g)].find(m=>m[1]===repo);
  const lines=[repo+' · '+workflow,branch+' · '+commit+' · '+({failed:'检查失败',cancelled:'已取消',canceled:'已取消',succeeded:'检查通过'})[status.toLowerCase()]];
  // Job names are useful, but a mail rarely includes the actual log error.
  const jobs=[...text.matchAll(/(?:^|\n)\s*\*?\s*([^\n]{1,100}?)\s*(?::\s*|\s+)(?:Failed|Failure)\b/gi)].map(m=>m[1].trim()).slice(0,3);
  if(jobs.length)lines.push('失败任务：'+jobs.join('、'));
  if(run)lines.push('运行 #'+run[2]+' · 查看失败日志');
  return {statusLabel:({failed:'检查失败',cancelled:'已取消',canceled:'已取消',succeeded:'检查通过'})[status.toLowerCase()],summary:lines.join('\n'),repo,workflow,branch,commit,runId:run?.[2]||null,url:run?.[0]||null};
}
