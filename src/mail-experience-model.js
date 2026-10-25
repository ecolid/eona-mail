// UI preferences only. Mail identity, queries and edits stay in their controllers.
export function normalizeMailExperience(value={}){
 value=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const orders={};for(const [group,keys] of Object.entries(value.orders||{}))if(['folders','categories','mailboxes'].includes(group)&&Array.isArray(keys))orders[group]=[...new Set(keys.filter(k=>typeof k==='string'&&k.length<=300))].slice(0,200);
 const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.round(Math.min(max,Math.max(min,value))):fallback;
 return {side:clamp(value.side,184,360,216),list:clamp(value.list,260,640,360),orders};
}
export function orderMailNavigation(rows,saved=[]){
 const rank=new Map(saved.map((key,index)=>[key,index]));return rows.map((row,index)=>({row,index})).sort((a,b)=>(rank.get(a.row.key)??saved.length+a.index)-(rank.get(b.row.key)??saved.length+b.index)).map(({row})=>row);
}
export function moveMailNavigation(keys,key,offset){const next=[...keys],from=next.indexOf(key),to=Math.min(next.length-1,Math.max(0,from+offset));if(from<0||from===to)return next;next.splice(from,1);next.splice(to,0,key);return next}
export function mailPanelSizes(width,side=216,list=360,columns=3){
 width=Math.max(columns===3?772:508,Number(width)||0);const available=width-4*(columns-1),sidebar=Math.min(Math.max(184,side),Math.max(184,available-(columns===3?580:320)));
 // Split.js subtracts half a gutter on the edges, a full gutter in the middle.
 // Include those offsets in percentages so restoring the same width never drifts.
 if(columns===2)return [(sidebar+2)/width*100,(available-sidebar+2)/width*100];
 const scan=Math.min(Math.max(260,list),Math.max(260,available-sidebar-320));return [(sidebar+2)/width*100,(scan+4)/width*100,(available-sidebar-scan+2)/width*100];
}
