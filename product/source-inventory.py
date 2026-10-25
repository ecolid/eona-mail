"""Bounded folder discovery and UID coverage; never fetches message bodies."""
import base64,re

def decode_folder(value):
 def decode(match):
  token=match.group(1)
  if not token:return '&'
  raw=token.replace(',','/');return base64.b64decode(raw+'='*((4-len(raw)%4)%4),validate=True).decode('utf-16-be')
 return re.sub(r'&([A-Za-z0-9+,]*)-',decode,value)

def discover(client,settings):
 status,listing=client.list()
 if status!='OK' or listing is None:raise RuntimeError('source_inventory_unavailable')
 configured={f['name']:f for f in settings['folders']};rows=[]
 for row in listing:
  if not isinstance(row,bytes):raise RuntimeError('source_inventory_invalid')
  match=re.fullmatch(rb'\(([^)]*)\)\s+(?:"(?:[^"\\]|\\.)*"|NIL)\s+(.+)',row)
  if not match:raise RuntimeError('source_inventory_invalid')
  flags=match[1].decode('ascii').lower().split();wire=match[2].decode('ascii')
  if wire.startswith('"') and wire.endswith('"'):wire=wire[1:-1].replace('\\"','"').replace('\\\\','\\')
  if '\\noselect' in flags:continue
  name=decode_folder(wire)
  if name in configured:rows.append(dict(configured[name]))
  elif settings.get('discovery')=='all':rows.append({'name':name,'kind':'junk' if '\\junk' in flags or name.lower() in ['junk','spam','垃圾邮件'] else 'archive'})
 if len({f['name'] for f in rows})!=len(rows):raise RuntimeError('source_inventory_ambiguous')
 # Keep configured-but-missing folders visible as failures in collection.
 return rows+[dict(f) for n,f in configured.items() if n not in {x['name'] for x in rows}]

def all_uids(client):
 status,parts=client.uid('SEARCH',None,'ALL')
 if status!='OK' or not parts or not isinstance(parts[0],bytes):raise RuntimeError('source_inventory_unavailable')
 tokens=b' '.join(parts).split()
 if any(not x.isdigit() for x in tokens) or len(set(tokens))!=len(tokens):raise RuntimeError('source_inventory_invalid')
 return sorted(int(x) for x in tokens)
