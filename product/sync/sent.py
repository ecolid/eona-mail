#!/usr/bin/env python3
"""Read-only provider Sent -> owner-owned Eona sent archive. Never sends/appends mail.

Default is a read-only inventory. --apply requires explicit DB, object root and
trusted owner. UID checkpoints are committed only with the archived record.
Original MIME is preserved in the existing hash-addressed FileObjects format.
"""
import argparse,base64,contextlib,email,email.policy,email.utils,hashlib,json,os,pathlib,re,sqlite3,struct,sys,tempfile,shutil
from datetime import datetime,timezone

def folders(connection,decode,kind='sent'):
    status,rows=connection.list()
    if status!='OK' or rows is None:raise RuntimeError('sent_folder_inventory_failed')
    special=[];named=[]
    for row in rows:
        if not isinstance(row,bytes):continue
        m=re.match(rb'^\(([^)]*)\)\s+(?:"[^"]*"|NIL)\s+(.+)$',row)
        if not m:raise RuntimeError('unrecognized_folder_listing')
        flags=m[1].lower().split();raw=m[2].decode('ascii','strict')
        if raw.startswith('"') and raw.endswith('"'):raw=raw[1:-1].replace('\\"','"').replace('\\\\','\\')
        if b'\\noselect' in flags:continue
        marker,pattern=(b'\\drafts',r'(?:drafts?|草稿箱?|草稿邮件)') if kind=='drafts' else (b'\\sent',r'(?:sent(?: messages| items| mail)?|已发送|发件箱|已发邮件)')
        if marker in flags:special.append(raw)
        elif re.fullmatch(pattern,decode(raw),re.I):named.append(raw)
    result=list(dict.fromkeys(special or named))
    if not result:raise RuntimeError(kind+'_folder_not_identified')
    return result

def examine(connection,folder):
    status,data=connection.select('"'+folder.replace('\\','\\\\').replace('"','\\"')+'"',readonly=True)
    if status!='OK' or not data or not isinstance(data[0],bytes) or not data[0].isdigit():raise RuntimeError('sent_examine_failed')
    exists=int(data[0]);response=connection.response('UIDVALIDITY');validity=response[1][0].decode() if response and response[1] and response[1][0] else ''
    if not validity.isdigit():raise RuntimeError('uidvalidity_missing')
    status,data=connection.uid('SEARCH',None,'ALL')
    if status!='OK' or not data or not isinstance(data[0],bytes):raise RuntimeError('sent_uid_inventory_failed')
    uids=data[0].split()
    if len(set(uids))!=len(uids) or len(uids)!=exists:raise RuntimeError('sent_count_mismatch')
    if any(not u.isdigit() for u in uids):raise RuntimeError('invalid_sent_uid')
    return validity,[int(u) for u in uids]

def fetch_raw(connection,uid,directory):
    """Read complete literals; RFC822.SIZE is a hint, not a truncation boundary.

    Some providers return a stale/normalized size. A discrepancy is checked
    against one atomic BODY.PEEK[] literal before accepting the original bytes.
    """
    status,parts=connection.uid('FETCH',str(uid),'(RFC822.SIZE)')
    meta=b' '.join(p for p in parts or [] if isinstance(p,bytes));size=re.search(rb'RFC822.SIZE (\d+)',meta)
    if status!='OK' or not size:raise RuntimeError('sent_size_missing')
    declared=int(size[1]);limit=256*1024*1024
    if declared>limit:raise RuntimeError('sent_original_too_large')
    fd,path=tempfile.mkstemp(dir=directory,prefix='.sent-raw-')
    try:
        with os.fdopen(fd,'w+b') as target:
            offset=0;need_full=False
            while True:
                count=512*1024;status,parts=connection.uid('FETCH',str(uid),f'(BODY.PEEK[]<{offset}.{count}>)')
                chunks=[p[1] for p in parts or [] if isinstance(p,tuple) and isinstance(p[1],bytes)]
                if status!='OK':raise RuntimeError('sent_body_incomplete')
                if len(chunks)!=1:need_full=True;break
                chunk=chunks[0]
                if len(chunk)>count:need_full=True;break
                target.write(chunk);offset+=len(chunk)
                if offset>limit:raise RuntimeError('sent_original_too_large')
                if len(chunk)<count:break
            if need_full or offset!=declared:
                status,parts=connection.uid('FETCH',str(uid),'(BODY.PEEK[])')
                literals=[p for p in parts or [] if isinstance(p,tuple) and isinstance(p[1],bytes)]
                if status!='OK' or len(literals)!=1:raise RuntimeError('sent_body_incomplete')
                header,raw=literals[0];length=re.search(rb'\{(\d+)\}$',header)
                if not length or int(length[1])!=len(raw) or len(raw)>limit:raise RuntimeError('sent_literal_incomplete')
                target.seek(0);prefix=target.read()
                if not raw.startswith(prefix):raise RuntimeError('sent_body_changed')
                target.seek(0);target.write(raw);target.truncate()
            target.flush();os.fsync(target.fileno())
        return pathlib.Path(path)
    except BaseException:
        pathlib.Path(path).unlink(missing_ok=True);raise

