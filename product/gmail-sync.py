"""Gmail state owner: immutable identity, idempotent effects, no EXPUNGE.

All label UIDs remain original proofs. State is reconciled once per Gmail ID;
workspace draft versions use the shared revision/lease/operation journal.
"""
import importlib.util,json,pathlib,re,hashlib
HERE=pathlib.Path(__file__).resolve().parent
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
metadata=module('gmail_sync_metadata','gmail.py').metadata
decode=module('gmail_sync_inventory','source-inventory.py').decode_folder
state=module('gmail_shared_state','state-worker.py')

def identity_key(account,mid,revision):
    return state.gmail_op_id(account,mid,revision)

class GmailRemote:
    smtp_saves_sent=True
    def __init__(self,remote):
        self.r=remote;self.c=remote.c;self.configured=remote.configured
        # imaplib caches the greeting's pre-auth capabilities. Gmail advertises
        # MOVE/UIDPLUS only after authentication; query the actual session.
        status,parts=self.c.capability()
        if status!='OK' or not parts:raise RuntimeError('gmail_capability_unavailable')
        remote.cap={v.upper() for p in parts if isinstance(p,bytes) for v in p.decode('ascii').split()}
        if 'X-GM-EXT-1' not in remote.cap or 'MOVE' not in remote.cap:
            raise RuntimeError('gmail_sync_capability_missing')
    def __getattr__(self,name):return getattr(self.r,name)
    def exists(self,item):
        item=dict(item)
        # An old read-only draft may first have been collected from All Mail
        # or Trash. Its original still exists there, but its Draft role is gone.
        # The shared missing debounce owns retiring that editable projection.
        if item.get('kind')=='draft' and item['folder'] not in self.r.folders('draft'):return False
        return self.r.exists(item)
    def folder(self,role):
        values=[f['name'] for f in self.configured if f['kind']==role]
        if len(values)!=1:raise RuntimeError('gmail_target_folder_ambiguous')
        return values[0]
    def fetch(self,folder,uids):
        validity=self.r.select(folder);out=[]
        if not uids:return out
        status,rows=self.c.uid('FETCH',','.join(map(str,uids)),'(UID FLAGS X-GM-MSGID X-GM-LABELS)')
        if status!='OK':raise RuntimeError('gmail_state_fetch_failed')
        for part in rows or []:
            raw=part[0] if isinstance(part,tuple) else part
            if not isinstance(raw,bytes):continue
            uid=re.search(rb'\bUID (\d+)',raw);flags=re.search(rb'FLAGS \(([^)]*)\)',raw)
            if not uid or not flags:raise RuntimeError('gmail_state_fetch_invalid')
            labels=metadata(raw,decode);values=flags[1].lower().split()
            item={'folder':folder,'validity':validity,'uid':uid[1].decode(),**labels,'seen':b'\\seen' in values,'flagged':b'\\flagged' in values}
            kind=next(f['kind'] for f in self.configured if f['name']==folder)
            implicit={'inbox':'\\Inbox','sent':'\\Sent','drafts':'\\Draft','trash':'\\Trash','junk':'\\Spam'}.get(kind)
            if implicit and implicit.lower() not in [v.lower() for v in item['labels']]:item['labels'].append(implicit)
            out.append(item)
        if {int(i['uid']) for i in out}!=set(map(int,uids)):raise RuntimeError('gmail_inventory_changed')
        return out
    def inventory_all(self):
        out=[]
        for folder in self.configured:
            self.r.select(folder['name']);status,data=self.c.uid('SEARCH',None,'ALL')
            if status!='OK' or not data or not isinstance(data[0],bytes):raise RuntimeError('gmail_inventory_failed')
            uids=data[0].split()
            if any(not uid.isdigit() for uid in uids) or len(set(uids))!=len(uids):raise RuntimeError('gmail_inventory_invalid')
            for start in range(0,len(uids),250):out.extend(self.fetch(folder['name'],[int(v) for v in uids[start:start+250]]))
        return out
    def locate(self,mid,preferred=None):
        if not re.fullmatch(r'[1-9][0-9]{0,19}',mid):raise RuntimeError('gmail_identity_invalid')
        folders=[f['name'] for f in self.configured]
        if preferred in folders:folders.remove(preferred);folders.insert(0,preferred)
        for folder in folders:
            self.r.select(folder);status,data=self.c.uid('SEARCH',None,'X-GM-MSGID',mid)
            if status!='OK' or not data:raise RuntimeError('gmail_identity_lookup_failed')
            uids=data[0].split()
            if len(uids)>1 or any(not v.isdigit() for v in uids):raise RuntimeError('gmail_identity_ambiguous')
            if uids:
                item=self.fetch(folder,[int(uids[0])])[0]
                if item['message_id']!=mid:raise RuntimeError('gmail_identity_changed')
                return item
        return None
    def flags(self,item,desired):
        if self.r.select(item['folder'],write=True)!=item['validity']:raise state.Unknown('state_uidvalidity_changed')
        actual=self.fetch(item['folder'],[int(item['uid'])])[0]
        if actual['message_id']!=item['message_id']:raise state.Unknown('gmail_identity_changed')
        self.r.select(item['folder'],write=True)
        for key,flag in [('is_read','\\Seen'),('is_starred','\\Flagged')]:
            status,_=self.c.uid('STORE',item['uid'],'+FLAGS.SILENT' if desired[key] else '-FLAGS.SILENT','('+flag+')')
            if status!='OK':raise state.Unknown('state_flags_unconfirmed')
        actual=self.fetch(item['folder'],[int(item['uid'])])[0]
        if actual['seen']!=bool(desired['is_read']) or actual['flagged']!=bool(desired['is_starred']):raise state.Unknown('state_flags_unconfirmed')
        return actual
    def move(self,item,target):
        # Target is a discovered role; MOVE is server-side and never marks any
        # Trash UID deleted. A lost reply is resolved by the immutable ID.
        if item['folder']==target:return item
        if self.r.select(item['folder'],write=True)!=item['validity']:raise state.Unknown('state_uidvalidity_changed')
        actual=self.fetch(item['folder'],[int(item['uid'])])[0]
        if actual['message_id']!=item['message_id']:raise state.Unknown('gmail_identity_changed')
        self.r.select(item['folder'],write=True)
        name=self.r.encode(target);status,_=self.c.uid('MOVE',item['uid'],'"'+name.replace('\\','\\\\').replace('"','\\"')+'"')
        if status!='OK':raise state.Unknown('gmail_move_confirmation_pending')
        result=self.locate(item['message_id'],target)
        if not result or result['folder']!=target:raise state.Unknown('gmail_move_confirmation_pending')
        return result
    def retire_recoverable(self,copy):
        trash=self.folder('trash')
        # The archived raw remains the proof when a preceding attempt already
        # moved this UID. Never treat an unrelated replacement UID as authority.
        raw=self.r.raw(copy) if self.r.exists(copy) else None
        if raw is not None:
            if hashlib.sha256(raw).hexdigest()!=copy['raw_sha']:raise RuntimeError('gmail_draft_original_changed')
            item=self.fetch(copy['folder'],[int(copy['uid'])])[0]
            self.move(item,trash)
        else:
            # No source UID means retirement is complete; no destructive retry.
            return
    def delete_uid(self,item):raise RuntimeError('gmail_expunge_forbidden')

