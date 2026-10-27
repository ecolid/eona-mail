#!/usr/bin/env python3
"""Run the shared Sent/Drafts reconciler with product-owned configuration."""
import argparse,base64,contextlib,fcntl,importlib.util,json,os,pathlib,sqlite3,ssl,imaplib,time,signal,threading,datetime
from types import SimpleNamespace
from importlib.machinery import SourceFileLoader
HERE=pathlib.Path(__file__).resolve().parent
secret_spec=importlib.util.spec_from_file_location('mail_secret_files',HERE/'secret-files.py');secret_files=importlib.util.module_from_spec(secret_spec);secret_spec.loader.exec_module(secret_files)
spec=importlib.util.spec_from_file_location('mail_product_sync',HERE/'sync/engine.py');core=importlib.util.module_from_spec(spec);spec.loader.exec_module(core)
state_spec=importlib.util.spec_from_file_location('mail_state_sync',HERE/'state-worker.py');state=importlib.util.module_from_spec(state_spec);state_spec.loader.exec_module(state)
protocol_spec=importlib.util.spec_from_file_location('mail_imap_protocol',HERE/'imap-protocol.py');protocol=importlib.util.module_from_spec(protocol_spec);protocol_spec.loader.exec_module(protocol)
modified_utf7=protocol.modified_utf7
class Remote(core.IMAP):
    def __init__(self,connection,root,folders):
        super().__init__(connection,lambda x:x,root);self.configured=folders
        self.wire_names={f['name']:modified_utf7(f['name']) for f in folders}
    def encode(self,folder):
        if folder in self.wire_names:return self.wire_names[folder]
        if folder in self.wire_names.values():return folder
        raise RuntimeError('source_folder_unconfigured')
    def select(self,folder,write=False):return super().select(self.encode(folder),write=write)
    def append(self,folder,raw,kind):return super().append(self.encode(folder),raw,kind)
    def folders(self,kind):
        role={'draft':'drafts','sent':'sent','backup':'trash'}[kind]
        found=[f['name'] for f in self.configured if f['kind']==role]
        if not found:raise RuntimeError('source_'+role+'_folder_unconfigured')
        if role=='trash' and len(found)!=1:raise RuntimeError('trash_folder_not_identified')
        return [self.encode(name) for name in found]

def run_once(config,credentials,connect=imaplib.IMAP4_SSL):
    if config.get('mode')!='personal' or not config.get('sync',{}).get('enabled'):raise ValueError('product_sync_not_enabled')
    root=pathlib.Path(config['data_root']);db=sqlite3.connect(root/'mail.db',timeout=30)
    identity=db.execute('SELECT owner,mode FROM product_meta WHERE id=1').fetchone()
    if identity!=(config['owner']['id'],'personal'):db.close();raise ValueError('product_sync_owner_mismatch')
    accounts=[SimpleNamespace(key=a['id'],user=a['address'],config=a) for a in config['accounts'] if a.get('imap') and a.get('sync',{}).get('enabled',True)]
    reports=[]
    try:
        with (root/'workspace-sync.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            engine=core.Sync(db,root/'objects',config['owner']['id'],accounts);engine.adopt()
            for account in accounts:
                connection=None;imap=account.config['imap'];name=imap['password_env'];password=os.environ.get(name) or credentials.get(name)
                try:
                    if not password:raise RuntimeError('source_credential_missing')
                    connection=connect(imap['host'],imap['port'],ssl_context=ssl.create_default_context(),timeout=30)
                    connection.login(imap['user'],password);protocol.identify(connection)
                    folders=list(imap['folders']);discovered=False
                    if imap.get('discovery')=='all':
                        row=db.execute('SELECT folders_json,state,checked_at FROM product_source_inventory WHERE account=?',(account.key,)).fetchone()
                        if row:
                            folders=list({f['name']:f for f in [*folders,*json.loads(row[0])]}.values())
                            discovered=row[1]=='connected' and time.time()-datetime.datetime.fromisoformat(row[2].replace('Z','+00:00')).timestamp()<300
                    remote=Remote(connection,root/'objects',folders);report=engine.account(account,remote)
                    states=state.StateSync(db,root/'objects',core.unpack);states.observe(account.key,state.IMAPState(remote),folders,discovered=discovered);errors=states.push(account.key,state.IMAPState(remote),folders);pending=states.complete()
                    if errors or pending:
                        code=errors[0] if errors else 'state_operation_pending'
                        report={'account':account.key,'state':'error','error':code}
                        with db:db.execute("UPDATE mail_sync_status SET state='error',error=? WHERE owner=? AND account=?",(code,config['owner']['id'],account.key))
                    reports.append(report)
                except Exception:
                    with db:db.execute("INSERT INTO mail_sync_status VALUES(?,?,'error',?,'','source_unavailable') ON CONFLICT(owner,account) DO UPDATE SET state='error',checked_at=excluded.checked_at,error=excluded.error",(config['owner']['id'],account.key,core.now()))
                    reports.append({'account':account.key,'state':'error','error':'source_unavailable'})
                finally:
                    if connection:
                        with contextlib.suppress(Exception):connection.logout()
        return reports
    finally:db.close()
def main():
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--daemon',action='store_true');p.add_argument('--interval',type=int,default=60);a=p.parse_args()
    if not 15<=a.interval<=3600:p.error('interval must be 15..3600')
    stop=threading.Event()
    if a.daemon:
        signal.signal(signal.SIGTERM,lambda *_:stop.set());signal.signal(signal.SIGINT,lambda *_:stop.set())
    while not stop.is_set():
        started=time.monotonic();path=pathlib.Path(a.config).resolve();c=json.loads(path.read_text());c['data_root']=str((path.parent/c['data_root']).resolve());secrets=secret_files.load(c,path.parent)
        result=run_once(c,secrets);print(json.dumps({'accounts':result}),flush=True)
        if not a.daemon:return int(any(r['state']!='ok' for r in result))
        stop.wait(max(1,a.interval-(time.monotonic()-started)))
    return 0
if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception:print(json.dumps({'error':'product_sync_failed'}));raise SystemExit(1)