def file_sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):digest.update(chunk)
    return digest.hexdigest()

def object_matches(root,key,sha):
    digest=hashlib.sha256(key.encode()).hexdigest();target=root/digest[:2]/(digest+'.obj')
    try:
        with target.open('rb') as source:
            length=struct.unpack('>I',source.read(4))[0]
            if length>65536:return False
            meta=json.loads(source.read(length));check=hashlib.sha256();size=0
            for chunk in iter(lambda:source.read(1024*1024),b''):check.update(chunk);size+=len(chunk)
            return meta['key']==key and meta['size']==size and meta['sha256']==sha==check.hexdigest()
    except (OSError,ValueError,KeyError,struct.error):return False

def object_put(root,key,raw,source='provider-sent'):
    sha=file_sha(raw);meta={'key':key,'size':raw.stat().st_size,'sha256':sha,'httpMetadata':{'contentType':'message/rfc822'},'customMetadata':{'source':source}}
    header=json.dumps(meta,separators=(',',':')).encode();digest=hashlib.sha256(key.encode()).hexdigest();target=root/digest[:2]/(digest+'.obj');target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,temporary=tempfile.mkstemp(dir=target.parent,prefix='.sent-')
    try:
        with os.fdopen(fd,'wb') as output,raw.open('rb') as source:
            output.write(struct.pack('>I',len(header))+header);shutil.copyfileobj(source,output,1024*1024);output.flush();os.fsync(output.fileno())
        os.replace(temporary,target)
        directory=os.open(target.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:pathlib.Path(temporary).unlink(missing_ok=True)
    return sha

def identity_header(message,name):
    # Identity headers are opaque values. The stdlib structured Message-ID
    # parser can throw on legacy malformed mail; preserve the original token.
    value=next((v for k,v in message.raw_items() if k.lower()==name.lower()),'')
    return re.sub(r'\r?\n[ \t]+',' ',str(value)).strip().encode('utf-8','surrogateescape').decode('utf-8','backslashreplace')

def addresses(message,name):
    return [{'name':str(n),'address':a.lower()} for n,a in email.utils.getaddresses(message.get_all(name,[])) if a and '@' in a]

def parsed(raw,account,fallback_date=None):
    with raw.open('rb') as stream:message=email.message_from_binary_file(stream,policy=email.policy.default)
    sender=addresses(message,'From');sender=sender[0] if sender else {'name':'','address':account.user}
    try:stamp=email.utils.parsedate_to_datetime(str(message.get('Date',''))) if message.get('Date') else None
    except (ValueError,TypeError):stamp=None
    stamp=stamp or fallback_date
    if stamp is None:raise RuntimeError('sent_original_date_missing')
    if stamp.tzinfo is None:stamp=stamp.replace(tzinfo=timezone.utc)
    when=stamp.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    text=[];html=[];attachments=[]
    for part in message.walk():
        if part.is_multipart():continue
        disposition=part.get_content_disposition();filename=part.get_filename();mime=part.get_content_type();content=part.get_payload(decode=True) or b''
        if disposition=='attachment' or filename or part.get('Content-ID'):
            attachments.append({'name':filename or 'image','mime':mime,'data':content,'cid':str(part.get('Content-ID','')).strip('<>')});continue
        if mime in ('text/plain','text/html'):
            try:value=content.decode(part.get_content_charset() or 'utf-8',errors='replace')
            except LookupError:value=content.decode('utf-8',errors='replace')
            (text if mime=='text/plain' else html).append(value)
    html='\n'.join(html);body='\n'.join(text) or re.sub(r'<[^>]+>',' ',html)
    return {'from_id':account.key,'from':sender,'to':addresses(message,'To'),'cc':addresses(message,'Cc'),'bcc':addresses(message,'Bcc'),'subject':str(message.get('Subject','')),'body':body,'html':html,'attachments':[]},attachments,identity_header(message,'Message-ID'),when

def initialize(db):
    tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'mail_outbox','mail_assets'}.issubset(tables):raise RuntimeError('deploy_and_initialize_workspace_first')
    db.execute('CREATE TABLE IF NOT EXISTS mail_sent_sources(owner TEXT NOT NULL,account TEXT NOT NULL,folder TEXT NOT NULL,validity TEXT NOT NULL,uid INTEGER NOT NULL,record_id TEXT NOT NULL,raw_key TEXT NOT NULL,raw_sha TEXT NOT NULL,PRIMARY KEY(owner,account,folder,validity,uid))');db.commit()

