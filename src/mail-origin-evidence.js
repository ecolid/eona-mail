// Public list recipients are distribution identities, not the user's mailbox.
// Resolve only an unambiguous registered ingress; never merge shared aliases.
export function listOriginFromRoutes(get,parsed,routes,alias=''){
 if(!get('list-id'))return null;
 const address=s=>String(s||'').toLowerCase(),owned=new Set(routes.map(r=>address(r.mailbox)));
 if(['x-original-to','delivered-to','x-envelope-to'].some(k=>(get(k).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)||[]).some(a=>owned.has(address(a)))))return null;
 const recipients=[...(parsed.to||[]),...(parsed.cc||[])].map(p=>address(p.address));
 if(recipients.some(a=>owned.has(a)))return null;
 const tokens=(get('x-forwarded-for').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)||[]).map(address);
 const gates=tokens.filter(a=>a.endsWith('@eona.top'));if(!gates.length&&alias.endsWith('@eona.top'))gates.push(alias);
 const roots=routes.filter(r=>!r.hop&&gates.includes(address(r.alias)));
 const unique=[...new Set(roots.map(r=>address(r.mailbox)))];return unique.length===1?unique[0]:null;
}
