import copy,importlib.util,pathlib,unittest,tempfile
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('worker',pathlib.Path(__file__).with_name('imap-worker.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class API:
    def __init__(self):self.states=[];self.receipts=[];self.fail=None
    def call(self,path,body=None):
        if path.endswith('/status'):return {'sources':self.states[-1:]}
        if path.endswith('/source-inventory'):return {'ok':True}
        if path.endswith('/source-coverage'):return {'missing':[uid for uid in body.get('uids',[]) if uid not in getattr(self,'known',[]) and not any(r['source']['uid']==uid and r['source']['folder']==body['folder'] for r in self.receipts)]}
        if path.endswith('/known-copies'):return {'uids':getattr(self,'known',[])}
        if path.endswith('/source-status'):self.states.append(copy.deepcopy(body));return {'ok':True}
        if self.fail==body['source']['uid']:raise ValueError('injected_ingress_failure')
        self.receipts.append(copy.deepcopy(body));return {'id':len(self.receipts)}

class IMAP:
    def __init__(self,values=range(1,6)):self.values=list(values);self.validity=b'42';self.bad_select=False;self.fetched=[];self.selected=[]
    def select(self,name,readonly):
        assert readonly is True;self.selected.append(name)
        return ('NO' if self.bad_select else 'OK'),[]
    def list(self):return 'OK',[b'() "/" INBOX',b'(\\Sent) "/" Sent',b'(\\Drafts) "/" Drafts',b'(\\Trash) "/" Trash']
    def response(self,key):return key,[self.validity]
    def uid(self,command,*args):
        command=command.lower()
        if command=='search' and args[-1]=='ALL':return 'OK',[b' '.join(str(x).encode() for x in self.values)]
        if command=='search':
            start,end=args[-1].split(':');end=max(self.values,default=0) if end=='*' else int(end)
            return 'OK',[b' '.join(str(x).encode() for x in self.values if int(start)<=x<=end)]
        assert command=='fetch' and args[-1]=='(UID FLAGS INTERNALDATE BODY.PEEK[])'
        uid=int(args[0]);self.fetched.append(uid);return 'OK',[(f'1 (UID {uid} FLAGS (\\Seen) INTERNALDATE "7-Feb-2014 15:30:56 +0800" BODY[] {{40}}'.encode(),b'From: sender@example.test\r\n\r\nOriginal body')]

class CollectorTests(unittest.TestCase):
    account={'id':'one'}
    folder={'name':'INBOX','kind':'inbox'}
    def test_new_mail_precedes_bounded_history_and_advances_only_receipted_uids(self):
        api=API();imap=IMAP(range(1,7))
        first=worker.collect_folder(imap,api,self.account,self.folder,limit=2)
        self.assertEqual(first['backfill_cursor'],2);self.assertEqual(first['last_uid'],6)
        self.assertTrue(all(x['source']['historical'] for x in api.receipts))
        self.assertEqual(api.receipts[0]['source']['internal_date'],'2014-02-07T07:30:56+00:00')
        imap.values.append(7);api.receipts=[]
        second=worker.collect_folder(imap,api,self.account,self.folder,first,limit=2)
        self.assertEqual([x['source']['uid'] for x in api.receipts],['7','3','4'])
        self.assertFalse(api.receipts[0]['source']['historical']);self.assertEqual(second['last_uid'],7)
        api.fail='6'
        with self.assertRaises(ValueError):worker.collect_folder(imap,api,self.account,self.folder,second,limit=2)
        self.assertEqual(api.states[-1]['state'],'error');self.assertEqual(api.states[-1]['backfill_cursor'],5)
        api.fail=None;state=worker.collect_folder(imap,api,self.account,self.folder,api.states[-1],limit=2)
        self.assertEqual(state['state'],'ok');self.assertEqual(state['backfill_cursor'],6)
    def test_first_select_failure_is_error_not_empty_success(self):
        api=API();imap=IMAP();imap.bad_select=True
        with self.assertRaises(ValueError):worker.collect_folder(imap,api,self.account,self.folder)
        self.assertEqual(api.states[-1]['state'],'error');self.assertEqual(api.states[-1]['last_uid'],0)
    def test_uidvalidity_reset_preserves_original_keys_and_uses_new_baseline(self):
        api=API();imap=IMAP([1]);old=worker.collect_folder(imap,api,self.account,self.folder)
        imap.validity=b'43';imap.values=[1,2]
        state=worker.collect_folder(imap,api,self.account,self.folder,old)
        self.assertEqual(state['validity'],'43');self.assertEqual(state['last_uid'],2)
        self.assertEqual([x['source']['validity'] for x in api.receipts],['42','43','43'])
    def test_known_exact_proofs_advance_without_redownloading_and_validity_is_scoped(self):
        api=API();api.known=['1','2'];imap=IMAP([1,2,3]);state=worker.collect_folder(imap,api,self.account,self.folder)
        self.assertEqual([r['source']['uid'] for r in api.receipts],['3']);self.assertEqual(state['backfill_cursor'],3);self.assertEqual(imap.fetched,[3])
    def test_workspace_sync_owns_sent_and_draft_collection(self):
        api=API();imap=IMAP([1]);imap.login=lambda *_:None;imap.logout=lambda:None
        c={'mode':'personal','sync':{'enabled':True},'accounts':[{'id':'one','imap':{'host':'imap.example.test','port':993,'user':'one','password_env':'MAIL_PASSWORD','folders':[{'name':'INBOX','kind':'inbox'},{'name':'Sent','kind':'sent'},{'name':'Drafts','kind':'drafts'},{'name':'Trash','kind':'trash'}]}}]}
        worker.run_once(c,{'MAIL_PASSWORD':'value'},api,connect=lambda *a,**kw:imap)
        self.assertEqual(imap.selected,['"INBOX"','"Sent"','"Drafts"','"Trash"']);self.assertEqual(len(api.receipts),2)
    def test_empty_atomic_literal_uses_shared_verified_partial_reader(self):
        api=API();imap=IMAP([1]);original=imap.uid
        def uid(command,*args):
            if command=='fetch' and args[-1]=='(UID FLAGS INTERNALDATE BODY.PEEK[])':return 'OK',[None]
            if command=='fetch' and args[-1]=='(UID FLAGS INTERNALDATE)':return 'OK',[b'1 (UID 1 FLAGS (\\Seen) INTERNALDATE "7-Feb-2014 15:30:56 +0800")']
            return original(command,*args)
        imap.uid=uid
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'raw';path.write_bytes(b'From: original@example.test\r\n\r\nComplete original')
            with patch.object(worker.original_reader,'fetch_raw',return_value=path) as reader:
                state=worker.collect_folder(imap,api,self.account,self.folder)
                self.assertEqual(state['state'],'ok');self.assertEqual(reader.call_count,1)
                self.assertTrue(api.receipts[0]['source']['seen']);self.assertEqual(api.receipts[0]['source']['uid'],'1')
    def test_demo_has_no_source_worker(self):
        with self.assertRaisesRegex(ValueError,'demo_worker_forbidden'):worker.run_once({'mode':'demo'},{},API())
    def test_unavailable_original_is_durable_without_starving_history_or_new_mail(self):
        api=API();imap=IMAP([1,2,3,4]);reader=worker.read_original
        def missing(client,uid):
            if uid==2:raise RuntimeError('source_original_unavailable')
            return reader(client,uid)
        with patch.object(worker,'read_original',side_effect=missing),patch.object(worker.time,'time',return_value=1000):
            first=worker.collect_folder(imap,api,self.account,self.folder)
        self.assertEqual(first['state'],'error');self.assertEqual(first['backfill_cursor'],4)
        self.assertEqual([r['source']['uid'] for r in api.receipts],['1','3','4'])
        self.assertEqual(first['gaps'],[{'uid':'2','validity':'42','historical':True,'retry_after':1300}])
        persisted=next(s for s in api.states if s['backfill_cursor']==2)
        self.assertEqual(persisted['gaps'][0]['uid'],'2')
        # Recreate the worker from only the API's durable JSON status.
        old=dict(first);old['gaps_json']=__import__('json').dumps(old.pop('gaps'))
        imap.values.append(5);api.receipts=[]
        with patch.object(worker.time,'time',return_value=1400):
            recovered=worker.collect_folder(imap,api,self.account,self.folder,old)
        self.assertEqual([r['source']['uid'] for r in api.receipts],['5','2'])
        self.assertFalse(api.receipts[0]['source']['historical']);self.assertTrue(api.receipts[1]['source']['historical'])
        self.assertEqual(recovered['state'],'ok');self.assertEqual(recovered['gaps'],[])
    def test_unpersisted_gap_stops_scan_and_uidvalidity_change_retains_old_failure(self):
        api=API();imap=IMAP([1,2,3]);reader=worker.read_original;call=api.call
        def refuse(path,body=None):
            if path.endswith('/source-status') and body.get('gaps'):raise ValueError('gap_write_failed')
            return call(path,body)
        api.call=refuse
        def missing(client,uid):
            if uid==2:raise RuntimeError('source_original_unavailable')
            return reader(client,uid)
        with patch.object(worker,'read_original',side_effect=missing):
            with self.assertRaisesRegex(ValueError,'gap_write_failed'):worker.collect_folder(imap,api,self.account,self.folder)
        self.assertEqual([r['source']['uid'] for r in api.receipts],['1'])
        api=API();imap=IMAP([1]);imap.validity=b'43'
        old={'validity':'42','last_uid':3,'backfill_cursor':3,'backfill_until':3,'gaps':[{'uid':'2','validity':'42','historical':True,'retry_after':0}]}
        state=worker.collect_folder(imap,api,self.account,self.folder,old)
        self.assertEqual(state['state'],'error');self.assertEqual(state['gaps'],old['gaps'])
        self.assertEqual([r['source']['validity'] for r in api.receipts],['43'])

if __name__=='__main__':unittest.main()
