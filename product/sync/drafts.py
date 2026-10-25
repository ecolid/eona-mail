#!/usr/bin/env python3
"""Copy authorized provider drafts into Eona without overwriting local editing.

Default is EXAMINE-only inventory; --apply requires the trusted owner and data
paths. Original MIME is immutable, editable content uses the editor allowlist,
and source checkpoints commit with draft/files in the same transaction.
"""
import argparse,base64,contextlib,importlib.util,json,pathlib,re,sqlite3,sys
from datetime import datetime
from html.parser import HTMLParser

spec=importlib.util.spec_from_file_location('mail_sent_sync',pathlib.Path(__file__).with_name('sent.py'))
sent=importlib.util.module_from_spec(spec);spec.loader.exec_module(sent)

class DraftDocument(HTMLParser):
    def __init__(self,images):
        super().__init__(convert_charrefs=True);self.images=images;self.ops=[];self.stack=[];self.skip=[]
    def line(self,attrs=None):
        if self.ops and (not isinstance(self.ops[-1]['insert'],str) or not self.ops[-1]['insert'].endswith('\n')):
            self.ops.append({'insert':'\n',**({'attributes':attrs} if attrs else {})})
    def handle_starttag(self,tag,attrs):
        values=dict(attrs)
        if tag in ('head','style','script','iframe','object'):self.skip.append(tag);return
        if self.skip:return
        current=dict(self.stack[-1][1]) if self.stack else {}
        for t,key in [('b','bold'),('strong','bold'),('i','italic'),('em','italic'),('u','underline'),('s','strike'),('strike','strike'),('code','code')]:
            if tag==t:current[key]=True
        if tag=='a' and re.match(r'^(https?://|mailto:|tel:)[^\s<>"\x00-\x1f]+$',values.get('href',''),re.I):current['link']=values['href']
        block={}
        if re.fullmatch('h[1-6]',tag):block['header']=int(tag[1])
        if tag=='blockquote':block['blockquote']=True
        if tag=='li':block['list']='ordered' if any(t=='ol' for t,_,_ in self.stack) else 'bullet'
        for key,value in re.findall(r'([a-z-]+)\s*:\s*([^;]+)',values.get('style',''),re.I):
            value=value.strip().lower()
            if key in ('color','background-color') and re.fullmatch(r'#[0-9a-f]{3}(?:[0-9a-f]{3})?|rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\)',value):current['color' if key=='color' else 'background']=value
            if key=='font-weight' and value in ('bold','600','700','800','900'):current['bold']=True
            if key=='font-style' and value=='italic':current['italic']=True
            if key=='text-decoration' and 'underline' in value:current['underline']=True
            if key=='text-align' and value in ('center','right','justify'):block['align']=value
        if tag=='img':
            src=values.get('src','');image=self.images.get(src[4:]) if src.lower().startswith('cid:') else None
            if image:self.ops.append({'insert':{'image':'/api/mail-workspace/assets/'+image}})
            elif values.get('alt'):self.ops.append({'insert':values['alt']})
            return
        if tag=='br':self.ops.append({'insert':'\n'});return
        if tag=='hr':self.line();self.ops.append({'insert':{'divider':True}});return
        if tag in ('p','div','li','blockquote','pre') or re.fullmatch('h[1-6]',tag):self.line()
        self.stack.append((tag,current,block))
    def handle_endtag(self,tag):
        if self.skip:
            if tag==self.skip[-1]:self.skip.pop()
            return
        for i in range(len(self.stack)-1,-1,-1):
            if self.stack[i][0]==tag:
                block=self.stack[i][2]
                if tag in ('p','div','li','blockquote','pre') or re.fullmatch('h[1-6]',tag):self.line(block)
                del self.stack[i:];break
    def handle_data(self,data):
        if not self.skip and data:
            self.ops.append({'insert':data,**({'attributes':self.stack[-1][1]} if self.stack and self.stack[-1][1] else {})})
    def document(self):
        self.line();return {'ops':self.ops or [{'insert':'\n'}]}