class GmailStateSync(state.StateSync):
    def __init__(self,db,objects,reader):
        super().__init__(db,objects,reader)
        db.execute('CREATE TABLE IF NOT EXISTS product_gmail_state(account TEXT,message_id TEXT,email_id INTEGER,is_read INTEGER,is_starred INTEGER,folder TEXT,labels_json TEXT,restore_folder TEXT NOT NULL DEFAULT "",PRIMARY KEY(account,message_id))')
    def observe(self,account,remote,folders,discovered=False):
        items=remote.inventory_all();groups={}
        for item in items:groups.setdefault(item['message_id'],[]).append(item)
        copies=self.rows('SELECT c.*,g.message_id FROM product_source_copies c JOIN product_gmail_copies g USING(account,folder,validity,uid) WHERE c.account=?',(account,))
        with self.db:
            for copy in copies:
                item=next((i for i in groups.get(copy['message_id'],[]) if (i['folder'],i['validity'],i['uid'])==(copy['folder'],copy['validity'],copy['uid'])),None)
                self.db.execute('INSERT INTO product_copy_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(account,folder,validity,uid) DO UPDATE SET present=excluded.present,flagged=excluded.flagged',(*state.proof(copy).values(),int(item is not None),int(bool(item and item['flagged'])),''))
                if item:
                    self.db.execute('UPDATE product_source_copies SET seen=? WHERE account=? AND folder=? AND validity=? AND uid=?',(int(item['seen']),*state.proof(copy).values()))
                    self.db.execute('UPDATE product_gmail_copies SET labels_json=? WHERE account=? AND folder=? AND validity=? AND uid=?',(json.dumps(item['labels']),*state.proof(copy).values()))
            for mid,entries in groups.items():
                known=next((c for c in copies if c['message_id']==mid),None)
                if not known:continue # Source intake owns immutable originals.
                labels=sorted(set(v for i in entries for v in i['labels']));lower={v.lower() for v in labels}
                folder='trash' if '\\trash' in lower else 'drafts' if lower&{'\\draft','\\drafts'} else 'inbox' if '\\inbox' in lower else 'sent' if '\\sent' in lower else 'inbox'
                # Prefer an actual Inbox/Trash record over aggregate views.
                actual=next((i for i in entries if i['folder']==next((f['name'] for f in folders if f['kind']==folder),None)),entries[0])
                old=self.db.execute('SELECT * FROM product_gmail_state WHERE account=? AND message_id=?',(account,mid)).fetchone()
                restore=old['restore_folder'] if old else ''
                if folder!='trash':restore=actual['folder']
                self.db.execute('INSERT INTO product_gmail_state VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account,message_id) DO UPDATE SET is_read=excluded.is_read,is_starred=excluded.is_starred,folder=excluded.folder,labels_json=excluded.labels_json,restore_folder=excluded.restore_folder',(account,mid,known['email_id'],int(actual['seen']),int(actual['flagged']),folder,json.dumps(labels),restore))
                pending=self.db.execute("SELECT 1 FROM product_state_intents WHERE email_id=? AND state<>'confirmed'",(known['email_id'],)).fetchone()
                current=self.db.execute('SELECT * FROM emails WHERE id=?',(known['email_id'],)).fetchone()
                if pending:continue
                if not old:
                    # Receive-only workspace projections may already have been
                    # replaced/discarded at the provider before sync was enabled.
                    # Retain their originals, but retire that obsolete role;
                    # local Inbox/Trash and reading choices remain untouched.
                    if current['folder'] in ('drafts','sent') and current['folder']!=folder:
                        self.db.execute('UPDATE product_state_guard SET remote_apply=1 WHERE id=1')
                        self.db.execute('UPDATE emails SET folder=? WHERE id=?',(folder,known['email_id']))
                        self.db.execute('UPDATE product_state_guard SET remote_apply=0 WHERE id=1')
                    continue
                values=[current['is_read'],current['is_starred'],current['folder']]
                if old['is_read']!=int(actual['seen']):values[0]=int(actual['seen'])
                if old['is_starred']!=int(actual['flagged']):values[1]=int(actual['flagged'])
                if old['folder']!=folder:
                    # Another mailbox's live Inbox remains its own copy.
                    other=self.db.execute("SELECT 1 FROM product_source_copies c JOIN product_copy_state s USING(account,folder,validity,uid) WHERE c.email_id=? AND c.account<>? AND s.present=1 AND c.kind='inbox'",(known['email_id'],account)).fetchone()
                    if not other:values[2]=folder
                if tuple(values)!=(current['is_read'],current['is_starred'],current['folder']):
                    self.db.execute('UPDATE product_state_guard SET remote_apply=1 WHERE id=1')
                    self.db.execute('UPDATE emails SET is_read=?,is_starred=?,folder=? WHERE id=?',(*values,known['email_id']))
                    self.db.execute('UPDATE product_state_guard SET remote_apply=0 WHERE id=1')
        return items
    def _execute(self,op,remote,folders):
        source=json.loads(op['proof_json']);desired=json.loads(op['desired_json']);mid=source['message_id']
        row=self.db.execute('SELECT * FROM product_gmail_state WHERE account=? AND message_id=?',(op['account'],mid)).fetchone()
        item=remote.locate(mid)
        if not item:raise state.Unknown('gmail_source_missing')
        with self.db:self.db.execute("UPDATE product_state_ops SET state='applying',updated_at=? WHERE id=?",(state.stamp(),op['id']))
        labels={v.lower() for v in item['labels']}
        if desired['folder']=='trash' and '\\trash' not in labels:item=remote.move(item,remote.folder('trash'))
        elif desired['folder']!='trash' and '\\trash' in labels:
            target=row['restore_folder'] if row and row['restore_folder'] else remote.folder('inbox')
            if target==remote.folder('trash'):target=remote.folder('inbox')
            item=remote.move(item,target)
        actual=remote.flags(item,desired)
        if ('\\trash' in {v.lower() for v in actual['labels']})!=(desired['folder']=='trash'):raise state.Unknown('gmail_move_confirmation_pending')
        with self.db:
            lower={v.lower() for v in actual['labels']}
            folder='trash' if '\\trash' in lower else 'drafts' if lower&{'\\draft','\\drafts'} else 'inbox' if '\\inbox' in lower else 'sent' if '\\sent' in lower else 'inbox'
            # The acknowledged write becomes the next comparison baseline.
            # Otherwise a fast provider-side reversal could equal the pre-write
            # snapshot and disappear even though the local state changed.
            self.db.execute('UPDATE product_gmail_state SET is_read=?,is_starred=?,folder=?,labels_json=?,restore_folder=CASE WHEN ?<>\'trash\' THEN ? ELSE restore_folder END WHERE account=? AND message_id=?',(int(actual['seen']),int(actual['flagged']),folder,json.dumps(actual['labels']),folder,actual['folder'],op['account'],mid))
            # Mirror the identity-level receipt onto extant UID proofs so the
            # shared multi-account intent can finish only after every source.
            for copy in self.rows('SELECT c.* FROM product_source_copies c JOIN product_gmail_copies g USING(account,folder,validity,uid) WHERE c.account=? AND g.message_id=?',(op['account'],mid)):
                key=self._prepare(copy,{'revision':op['revision'],**desired})
                self.db.execute("UPDATE product_state_ops SET state='confirmed',error='' WHERE id=?",(key,))
            self.db.execute("UPDATE product_state_ops SET state='confirmed',error='',updated_at=? WHERE id=?",(state.stamp(),op['id']))
    def push(self,account,remote,folders):
        errors=[]
        for op in self.rows("SELECT * FROM product_state_ops WHERE account=? AND state<>'confirmed' ORDER BY updated_at,id",(account,)):
            self._attempt(op,remote,folders,errors)
        for row in self.rows("SELECT s.*,i.revision,i.is_read AS wanted_read,i.is_starred AS wanted_star,i.folder AS wanted_folder FROM product_gmail_state s JOIN product_state_intents i ON s.email_id=i.email_id WHERE s.account=? AND i.state<>'confirmed'",(account,)):
            if self.db.execute("SELECT 1 FROM product_state_ops WHERE email_id=? AND account=? AND state<>'confirmed'",(row['email_id'],account)).fetchone():continue
            key=identity_key(account,row['message_id'],row['revision']);desired={'is_read':row['wanted_read'],'is_starred':row['wanted_star'],'folder':row['wanted_folder']}
            with self.db:self.db.execute("INSERT OR IGNORE INTO product_state_ops VALUES(?,?,?,?,?,?,'prepared','',?,'')",(key,row['email_id'],row['revision'],account,json.dumps({'account':account,'message_id':row['message_id']}),json.dumps(desired),state.stamp()))
            op=dict(self.db.execute('SELECT * FROM product_state_ops WHERE id=?',(key,)).fetchone())
            if op['state']!='confirmed':self._attempt(op,remote,folders,errors)
        return errors
