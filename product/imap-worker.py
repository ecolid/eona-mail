#!/usr/bin/env python3
"""Portable read-only IMAP ingestion. All Mail writes go through typed API routes."""
import argparse,base64,imaplib,json,os,pathlib,re,ssl,urllib.request,urllib.parse,importlib.util,tempfile,time,email.utils,datetime
secret_spec=importlib.util.spec_from_file_location('mail_secret_files',pathlib.Path(__file__).with_name('secret-files.py'));secret_files=importlib.util.module_from_spec(secret_spec);secret_spec.loader.exec_module(secret_files)
spec=importlib.util.spec_from_file_location("mail_imap_protocol",pathlib.Path(__file__).with_name("imap-protocol.py"));protocol=importlib.util.module_from_spec(spec);spec.loader.exec_module(protocol)
inventory_spec=importlib.util.spec_from_file_location('mail_source_inventory',pathlib.Path(__file__).with_name('source-inventory.py'));inventory=importlib.util.module_from_spec(inventory_spec);inventory_spec.loader.exec_module(inventory)

raw_spec=importlib.util.spec_from_file_location('mail_original_reader',pathlib.Path(__file__).parent/'sync/sent.py');original_reader=importlib.util.module_from_spec(raw_spec);raw_spec.loader.exec_module(original_reader)

def secret(values, name):
    value=os.environ.get(name) or values.get(name)
    if not isinstance(value,str) or not value:raise ValueError('source_credential_missing')
    return value

class API:
    def __init__(self, config, credentials):
        self.config=config;self.token=secret(credentials,'MAIL_WORKER_TOKEN')
    def call(self,path,body=None):
        url=(self.config.get('internal_url') or self.config['origin'])+path
        data=None if body is None else json.dumps(body).encode()
        headers={'Authorization':'Bearer '+self.token,'Host':urllib.parse.urlsplit(self.config['origin']).netloc,'Content-Type':'application/json'}
        request=urllib.request.Request(url,data=data,headers=headers)
        # These destinations are administrator configuration; redirects cannot forward credentials.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args):return None
        with urllib.request.build_opener(NoRedirect).open(request,timeout=90) as response:return json.load(response)

def uids(client,start,end='*'):
    status,values=client.uid('search',None,'UID',f'{start}:{end}')
    if status!='OK':raise ValueError('source_search_failed')
    return sorted({int(x) for x in (values[0] or b'').split() if int(x)>=start and (end=='*' or int(x)<=end)})

def read_original(client,uid):
    status,parts=client.uid('fetch',str(uid),'(UID FLAGS INTERNALDATE BODY.PEEK[])')
    records=[x for x in parts or [] if isinstance(x,tuple) and len(x)==2]
    if status!='OK':raise ValueError('source_fetch_failed')
    if len(records)==1 and isinstance(records[0][1],bytes) and records[0][1]:
        header,raw=records[0]
    elif not records or (len(records)==1 and records[0][1]==b''):
        try:
            with tempfile.TemporaryDirectory(prefix='mail-source-') as directory:
                path=original_reader.fetch_raw(client,uid,directory);raw=path.read_bytes()
        except RuntimeError as error:
            if str(error) not in ['sent_body_incomplete','sent_literal_incomplete','sent_body_changed','sent_size_missing','sent_original_too_large']:raise
            raise RuntimeError('source_original_unavailable') from error
        flags_status,flags_parts=client.uid('fetch',str(uid),'(UID FLAGS INTERNALDATE)')
        header=b' '.join(p for p in flags_parts or [] if isinstance(p,bytes))
        if flags_status!='OK':raise ValueError('source_flags_failed')
    else:raise ValueError('source_fetch_ambiguous')
    if not raw:raise RuntimeError('source_original_unavailable')
    if not re.search(rb'\bUID\s+'+str(uid).encode()+rb'\b',header):raise ValueError('source_uid_mismatch')
    return header,raw