def initialize(db):
    tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'mail_drafts','mail_assets'}.issubset(tables):raise RuntimeError('deploy_and_initialize_workspace_first')
    db.execute('CREATE TABLE IF NOT EXISTS mail_draft_sources(owner TEXT NOT NULL,account TEXT NOT NULL,folder TEXT NOT NULL,validity TEXT NOT NULL,uid INTEGER NOT NULL,record_id TEXT NOT NULL,raw_key TEXT NOT NULL,raw_sha TEXT NOT NULL,PRIMARY KEY(owner,account,folder,validity,uid))');db.commit()

def archive_one(db,root,owner,account,folder,validity,uid,raw,internal_date):
    payload,files,message_id,when=sent.parsed(raw,account,internal_date)
    digest=sent.file_sha(raw);source_key=f'draft-source/{account.key}/{digest}.eml';sha=sent.object_put(root,source_key,raw,source='provider-draft')
    existing=db.execute('SELECT record_id FROM mail_draft_sources WHERE owner=? AND account=? AND raw_sha=? LIMIT 1',(owner,account.key,digest)).fetchone()
    logical=sent.hashlib.sha256((account.key+'\0'+digest).encode()).hexdigest();record=existing[0] if existing else 'draft-import-'+logical
    with db:
        if not existing:
            attachments=[];images={}
            for i,item in enumerate(files):
                asset_id='draft-'+sent.hashlib.sha256((logical+':'+str(i)).encode()).hexdigest();mime=item['mime'];safe=mime if mime in ('image/png','image/jpeg','image/gif','image/webp','application/pdf','text/plain') else 'application/octet-stream'
                db.execute('INSERT INTO mail_assets(owner,id,draft_id,name,mime,size,data_base64,created_at) VALUES(?,?,?,?,?,?,?,?)',(owner,asset_id,record,item['name'],safe,len(item['data']),base64.b64encode(item['data']).decode(),when))
                if item['cid'] and safe.startswith('image/'):images[item['cid']]=asset_id
                attachments.append({'id':asset_id,'name':item['name'],'type':safe,'size':len(item['data']),'url':'/api/mail-workspace/assets/'+asset_id})
            parser=DraftDocument(images)
            if payload['html']:parser.feed(payload['html']);document=parser.document()
            else:document={'ops':[{'insert':payload['body'].rstrip('\n')+'\n'}]}
            inline={op['insert']['image'].rsplit('/',1)[1] for op in document['ops'] if isinstance(op['insert'],dict) and op['insert'].get('image')}
            envelope={'from_id':account.key,'cc':', '.join(sent.email.utils.formataddr((p['name'],p['address'])) for p in payload['cc']),'bcc':', '.join(sent.email.utils.formataddr((p['name'],p['address'])) for p in payload['bcc']),'document':document,'attachments':[a for a in attachments if a['id'] not in inline],'source':{'raw_key':source_key,'message_id':message_id,'account':account.key}}
            plain=''.join(op['insert'] if isinstance(op['insert'],str) else '[图片]' if 'image' in op['insert'] else '\n' for op in document['ops'])
            db.execute('INSERT INTO mail_drafts(owner,id,to_addr,subject,body,rev,updated_at,envelope_json) VALUES(?,?,?,?,?,1,?,?)',(owner,record,', '.join(sent.email.utils.formataddr((p['name'],p['address'])) for p in payload['to']),payload['subject'],plain,when,json.dumps(envelope,ensure_ascii=False)))
        db.execute('INSERT OR REPLACE INTO mail_draft_sources(owner,account,folder,validity,uid,record_id,raw_key,raw_sha) VALUES(?,?,?,?,?,?,?,?)',(owner,account.key,folder,validity,uid,record,source_key,sha))
    return bool(existing)
