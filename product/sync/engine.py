#!/usr/bin/env python3
"""Reconcile authorized Sent/Drafts; journal IMAP writes and preserve edit conflicts.

Default is inventory only. --apply additionally requires the deployed opt-in and
trusted owner. This process never invokes SMTP and never performs blanket EXPUNGE.
"""
from __future__ import annotations
import argparse,base64,contextlib,email,email.policy,email.utils,fcntl,hashlib,importlib.util,json,os,pathlib,re,sqlite3,struct,subprocess,sys,tempfile,time,uuid
from datetime import datetime,timezone
ROOT=pathlib.Path(__file__).resolve().parents[2]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,pathlib.Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
sent=module('workspace_sent','sent.py');drafts=module('workspace_drafts','drafts.py')
def now():return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def digest(value):return hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()
def sync_id(owner,kind,id):return ('d-' if kind=='draft' else 's-')+digest(owner+'\0'+id)
def initialize(db):
    sql=(ROOT/'src/mail-sync-schema.js').read_text();sql=re.search(r'/\* SQL \*/`(.*?)`',sql,re.S)[1];db.executescript(sql)
    sent.initialize(db);drafts.initialize(db)
    db.execute('PRAGMA busy_timeout=30000');db.execute('PRAGMA synchronous=FULL');db.row_factory=sqlite3.Row

def unpack(root,key):
    path=root/digest(key)[:2]/(digest(key)+'.obj')
    with path.open('rb') as f:
        size=f.read(4)
        if len(size)!=4:raise RuntimeError('object_truncated')
        n=struct.unpack('>I',size)[0]
        if n>65536:raise RuntimeError('object_header_invalid')
        meta=json.loads(f.read(n));raw=f.read()
    if meta['key']!=key or len(raw)!=meta['size'] or digest(raw)!=meta['sha256']:raise RuntimeError('object_hash_mismatch')
    return raw

def put(root,key,raw):
    fd,path=tempfile.mkstemp(dir=root,prefix='.workspace-')
    try:
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        sha=sent.object_put(root,key,pathlib.Path(path),source='workspace-sync')
    finally:pathlib.Path(path).unlink(missing_ok=True)
    return sha

def message(raw):return email.message_from_bytes(raw,policy=email.policy.default)
def canonical(payload,files,kind='sent'):
    norm=lambda value:re.sub(r'\s+',' ',value or '').strip()
    return digest(json.dumps({'from':payload['from']['address'].lower(),'to':sorted(p['address'].lower() for p in payload.get('to',[])),'cc':sorted(p['address'].lower() for p in payload.get('cc',[])),'subject':str(payload.get('subject','')),'body':norm(payload.get('body','')),**({'bcc':sorted(p['address'].lower() for p in payload.get('bcc',[])),'html':re.sub(r'>\s+<','><',payload.get('html','')).strip()} if kind=='draft' else {}),'files':sorted((f['name'],f['mime'],digest(f['data'])) for f in files)},sort_keys=True,ensure_ascii=False))
def parse(raw,account,stamp=None,kind='sent'):
    with tempfile.NamedTemporaryFile() as f:
        f.write(raw);f.flush();payload,files,mid,when=sent.parsed(pathlib.Path(f.name),account,stamp or datetime.now(timezone.utc))
    return payload,files,mid,when,canonical(payload,files,kind)

def row_value(row):
    e=json.loads(row['envelope_json']);return {'id':row['id'],'to':row['to_addr'],'subject':row['subject'],'body':row['body'],'rev':row['rev'],'updated_at':row['updated_at'],**e}
def stamp_headers(raw,sid,op,kind,bcc=None):
    m=message(raw)
    for key,value in [('X-Eona-Sync-ID',sid),('X-Eona-Sync-Operation',op),('X-Eona-Sync-Kind',kind)]:
        while key in m:del m[key]
        m[key]=value
    if bcc and not m.get('Bcc'):m['Bcc']=', '.join(email.utils.formataddr((p.get('name',''),p['address'])) for p in bcc)
    return m.as_bytes(policy=email.policy.SMTP)

class Rejected(Exception):pass
class Missing(Exception):pass
class Pending(Exception):pass