def archive_one(db,root,owner,account,folder,validity,uid,raw):
    payload,files,message_id,when=parsed(raw,account)
    digest=file_sha(raw);source_key=f'sent-source/{account.key}/{digest}.eml';sha=object_put(root,source_key,raw)
    # Message-ID+account is the primary logical identity; full raw hash is the fallback.
    logical=hashlib.sha256((account.key+'\0'+(message_id or digest)).encode()).hexdigest();record='import-'+logical
    existing=db.execute("SELECT id,payload_json,created_at FROM mail_outbox WHERE owner=? AND (id=? OR message_id=? OR (json_extract(payload_json,'$.from_id')=? AND json_extract(payload_json,'$.provider_message_id')=?)) ORDER BY created_at LIMIT 1",(owner,record,message_id or 'unmatchable',account.key,message_id or 'unmatchable')).fetchone()
    if not existing:
        prior=db.execute('SELECT record_id FROM mail_sent_sources WHERE owner=? AND account=? AND raw_sha=? LIMIT 1',(owner,account.key,digest)).fetchone()
        if prior:existing=db.execute('SELECT id,payload_json,created_at FROM mail_outbox WHERE owner=? AND id=?',(owner,prior[0])).fetchone()
    if not existing:
        # Providers may rewrite locally generated Message-ID. Compare actual
        # envelope, subject, text and a small date window before adding a copy.
        for row in db.execute("SELECT id,payload_json,created_at FROM mail_outbox WHERE owner=? AND json_extract(payload_json,'$.subject')=? AND json_extract(payload_json,'$.from.address')=? AND state IN ('sent','partial')",(owner,payload['subject'],payload['from']['address'])):
            old=json.loads(row[1])
            if old.get('raw_key') or old.get('source'):continue
            normalize=lambda value:re.sub(r'\s+',' ',value or '').strip()
            if normalize(old.get('body'))==normalize(payload['body']) and all({p['address'] for p in old.get(field,[])}=={p['address'] for p in payload[field]} for field in ['to','cc','bcc']) and abs((datetime.fromisoformat(row[2].replace('Z','+00:00'))-datetime.fromisoformat(when.replace('Z','+00:00'))).total_seconds())<180:existing=row;break
    if existing:record=existing[0]
    with db:
        if not existing:
            for i,item in enumerate(files):
                asset_id='import-'+hashlib.sha256((logical+':'+str(i)).encode()).hexdigest();encoded=base64.b64encode(item['data']).decode();mime=item['mime'];safe_mime=mime if mime in ('image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain') else 'application/octet-stream'
                db.execute('INSERT OR IGNORE INTO mail_assets(owner,id,draft_id,name,mime,size,data_base64,created_at) VALUES(?,?,?,?,?,?,?,?)',(owner,asset_id,record,item['name'],safe_mime,len(item['data']),encoded,when))
                url='/api/mail-workspace/assets/'+asset_id;payload['attachments'].append({'id':asset_id,'name':item['name'],'type':safe_mime,'size':len(item['data']),'url':url})
                if item['cid']:payload['html']=payload['html'].replace('cid:'+item['cid'],url)
            payload['raw_key']=source_key;payload['source']={'account':account.key,'folder':folder,'uidvalidity':validity,'uid':uid}
            db.execute("INSERT INTO mail_outbox(owner,id,draft_id,draft_rev,payload_json,state,message_id,accepted_json,rejected_json,error,created_at,updated_at) VALUES(?,?,?,?,?,'sent',?,'[]','[]','',?,?)",(owner,record,record,1,json.dumps(payload,ensure_ascii=False),message_id,when,when))
        else:
            old=json.loads(existing[1]);old['raw_key']=source_key;old['provider_message_id']=message_id;db.execute('UPDATE mail_outbox SET payload_json=? WHERE owner=? AND id=?',(json.dumps(old,ensure_ascii=False),owner,record))
        db.execute('INSERT OR REPLACE INTO mail_sent_sources(owner,account,folder,validity,uid,record_id,raw_key,raw_sha) VALUES(?,?,?,?,?,?,?,?)',(owner,account.key,folder,validity,uid,record,source_key,sha))
    return bool(existing)