def collect_folder(client,api,account,folder,previous=None,limit=100,audit=False):
    old=previous or {}
    gaps=json.loads(old.get('gaps_json','[]')) if 'gaps' not in old else [dict(g) for g in old['gaps']]
    state={'account':account['id'],'folder':folder['name'],'validity':old.get('validity',''),'last_uid':old.get('last_uid',0),'backfill_cursor':old.get('backfill_cursor',0),'backfill_until':old.get('backfill_until',0),'state':'error','gaps':gaps}
    def save():
        state['state']='error' if state['gaps'] else 'backfilling' if state['backfill_cursor']<state['backfill_until'] else 'ok'
        api.call('/internal/product/source-status',state)
    try:
        status,_=client.select('"'+protocol.modified_utf7(folder['name']).replace('\\','\\\\').replace('"','\\"')+'"',readonly=True)
        if status!='OK':raise ValueError('source_folder_unavailable')
        _,values=client.response('UIDVALIDITY');validity=(values or [None])[0]
        if not validity or not validity.isdigit():raise ValueError('source_uidvalidity_missing')
        validity=validity.decode()
        if state['validity']!=validity:
            current=uids(client,1);maximum=max(current,default=0)
            state.update(validity=validity,last_uid=maximum,backfill_cursor=0,backfill_until=maximum)
            save()  # Old-validity gaps remain unresolved, never reused as new UIDs.
        coverage_uids=inventory.all_uids(client) if audit else None
        def coverage():return api.call('/internal/product/source-coverage',{'account':account['id'],'folder':folder['name'],'wire_folder':protocol.modified_utf7(folder['name']),'validity':validity,'uids':[str(uid) for uid in coverage_uids]})
        missing=coverage()['missing'] if audit else []
        attempted=set()
        groups=[(False,uids(client,state['last_uid']+1)[:limit])]
        if state['backfill_cursor']<state['backfill_until']:
            groups.append((True,uids(client,state['backfill_cursor']+1,state['backfill_until'])[:limit]))
        def known(items):
            return set(api.call('/internal/product/known-copies',{'account':account['id'],'folder':folder['name'],'validity':validity,'uids':[str(x) for x in items]}).get('uids',[])) if items else set()
        def receive(uid,historical):
            attempted.add(uid)
            try:header,raw=read_original(client,uid)
            except RuntimeError as error:
                if str(error)!='source_original_unavailable':raise
                gap=next((g for g in state['gaps'] if g['uid']==str(uid) and g['validity']==validity),None)
                if gap is None:
                    if len(state['gaps'])>=1000:raise ValueError('source_gap_capacity')
                    gap={'uid':str(uid),'validity':validity,'historical':historical,'retry_after':0};state['gaps'].append(gap)
                gap['retry_after']=int(time.time())+300
                return False
            date=re.search(rb'\bINTERNALDATE\s+"([^"]+)"',header)
            internal_date=email.utils.parsedate_to_datetime(date[1].decode('ascii')).astimezone(datetime.timezone.utc).isoformat() if date else None
            api.call('/internal/product/ingest',{'raw_base64':base64.b64encode(raw).decode(),'source':{'account':account['id'],'folder':folder['name'],'validity':validity,'uid':str(uid),'kind':folder['kind'],'historical':historical,'seen':b'\\Seen' in header,'internal_date':internal_date}})
            state['gaps']=[g for g in state['gaps'] if not (g['uid']==str(uid) and g['validity']==validity)]
            return True
        for historical,items in groups:
            proven=known(items)
            for uid in items:
                received=str(uid) in proven or receive(uid,historical)
                state['backfill_cursor' if historical else 'last_uid']=uid
                if not received:save()  # Gap and scan cursor commit atomically before continuing.
        # A full UID set is cheap; only missing originals are fetched. This also
        # finds interior gaps behind a previously completed high-water cursor.
        for uid in [int(x) for x in missing if int(x) not in attempted][:limit]:
            gap=next((g for g in state['gaps'] if g['uid']==str(uid) and g['validity']==validity),None)
            if gap and gap['retry_after']>time.time():continue
            if not receive(uid,True):save()
        # New arrivals and historical progress cannot be starved by a broken old UID.
        retry=sorted((g for g in state['gaps'] if g['validity']==validity and g['retry_after']<=time.time()),key=lambda g:g['retry_after'])[:5]
        proven=known([int(g['uid']) for g in retry])
        for gap in retry:
            if gap['uid'] in proven:state['gaps']=[g for g in state['gaps'] if g is not gap]
            else:receive(int(gap['uid']),gap['historical'])
        if state['backfill_cursor']<state['backfill_until'] and not uids(client,state['backfill_cursor']+1,state['backfill_until']):state['backfill_cursor']=state['backfill_until']
        save()
        if audit:coverage()
        return state
    except Exception:
        state['state']='error';api.call('/internal/product/source-status',state);raise