class IMAP:
    def __init__(self,connection,decode,root):self.c=connection;self.decode=decode;self.root=root;self.selected=None;self.cap={v.decode() if isinstance(v,bytes) else str(v) for v in connection.capabilities};self.names={}
    def folders(self,kind):
        if kind in self.names:return self.names[kind]
        if kind!='backup':result=sent.folders(self.c,self.decode,'drafts' if kind=='draft' else 'sent')
        else:
            status,rows=self.c.list();special=[];named=[]
            if status!='OK':raise RuntimeError('trash_inventory_failed')
            for r in rows or []:
                m=re.match(rb'^\(([^)]*)\)\s+(?:"[^"]*"|NIL)\s+(.+)$',r)
                if not m:raise RuntimeError('unrecognized_folder_listing')
                flags=m[1].lower().split();name=m[2].decode().strip('"')
                if b'\\trash' in flags:special.append(name)
                elif re.fullmatch(r'Trash|Deleted (?:Messages|Items)|已删除(?:邮件)?',self.decode(name),re.I):named.append(name)
            result=special or named
            if len(result)!=1:raise RuntimeError('trash_folder_not_identified')
        self.names[kind]=list(dict.fromkeys(result));return self.names[kind]
    def select(self,folder,write=False):
        status,parts=self.c.select('"'+folder.replace('\\','\\\\').replace('"','\\"')+'"',readonly=not write)
        if status!='OK':raise RuntimeError('folder_select_failed')
        v=self.c.response('UIDVALIDITY')[1][0]
        if not v or not v.isdigit():raise RuntimeError('uidvalidity_missing')
        self.selected=folder;return v.decode()
    def scan_folder(self,folder):
        # EXISTS and SEARCH are different instants on a live mailbox. SEARCH plus
        # complete UID header fetch is the snapshot; count equality is not a lock.
        validity=self.select(folder);status,data=self.c.uid('SEARCH',None,'ALL')
        if status!='OK' or not data or not isinstance(data[0],bytes):raise RuntimeError('uid_inventory_failed')
        values=b' '.join(data).split()
        if any(not v.isdigit() for v in values) or len(set(values))!=len(values):raise RuntimeError('invalid_uid_inventory')
        uids=[int(v) for v in values];result=[]
        for start in range(0,len(uids),250):
            batch=uids[start:start+250];status,parts=self.c.uid('FETCH',','.join(map(str,batch)),'(UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID X-EONA-SYNC-ID X-EONA-SYNC-OPERATION)])')
            if status!='OK':raise RuntimeError('header_inventory_failed')
            found=set()
            for p in parts or []:
                if not isinstance(p,tuple):continue
                meta,header=p;m=re.search(rb'\bUID (\d+)',meta)
                if not m:raise RuntimeError('header_uid_missing')
                uid=int(m[1]);found.add(uid);flags=re.search(rb'FLAGS \(([^)]*)\)',meta);date=re.search(rb'INTERNALDATE "([^"]+)"',meta)
                if not date:raise RuntimeError('internaldate_missing')
                dt=datetime.strptime(date[1].decode(),'%d-%b-%Y %H:%M:%S %z');h=message(header)
                result.append({'folder':folder,'validity':validity,'uid':uid,'message_id':sent.identity_header(h,'Message-ID'),'sync_id':sent.identity_header(h,'X-Eona-Sync-ID'),'operation_id':sent.identity_header(h,'X-Eona-Sync-Operation'),'when':dt,'deleted':bool(flags and b'\\deleted' in flags[1].lower())})
            if found!=set(batch):raise RuntimeError('inventory_changed_retry')
        return result
    def scan(self,kind):return [r for folder in self.folders(kind) for r in self.scan_folder(folder) if not r['deleted']]
    def raw(self,item):
        if self.select(item['folder'])!=item['validity']:raise Missing('uidvalidity_changed')
        path=sent.fetch_raw(self.c,item['uid'],self.root)
        try:return path.read_bytes()
        finally:path.unlink(missing_ok=True)
    def exists(self,item):
        if self.select(item['folder'])!=item['validity']:return False
        status,parts=self.c.uid('FETCH',str(item['uid']),'(UID)')
        if status!='OK':raise RuntimeError('missing_uid_check_failed')
        meta=b' '.join(p[0] if isinstance(p,tuple) else p for p in parts or [] if isinstance(p,(bytes,tuple)))
        return bool(re.search(rb'\bUID '+str(item['uid']).encode()+rb'\b',meta))
    def append(self,folder,raw,kind):
        status,parts=self.c.append('"'+folder.replace('"','\\"')+'"','(\\Draft \\Seen)' if kind=='draft' else '(\\Seen)',None,raw)
        if status!='OK':raise Rejected('append_rejected')
        response=self.c.response('APPENDUID');data=b' '.join(p for p in (response[1] or []) if isinstance(p,bytes)) if response else b'';m=re.search(rb'(\d+) (\d+)',data)
        return (m[1].decode(),int(m[2])) if m else None
    def delete_uid(self,item):
        # A verified, recoverable Trash copy is required by the caller.
        if 'UIDPLUS' not in self.cap:raise RuntimeError('targeted_expunge_unavailable')
        if self.select(item['folder'],write=True)!=item['validity']:return
        status,data=self.c.uid('SEARCH',None,'UID',str(item['uid']))
        if status!='OK':raise RuntimeError('retire_lookup_failed')
        if str(item['uid']).encode() not in b' '.join(data or []).split():return
        status,_=self.c.uid('STORE',str(item['uid']),'+FLAGS.SILENT','(\\Deleted)')
        if status!='OK':raise RuntimeError('retire_store_failed')
        status,_=self.c.uid('EXPUNGE',str(item['uid']))
        if status!='OK':raise RuntimeError('retire_uid_expunge_failed')

