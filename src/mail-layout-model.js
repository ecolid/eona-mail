export function normalizeMailLayout(value) {
  const input=value&&typeof value==='object'?value:{}, visibility={};
  for(const [email,mode] of Object.entries(input.visibility||{}).slice(0,100)) {
    if(email.length<=254&&/^[^\s@]+@[^\s@]+$/.test(email)&&['auto','show','hide'].includes(mode))visibility[email.toLowerCase()]=mode;
  }
  return {limit:Number.isInteger(input.limit)?Math.min(12,Math.max(3,input.limit)):6,
    density:input.density==='comfortable'?'comfortable':'compact',visibility};
}

export function rankMailboxes(rows, preferences, usage={}, active='', now=Date.now()) {
  const prefs=preferences, day=86400000;
  const score=row=>{
    const last=String(row.last_seen||''),seen=Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(last)?last.replace(' ','T')+'Z':last),opened=usage[row.key]||{};
    const age=Number.isFinite(seen)?Math.max(0,now-seen)/day:365;
    const visits=Number(opened.count)||0, visitAge=Number(opened.at)?Math.max(0,now-opened.at)/day:365;
    return Math.log1p(Math.max(0,Number(row.count)||0))*Math.exp(-age/30)+
      5*Math.log1p(Math.min(20,visits))*Math.exp(-visitAge/14);
  };
  const ranked=rows.map((row,index)=>({...row,index,score:score(row)})).sort((a,b)=>b.score-a.score||a.index-b.index);
  const visible=new Set(ranked.filter(row=>row.key===active||prefs.visibility[row.key]==='show').map(row=>row.key));
  const autos=ranked.filter(row=>prefs.visibility[row.key]!=='hide'&&prefs.visibility[row.key]!=='show'&&row.key!==active);
  for(const row of autos.slice(0,Math.max(0,prefs.limit-visible.size)))visible.add(row.key);
  return {visible:rows.filter(row=>visible.has(row.key)),collapsed:rows.filter(row=>!visible.has(row.key))};
}