def run_once(config,credentials,api,connect=imaplib.IMAP4_SSL):
    if config.get('mode')!='personal':raise ValueError('demo_worker_forbidden')
    snapshot=api.call('/internal/product/status');previous={(x['account'],x['folder']):x for x in snapshot['sources']};audits={(x['account'],x['folder']):x for x in snapshot.get('audits',[])};results=[]
    for account in config.get('accounts',[]):
        settings=account.get('imap')
        if not settings:continue
        client=None
        try:
            client=connect(settings['host'],settings['port'],ssl_context=ssl.create_default_context(),timeout=30)
            client.login(settings['user'],secret(credentials,settings['password_env']));protocol.identify(client)
            folders=inventory.discover(client,settings)
            api.call('/internal/product/source-inventory',{'account':account['id'],'state':'connected','folders':folders})
            for folder in folders:
                old_audit=audits.get((account['id'],folder['name']))
                try:last_audit=datetime.datetime.fromisoformat(old_audit['checked_at'].replace('Z','+00:00')).timestamp() if old_audit else 0
                except (ValueError,KeyError):last_audit=0
                audit=time.time()-last_audit>=240
                try:
                    if config.get('sync',{}).get('enabled') and folder['kind'] in ['sent','drafts']:
                        if audit:
                            status,_=client.select('"'+protocol.modified_utf7(folder['name']).replace('\\','\\\\').replace('"','\\"')+'"',readonly=True)
                            if status!='OK':raise RuntimeError('source_folder_unavailable')
                            validity=client.response('UIDVALIDITY')[1][0].decode()
                            api.call('/internal/product/source-coverage',{'account':account['id'],'folder':folder['name'],'wire_folder':protocol.modified_utf7(folder['name']),'validity':validity,'uids':[str(uid) for uid in inventory.all_uids(client)]})
                        continue
                    state=collect_folder(client,api,account,folder,previous.get((account['id'],folder['name'])),audit=audit);results.append({'account':account['id'],'folder':folder['name'],'state':state['state']})
                except Exception:
                    api.call('/internal/product/source-coverage',{'account':account['id'],'folder':folder['name'],'error':'source_folder_unavailable'})
                    results.append({'account':account['id'],'folder':folder['name'],'state':'error'})
        except Exception:
            api.call('/internal/product/source-inventory',{'account':account['id'],'state':'error','folders':[]})
            for folder in settings['folders']:
                if config.get('sync',{}).get('enabled') and folder['kind'] in ['sent','drafts']:continue
                old=previous.get((account['id'],folder['name']),{})
                state={'account':account['id'],'folder':folder['name'],'validity':old.get('validity',''),'last_uid':old.get('last_uid',0),'backfill_cursor':old.get('backfill_cursor',0),'backfill_until':old.get('backfill_until',0),'state':'error','gaps':old.get('gaps',json.loads(old.get('gaps_json','[]')))}
                api.call('/internal/product/source-status',state)
            results.append({'account':account['id'],'state':'error'})
        finally:
            if client:
                try:client.logout()
                except Exception:pass
    return results

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    file=pathlib.Path(args.config).resolve();config=json.loads(file.read_text())
    credentials=secret_files.load(config,file.parent)
    results=run_once(config,credentials,API(config,credentials))
    print(json.dumps({'sources':results}));return int(any(x['state']=='error' for x in results))
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:print(json.dumps({'error':'source_worker_failed'}));raise SystemExit(1)