class Sync:
    def __init__(self,db,root,owner,accounts,compile_mime=None):
        self.db=db;self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True,mode=0o700);self.owner=owner;self.accounts={a.key:a for a in accounts};self.compile=compile_mime or self.compile_node;initialize(db)
    def all(self,sql,args=()):return list(self.db.execute(sql,args))
    def one(self,sql,args=()):return self.db.execute(sql,args).fetchone()
    def compile_node(self,payload):
        result=subprocess.run(['node',str(ROOT/'product/sync-mime.mjs')],input=json.dumps(payload,ensure_ascii=False).encode(),capture_output=True,timeout=45)
        if result.returncode:raise RuntimeError('mime_build_failed')
        return result.stdout
    def active(self,id):return bool(self.one('SELECT 1 FROM mail_draft_editors WHERE owner=? AND draft_id=? AND expires_at>?',(self.owner,id,int(time.time()))))
    def copies(self,kind,id,account=None,all=False):return self.all('SELECT * FROM mail_sync_copies WHERE owner=? AND kind=? AND record_id=?'+(' AND account=?' if account else '')+('' if all else ' AND removed=0'),(self.owner,kind,id,*([account] if account else [])))
    def known(self,account,kind,item):return self.one('SELECT * FROM mail_sync_copies WHERE owner=? AND account=? AND kind=? AND folder=? AND validity=? AND uid=?',(self.owner,account,kind,item['folder'],item['validity'],item['uid']))
    def raw(self,remote,item,known=None):return unpack(self.root,known['raw_key']) if known else remote.raw(item)
    def missing(self,remote,copy):
        key=tuple(copy[k] for k in ['owner','account','kind','folder','validity','uid'])
        exists=remote.exists(copy)
        with self.db:
            if exists:
                self.db.execute('DELETE FROM mail_sync_missing WHERE owner=? AND account=? AND kind=? AND folder=? AND validity=? AND uid=?',key);return False
            old=self.one('SELECT first_seen FROM mail_sync_missing WHERE owner=? AND account=? AND kind=? AND folder=? AND validity=? AND uid=?',key)
            if not old:self.db.execute('INSERT INTO mail_sync_missing VALUES(?,?,?,?,?,?,?)',(*key,int(time.time())));return False
            return int(time.time())-old[0]>=60
    def remember(self,account,kind,item,id,raw,fp):
        key=kind+'-source/'+account+'/'+digest(raw)+'.eml';sha=put(self.root,key,raw)
        self.db.execute('INSERT OR REPLACE INTO mail_sync_copies VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0)',(self.owner,account,kind,item['folder'],item['validity'],item['uid'],id,key,sha,fp,item.get('message_id',''),item.get('operation_id','')))
        if kind in ('sent','draft'):
            table='mail_sent_sources' if kind=='sent' else 'mail_draft_sources'
            self.db.execute('INSERT OR REPLACE INTO '+table+' VALUES(?,?,?,?,?,?,?,?)',(self.owner,account,item['folder'],item['validity'],item['uid'],id,key,sha))
        self.db.execute('DELETE FROM mail_sync_missing WHERE owner=? AND account=? AND kind=? AND folder=? AND validity=? AND uid=?',(self.owner,account,kind,item['folder'],item['validity'],item['uid']))
        if item.get('operation_id'):
            self.db.execute("UPDATE mail_sync_ops SET state='confirmed',validity=?,uid=?,error='',updated_at=? WHERE owner=? AND account=? AND kind=? AND record_id=? AND id=?",(item['validity'],item['uid'],now(),self.owner,account,kind,id,item['operation_id']))
        return self.known(account,kind,item)
    def draft(self,id):return self.one('SELECT * FROM mail_drafts WHERE owner=? AND id=?',(self.owner,id))
    def entity(self,id):return self.one('SELECT * FROM mail_sync_drafts WHERE owner=? AND id=?',(self.owner,id))
    def entity_save(self,id,account,rev,fp,state='synced',conflict=''):
        self.db.execute('INSERT INTO mail_sync_drafts VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET account=excluded.account,base_rev=excluded.base_rev,content_hash=excluded.content_hash,state=excluded.state,conflict_of=CASE WHEN excluded.conflict_of<>\'\' THEN excluded.conflict_of ELSE mail_sync_drafts.conflict_of END,updated_at=excluded.updated_at',(self.owner,id,account,sync_id(self.owner,'draft',id),rev,fp,state,conflict,now()))
    def adopt(self):
        with self.db:self.db.execute('DELETE FROM mail_draft_editors WHERE expires_at<=?',(int(time.time()),))
        # Upgrade previously receive-only Gmail draft projections in place.
        # Their stable Gmail identity must not become a second local/remote draft.
        if self.one("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_gmail_copies'"):
            for account in self.accounts.values():
                if getattr(account,'config',{}).get('imap',{}).get('provider')!='gmail':continue
                copies=self.all("SELECT c.*,g.message_id AS gmail_id FROM product_source_copies c JOIN product_gmail_copies g USING(account,folder,validity,uid) WHERE c.account=? AND c.kind='drafts'",(account.key,))
                for copy in copies:
                    id='source-'+digest(json.dumps([account.key,'gmail',copy['gmail_id'],'drafts'],separators=(',',':')))[:48]
                    row=self.draft(id)
                    if not row or self.entity(id):continue
                    raw=unpack(self.root,copy['raw_key']);p,files,mid,when,fp=parse(raw,account,kind='draft')
                    with self.db:
                        self.remember(account.key,'draft',{**dict(copy),'message_id':mid},id,raw,fp)
                        self.entity_save(id,account.key,row['rev'],fp)
        # Existing one-time import cursors become reconciliation baselines, not new copies.
        for kind,table in [('sent','mail_sent_sources'),('draft','mail_draft_sources')]:
            for r in self.all('SELECT * FROM '+table+' WHERE owner=?',(self.owner,)):
                if r['account'] not in self.accounts:continue
                item={k:r[k] for k in ['folder','validity','uid']}
                if self.known(r['account'],kind,item):continue
                raw=unpack(self.root,r['raw_key']);p,files,mid,when,fp=parse(raw,self.accounts[r['account']],kind=kind)
                with self.db:
                    self.remember(r['account'],kind,{**item,'message_id':mid},r['record_id'],raw,fp)
                    if kind=='draft' and not self.entity(r['record_id']):self.entity_save(r['record_id'],r['account'],1,fp)
        pref=self.one('SELECT preferences_json FROM mail_sender_preferences WHERE owner=?',(self.owner,));default=json.loads(pref[0]).get('default_id') if pref else None
        for row in self.all('SELECT * FROM mail_drafts WHERE owner=?',(self.owner,)):
            if self.entity(row['id']):continue
            value=row_value(row);account=value.get('from_id') or default or next(iter(self.accounts),'')
            if account in self.accounts:
                with self.db:self.entity_save(row['id'],account,0,'','pending')
    def materialize(self,account,id,raw,stamp):
        p,files,mid,when,fp=parse(raw,account,stamp,'draft');images={};attachments=[];key='draft-source/'+account.key+'/'+digest(raw)+'.eml';put(self.root,key,raw)
        for i,f in enumerate(files):
            asset='sync-'+digest(id+'\0'+digest(raw)+':'+str(i));mime=f['mime'] if f['mime'] in ('image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain') else 'application/octet-stream'
            self.db.execute('INSERT OR IGNORE INTO mail_assets VALUES(?,?,?,?,?,?,?,?)',(self.owner,asset,id,f['name'],mime,len(f['data']),base64.b64encode(f['data']).decode(),when));attachments.append({'id':asset,'name':f['name'],'type':mime,'size':len(f['data']),'url':'/api/mail-workspace/assets/'+asset})
            if f['cid']:images[f['cid']]=asset
        parser=drafts.DraftDocument(images)
        if p['html']:parser.feed(p['html']);document=parser.document()
        else:document={'ops':[{'insert':p['body'].rstrip('\n')+'\n'}]}
        inline=set(images.values());envelope={'from_id':account.key,'cc':', '.join(email.utils.formataddr((v['name'],v['address'])) for v in p['cc']),'bcc':', '.join(email.utils.formataddr((v['name'],v['address'])) for v in p['bcc']),'document':document,'attachments':[a for a in attachments if a['id'] not in inline],'source':{'raw_key':key,'message_id':mid,'account':account.key}}
        return {'to':', '.join(email.utils.formataddr((v['name'],v['address'])) for v in p['to']),'subject':p['subject'],'body':p['body'],'when':when,'envelope':json.dumps(envelope,ensure_ascii=False),'fp':fp}
    def import_draft(self,account,id,raw,item,conflict=''):
        value=self.materialize(account,id,raw,item['when']);self.db.execute('INSERT INTO mail_drafts VALUES(?,?,?,?,?,1,?,?)',(self.owner,id,value['to'],value['subject'],value['body'],value['when'],value['envelope']))
        self.entity_save(id,account.key,1,value['fp'],'synced',conflict);return value
    def pull_drafts(self,account,remote,items):
        for item in items:
            known=self.known(account.key,'draft',item);entity=self.entity(known['record_id']) if known else None
            if known and entity and (entity['account']!=account.key or (known['content_hash']==entity['content_hash'] and entity['state'] not in ('waiting_editor','remote_deleted_waiting'))):
                if known['removed']:
                    with self.db:self.db.execute("UPDATE mail_sync_copies SET removed=0 WHERE owner=? AND account=? AND kind='draft' AND folder=? AND validity=? AND uid=?",(self.owner,account.key,item['folder'],item['validity'],item['uid']))
                continue
            raw=self.raw(remote,item,known);p,files,mid,when,fp=parse(raw,account,item['when'],'draft');id=known['record_id'] if known else None
            operation=self.one("SELECT * FROM mail_sync_ops WHERE owner=? AND account=? AND kind='draft' AND id=?",(self.owner,account.key,item.get('operation_id','')))
            if operation and (not known or operation['state']!='confirmed') and fp==parse(unpack(self.root,operation['raw_key']),account,kind='draft')[4]:
                with self.db:
                    self.remember(account.key,'draft',item,operation['record_id'],raw,fp);self.entity_save(operation['record_id'],account.key,operation['revision'],fp)
                    self.db.execute("UPDATE mail_sync_ops SET state='confirmed',validity=?,uid=?,error='',updated_at=? WHERE owner=? AND id=?",(item['validity'],item['uid'],now(),self.owner,operation['id']))
                continue
            if not id and item.get('sync_id'):
                match=self.one('SELECT id FROM mail_sync_drafts WHERE owner=? AND sync_id=?',(self.owner,item['sync_id']));id=match[0] if match else None
            if not id and mid:
                match=self.one("SELECT record_id FROM mail_sync_copies WHERE owner=? AND account=? AND kind='draft' AND message_id=? ORDER BY removed LIMIT 1",(self.owner,account.key,mid));id=match[0] if match else None
            if not id:
                match=self.one("SELECT record_id FROM mail_sync_copies WHERE owner=? AND account=? AND kind='draft' AND content_hash=? ORDER BY removed LIMIT 1",(self.owner,account.key,fp));id=match[0] if match else None
            if id and not self.draft(id):
                # Local send/discard owns this deletion; never resurrect its old remote UID.
                with self.db:self.remember(account.key,'draft',item,id,raw,fp)
                continue
            if not id:
                id='draft-sync-'+digest(account.key+'\0'+(mid or fp))
                with self.db:self.import_draft(account,id,raw,item);self.remember(account.key,'draft',item,id,raw,fp)
                continue
            with self.db:
                # BEGIN IMMEDIATE prevents a lease or local edit appearing between these checks and CAS.
                self.db.execute('BEGIN IMMEDIATE');row=self.draft(id);entity=self.entity(id)
                if not row:
                    self.remember(account.key,'draft',item,id,raw,fp);continue
                if entity['account']!=account.key:
                    old=self.one("SELECT 1 FROM mail_sync_copies WHERE owner=? AND account=? AND kind='draft' AND record_id=? AND content_hash=?",(self.owner,account.key,id,fp))
                    if old:self.remember(account.key,'draft',item,id,raw,fp)
                    else:
                        fork='draft-conflict-'+digest(id+'\0'+account.key+'\0'+digest(raw))
                        if not self.draft(fork):self.import_draft(account,fork,raw,item,id)
                        self.entity_save(fork,account.key,0,fp,'conflict',id);self.remember(account.key,'draft',item,fork,raw,fp)
                    continue
                if fp==entity['content_hash']:
                    self.remember(account.key,'draft',item,id,raw,fp)
                    if entity['state']=='remote_deleted_waiting':self.db.execute("UPDATE mail_sync_drafts SET state='synced' WHERE owner=? AND id=?",(self.owner,id))
                    continue
                if self.active(id):
                    self.remember(account.key,'draft',item,id,raw,fp);self.db.execute("UPDATE mail_sync_drafts SET state='waiting_editor' WHERE owner=? AND id=?",(self.owner,id));continue
                if row['rev']==entity['base_rev']:
                    v=self.materialize(account,id,raw,item['when']);self.db.execute('UPDATE mail_drafts SET to_addr=?,subject=?,body=?,rev=rev+1,updated_at=?,envelope_json=? WHERE owner=? AND id=? AND rev=?',(v['to'],v['subject'],v['body'],v['when'],v['envelope'],self.owner,id,row['rev']));self.entity_save(id,account.key,row['rev']+1,fp)
                else:
                    # Preserve local identity (and any editor recovery) and fork the remote version.
                    fork='draft-conflict-'+digest(id+'\0'+digest(raw));existing=self.draft(fork)
                    if not existing:self.import_draft(account,fork,raw,item,id)
                    self.db.execute("UPDATE mail_sync_copies SET record_id=? WHERE owner=? AND kind='draft' AND account=? AND record_id=? AND raw_sha=?",(fork,self.owner,account.key,id,digest(raw)))
                    self.entity_save(fork,account.key,0,fp,'conflict',id)
                    self.remember(account.key,'draft',item,fork,raw,fp)
                    # Re-tag the remote fork before publishing the local competing version.
                    self.db.execute("UPDATE mail_sync_drafts SET state='conflict' WHERE owner=? AND id=?",(self.owner,id));continue
                self.remember(account.key,'draft',item,id,raw,fp)
        present={(i['folder'],i['validity'],i['uid']) for i in items}
        for copy in self.all("SELECT * FROM mail_sync_copies WHERE owner=? AND account=? AND kind='draft' AND removed=0",(self.owner,account.key)):
            if (copy['folder'],copy['validity'],copy['uid']) not in present and self.missing(remote,copy):
                with self.db:self.db.execute("UPDATE mail_sync_copies SET removed=1 WHERE owner=? AND account=? AND kind='draft' AND folder=? AND validity=? AND uid=?",(self.owner,account.key,copy['folder'],copy['validity'],copy['uid']))
        for e in self.all('SELECT * FROM mail_sync_drafts WHERE owner=? AND account=? AND base_rev>0',(self.owner,account.key)):
            if self.copies('draft',e['id']) or not self.copies('draft',e['id'],all=True):continue
            with self.db:
                self.db.execute('BEGIN IMMEDIATE');row=self.draft(e['id'])
                if not row:continue
                if self.active(e['id']):self.db.execute("UPDATE mail_sync_drafts SET state='remote_deleted_waiting' WHERE owner=? AND id=?",(self.owner,e['id']));continue
                if row['rev']!=e['base_rev']:
                    self.entity_save(e['id'],account.key,0,'','conflict');continue
                self.db.execute('INSERT OR REPLACE INTO mail_sync_tombstones VALUES(?,?,?,?,?,?)',(self.owner,'draft',e['id'],json.dumps(dict(row)), 'provider_removed',now()));self.db.execute('DELETE FROM mail_drafts WHERE owner=? AND id=? AND rev=?',(self.owner,e['id'],row['rev']))
    def append(self,account,remote,kind,id,rev,raw_factory,folder=None):
        op='push-'+digest(account.key+'\0'+kind+'\0'+id+'\0'+str(rev));row=self.one('SELECT * FROM mail_sync_ops WHERE owner=? AND id=?',(self.owner,op));folder=folder or remote.folders(kind)[0]
        if not row:
            raw=raw_factory(op);key='workspace-sync/'+op+'.eml';sha=put(self.root,key,raw)
            with self.db:self.db.execute('INSERT INTO mail_sync_ops VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(self.owner,op,kind,id,account.key,rev,key,sha,'prepared',folder,'',0,'',now(),now()))
            row=self.one('SELECT * FROM mail_sync_ops WHERE owner=? AND id=?',(self.owner,op))
        raw=unpack(self.root,row['raw_key'])
        found=[i for i in remote.scan_folder(folder) if i.get('operation_id')==op and not i.get('deleted')]
        if len(found)>1:raise RuntimeError('append_identity_not_unique')
        if found:item=found[0]
        elif row['state'] in ('appending','unknown','confirmed'):
            with self.db:self.db.execute("UPDATE mail_sync_ops SET state='unknown',error='append_confirmation_pending',updated_at=? WHERE owner=? AND id=?",(now(),self.owner,op))
            raise Pending('append_confirmation_pending')
        else:
            with self.db:self.db.execute("UPDATE mail_sync_ops SET state='appending',error='',updated_at=? WHERE owner=? AND id=?",(now(),self.owner,op))
            try:location=remote.append(folder,raw,kind)
            except Rejected:
                with self.db:self.db.execute("UPDATE mail_sync_ops SET state='failed',error='append_rejected',updated_at=? WHERE owner=? AND id=?",(now(),self.owner,op))
                raise
            except Exception:
                with self.db:self.db.execute("UPDATE mail_sync_ops SET state='unknown',error='append_confirmation_pending',updated_at=? WHERE owner=? AND id=?",(now(),self.owner,op))
                raise Pending('append_confirmation_pending')
            found=[i for i in remote.scan_folder(folder) if i.get('operation_id')==op and not i.get('deleted')]
            if len(found)!=1:raise Pending('append_confirmation_pending')
            item=found[0]
        actual=remote.raw(item)
        # Providers may add trace headers, but the operation and MIME content must agree.
        expected=parse(raw,account,kind=kind)[4];actual_fp=parse(actual,account,item['when'],kind)[4]
        if actual_fp!=expected:raise RuntimeError('appended_content_mismatch')
        with self.db:
            self.db.execute("UPDATE mail_sync_ops SET state='confirmed',validity=?,uid=?,error='',updated_at=? WHERE owner=? AND id=?",(item['validity'],item['uid'],now(),self.owner,op))
            copy=self.remember(account.key,kind,item,id,actual,actual_fp)
        return copy
    def retire(self,account,remote,copy):
        if copy['removed']:return
        if hasattr(remote,'retire_recoverable'):
            remote.retire_recoverable(copy)
            with self.db:self.db.execute('UPDATE mail_sync_copies SET removed=1 WHERE owner=? AND account=? AND kind=? AND folder=? AND validity=? AND uid=?',(self.owner,account.key,copy['kind'],copy['folder'],copy['validity'],copy['uid']))
            return
        backup_id='retire-'+digest('\0'.join(str(copy[k]) for k in ['account','kind','folder','validity','uid','raw_sha']))
        original=unpack(self.root,copy['raw_key'])
        self.append(account,remote,'backup',backup_id,1,lambda op:stamp_headers(original,sync_id(self.owner,copy['kind'],copy['record_id']),op,'backup'),remote.folders('backup')[0])
        remote.delete_uid(copy)
        with self.db:self.db.execute('UPDATE mail_sync_copies SET removed=1 WHERE owner=? AND account=? AND kind=? AND folder=? AND validity=? AND uid=?',(self.owner,account.key,copy['kind'],copy['folder'],copy['validity'],copy['uid']))
    def draft_mime(self,account,row,op):
        value=row_value(row);pref=self.one('SELECT preferences_json FROM mail_sender_preferences WHERE owner=?',(self.owner,));pref=json.loads(pref[0]) if pref else {};name=pref.get('names',{}).get(account.key) or pref.get('default_name','')
        doc=value.get('document');ids=[a['id'] for a in value.get('attachments',[])]+[o['insert']['image'].split('/')[-1] for o in (doc or {}).get('ops',[]) if isinstance(o.get('insert'),dict) and 'image' in o['insert']]
        assets=[]
        for id in dict.fromkeys(ids):
            asset=self.one('SELECT * FROM mail_assets WHERE owner=? AND id=?',(self.owner,id))
            if not asset:raise RuntimeError('draft_asset_missing')
            assets.append(dict(asset))
        return self.compile({'from':{'address':account.user,'name':name},'to':value['to'],'cc':value.get('cc',''),'bcc':value.get('bcc',''),'subject':value['subject'],'body':value['body'],'document':doc,'assets':assets,'date':row['updated_at'],'messageId':'<'+sync_id(self.owner,'draft',row['id'])+'@eona.mail>','sync':{'syncId':sync_id(self.owner,'draft',row['id']),'operationId':op,'kind':'draft'}})
    def push_drafts(self,account,remote):
        rows=self.all('SELECT d.*,s.base_rev,s.account AS sync_account,s.state AS sync_state,s.conflict_of FROM mail_drafts d JOIN mail_sync_drafts s ON s.owner=d.owner AND s.id=d.id WHERE d.owner=? ORDER BY (s.conflict_of=\'\'),d.updated_at',(self.owner,))
        for row in rows:
            value=row_value(row);target=value.get('from_id') or row['sync_account']
            if target!=account.key:continue
            if row['sync_state'] in ('waiting_editor','remote_deleted_waiting'):continue
            if row['rev']==row['base_rev'] and row['sync_account']==target:continue
            if self.one("SELECT 1 FROM mail_sync_ops WHERE owner=? AND kind='draft' AND record_id=? AND state IN ('appending','unknown')",(self.owner,row['id'])):raise Pending('append_confirmation_pending')
            # Capture an immutable saved revision. Concurrent newer saves remain dirty.
            copy=self.append(account,remote,'draft',row['id'],row['rev'],lambda op:self.draft_mime(account,row,op))
            with self.db:self.entity_save(row['id'],account.key,row['rev'],copy['content_hash'],'conflict' if row['conflict_of'] else 'synced')
            for prior in self.copies('draft',row['id'],account.key):
                if (prior['folder'],prior['validity'],prior['uid'])!=(copy['folder'],copy['validity'],copy['uid']):self.retire(account,remote,prior)
        for entity in self.all('SELECT * FROM mail_sync_drafts WHERE owner=? AND account=?',(self.owner,account.key)):
            row=self.draft(entity['id']);copies=self.copies('draft',entity['id'],account.key)
            if not row or row['rev']!=entity['base_rev'] or entity['state'] in ('waiting_editor','remote_deleted_waiting'):continue
            current=[c for c in copies if c['content_hash']==entity['content_hash'] and remote.exists(c)]
            if current:
                keep=max(current,key=lambda c:c['uid'])
                for old in copies:
                    if (old['folder'],old['validity'],old['uid'])!=(keep['folder'],keep['validity'],keep['uid']):self.retire(account,remote,old)
        for copy in self.all("SELECT * FROM mail_sync_copies WHERE owner=? AND account=? AND kind='draft' AND removed=0",(self.owner,account.key)):
            entity=self.entity(copy['record_id']);row=self.draft(copy['record_id'])
            if not row:
                # Unknown SMTP outcomes retain remote drafts; a confirmed send or explicit discard can retire them.
                uncertain=self.one("SELECT 1 FROM mail_outbox WHERE owner=? AND draft_id=? AND state IN ('sending','unknown')",(self.owner,copy['record_id']))
                if not uncertain:self.retire(account,remote,copy)
            elif entity and entity['account']!=account.key and entity['base_rev']>0 and self.copies('draft',copy['record_id'],entity['account']):self.retire(account,remote,copy)
    def sent_fingerprint(self,row):
        p=json.loads(row['payload_json']);files=[]
        # Imported MIME is authoritative. Safe attachment presentation types
        # can differ from their original MIME and must not create a new sent row.
        if p.get('source') and p.get('raw_key') and p.get('from_id') in self.accounts:
            return parse(unpack(self.root,p['raw_key']),self.accounts[p['from_id']])[4]
        for item in p.get('attachments',[]):
            a=self.one('SELECT * FROM mail_assets WHERE owner=? AND id=?',(self.owner,item['id']))
            if not a:raise RuntimeError('sent_asset_missing')
            files.append({'name':a['name'],'mime':a['mime'],'data':base64.b64decode(a['data_base64'],validate=True)})
        return canonical(p,files)
    def import_sent(self,account,id,raw,item,p,files,mid,when):
        key='sent-source/'+account.key+'/'+digest(raw)+'.eml';put(self.root,key,raw)
        for i,f in enumerate(files):
            asset='sync-'+digest(id+':'+str(i));mime=f['mime'] if f['mime'] in ('image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain') else 'application/octet-stream'
            self.db.execute('INSERT OR IGNORE INTO mail_assets VALUES(?,?,?,?,?,?,?,?)',(self.owner,asset,id,f['name'],mime,len(f['data']),base64.b64encode(f['data']).decode(),when));url='/api/mail-workspace/assets/'+asset;p['attachments'].append({'id':asset,'name':f['name'],'type':mime,'size':len(f['data']),'url':url})
            if f['cid']:p['html']=p['html'].replace('cid:'+f['cid'],url)
        p['raw_key']=key;p['source']={'account':account.key,'folder':item['folder'],'uidvalidity':item['validity'],'uid':item['uid']}
        self.db.execute("INSERT INTO mail_outbox VALUES(?,?,?,?,?, 'sent',?,'[]','[]','',?,?)",(self.owner,id,id,1,json.dumps(p,ensure_ascii=False),mid,when,when))
    def pull_sent(self,account,remote,items):
        rows=self.all("SELECT * FROM mail_outbox WHERE owner=? AND json_extract(payload_json,'$.from_id')=? AND state IN ('sent','partial','sending','unknown')",(self.owner,account.key));by_sync={sync_id(self.owner,'sent',r['id']):r for r in rows};by_mid={r['message_id']:r for r in rows if r['message_id']}
        for item in items:
            known=self.known(account.key,'sent',item)
            if known:
                if known['removed']:
                    with self.db:self.db.execute("UPDATE mail_sync_copies SET removed=0 WHERE owner=? AND account=? AND kind='sent' AND folder=? AND validity=? AND uid=?",(self.owner,account.key,item['folder'],item['validity'],item['uid']))
                continue
            raw=remote.raw(item);p,files,mid,when,fp=parse(raw,account,item['when']);prior=by_sync.get(item.get('sync_id')) or by_mid.get(mid)
            if prior and self.sent_fingerprint(prior)!=fp:prior=None
            if not prior and mid:
                mapped=self.one("SELECT record_id FROM mail_sync_copies WHERE owner=? AND account=? AND kind='sent' AND message_id=? AND content_hash=? LIMIT 1",(self.owner,account.key,mid,fp))
                if mapped:prior=self.one('SELECT * FROM mail_outbox WHERE owner=? AND id=?',(self.owner,mapped[0]))
            if prior and self.sent_fingerprint(prior)!=fp:prior=None
            if not prior:
                for r in rows:
                    old=json.loads(r['payload_json'])
                    if r['state'] not in ('sent','partial') or old.get('source') or self.copies('sent',r['id']):continue
                    if abs((datetime.fromisoformat(r['created_at'].replace('Z','+00:00'))-datetime.fromisoformat(when.replace('Z','+00:00'))).total_seconds())<=180 and self.sent_fingerprint(r)==fp:prior=r;break
            id=prior['id'] if prior else 'sent-sync-'+digest(account.key+'\0'+(mid or digest(raw))+'\0'+fp)
            with self.db:
                if not prior and not self.one('SELECT 1 FROM mail_outbox WHERE owner=? AND id=?',(self.owner,id)):self.import_sent(account,id,raw,item,p,files,mid,when)
                self.remember(account.key,'sent',item,id,raw,fp)
                if prior and prior['state'] in ('sending','unknown'):
                    self.db.execute("UPDATE mail_outbox SET state='sent',error='',updated_at=? WHERE owner=? AND id=? AND state IN ('sending','unknown')",(now(),self.owner,id))
                    self.db.execute('DELETE FROM mail_drafts WHERE owner=? AND id=? AND rev=?',(self.owner,prior['draft_id'],prior['draft_rev']))
        present={(i['folder'],i['validity'],i['uid']) for i in items}
        for c in self.all("SELECT * FROM mail_sync_copies WHERE owner=? AND account=? AND kind='sent' AND removed=0",(self.owner,account.key)):
            if (c['folder'],c['validity'],c['uid']) not in present and self.missing(remote,c):
                with self.db:self.db.execute("UPDATE mail_sync_copies SET removed=1 WHERE owner=? AND account=? AND kind='sent' AND folder=? AND validity=? AND uid=?",(self.owner,account.key,c['folder'],c['validity'],c['uid']))
    def push_sent(self,account,remote):
        # Gmail SMTP owns its Sent copy. A missing/late source receipt is a
        # reconciliation responsibility, never permission to append a second.
        if getattr(remote,'smtp_saves_sent',False):return
        for row in self.all("SELECT * FROM mail_outbox WHERE owner=? AND state IN ('sent','partial') AND json_extract(payload_json,'$.from_id')=?",(self.owner,account.key)):
            copies=self.copies('sent',row['id'],account.key);p=json.loads(row['payload_json'])
            if not copies and not p.get('source') and not self.copies('sent',row['id'],account.key,all=True):
                if (datetime.now(timezone.utc)-datetime.fromisoformat(row['created_at'].replace('Z','+00:00'))).total_seconds()<30:continue
                def raw(op):
                    if p.get('raw_key'):value=unpack(self.root,p['raw_key'])
                    else:
                        assets=[dict(self.one('SELECT * FROM mail_assets WHERE owner=? AND id=?',(self.owner,a['id']))) for a in p.get('attachments',[])]
                        value=self.compile({**p,'assets':assets,'date':row['created_at'],'messageId':row['message_id'],'sync':{'syncId':sync_id(self.owner,'sent',row['id']),'operationId':op,'kind':'sent'}})
                    return stamp_headers(value,sync_id(self.owner,'sent',row['id']),op,'sent',p.get('bcc'))
                self.append(account,remote,'sent',row['id'],row['draft_rev'],raw);copies=self.copies('sent',row['id'],account.key)
            # Only our explicitly identified extra copies are retired, never coincidentally similar mail.
            if len(copies)>1:
                copies=[c for c in copies if remote.exists(c)]
                copies=sorted(copies,key=lambda c:(c['operation_id'].startswith('push-'),c['uid']))
                for extra in copies[1:]:
                    if extra['operation_id'].startswith('push-'):self.retire(account,remote,extra)
    def account(self,account,remote):
        try:
            sent_items=remote.scan('sent');draft_items=remote.scan('draft')
            self.pull_sent(account,remote,sent_items);self.pull_drafts(account,remote,draft_items)
            self.push_drafts(account,remote);self.push_sent(account,remote)
            # A deferred edit is not a sync error; its two versions stay durable.
            with self.db:self.db.execute("INSERT INTO mail_sync_status VALUES(?,?,'ok',?,?,'') ON CONFLICT(owner,account) DO UPDATE SET state='ok',checked_at=excluded.checked_at,last_success=excluded.last_success,error=''",(self.owner,account.key,now(),now()))
            return {'account':account.key,'state':'ok'}
        except Exception as error:
            code=str(error) if isinstance(error,(Pending,Rejected,Missing,RuntimeError)) and re.fullmatch(r'[a-z_]+',str(error)) else type(error).__name__
            with self.db:self.db.execute("INSERT INTO mail_sync_status VALUES(?,?,'error',?,'',?) ON CONFLICT(owner,account) DO UPDATE SET state='error',checked_at=excluded.checked_at,error=excluded.error",(self.owner,account.key,now(),code[:100]))
            return {'account':account.key,'state':'error','error':code[:100]}
