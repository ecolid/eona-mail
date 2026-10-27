import importlib.util,pathlib,tempfile,unittest,sqlite3
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('workspace',pathlib.Path(__file__).with_name('workspace-worker.py'));worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Connection:
 capabilities=(b'UIDPLUS',)
 def __init__(self):self.selected=[]
 def select(self,name,readonly):self.selected.append((name,readonly));return 'OK',[b'0']
 def response(self,key):return key,[b'42']
class FolderCompatibility(unittest.TestCase):
 def test_gmail_scope_guard_factory_owns_every_workspace_and_state_effect(self):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);db=sqlite3.connect(root/'mail.db');db.execute('CREATE TABLE product_meta(id INTEGER PRIMARY KEY,owner TEXT,mode TEXT)');db.execute("INSERT INTO product_meta VALUES(1,'owner','personal')");db.commit();db.close()
   settings={'host':'imap.gmail.com','port':993,'user':'owner@example.test','provider':'gmail','password_env':'TEST_PASSWORD','folders':[{'name':'INBOX','kind':'inbox'}]}
   c={'mode':'personal','sync':{'enabled':True},'owner':{'id':'owner'},'data_root':str(root),'accounts':[{'id':'google','address':'owner@example.test','imap':settings}]}
   connection=Connection();connection.login=lambda *_:None;connection.logout=lambda:None;guard=object();seen=[]
   def factory(remote):seen.append(remote);return guard
   with patch.object(worker.core,'Sync') as engine,patch.object(worker.gmail,'GmailStateSync') as states:
    engine.return_value.account.return_value={'account':'google','state':'ok'};states.return_value.push.return_value=[];states.return_value.complete.return_value=[]
    self.assertEqual(worker.run_once(c,{'TEST_PASSWORD':'test'},connect=lambda *a,**kw:connection,gmail_remote_factory=factory),[{'account':'google','state':'ok'}])
    self.assertEqual(len(seen),1);self.assertIs(engine.return_value.account.call_args.args[1],guard);self.assertIs(states.return_value.observe.call_args.args[1],guard);self.assertIs(states.return_value.push.call_args.args[1],guard)
 def test_receive_only_account_cannot_open_the_write_capable_workspace_connection(self):
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);db=sqlite3.connect(root/'mail.db');db.execute('CREATE TABLE product_meta(id INTEGER PRIMARY KEY,owner TEXT,mode TEXT)');db.execute("INSERT INTO product_meta VALUES(1,'owner','personal')");db.commit();db.close()
   c={'mode':'personal','sync':{'enabled':True},'owner':{'id':'owner'},'data_root':str(root),'accounts':[{'id':'google','address':'owner@example.test','sync':{'enabled':False},'imap':{'host':'imap.gmail.com'}}]}
   with patch.object(worker.core,'Sync') as sync:
    self.assertEqual(worker.run_once(c,{},connect=lambda *a,**kw:self.fail('receive-only Gmail opened a write-capable connection')),[])
    self.assertEqual(sync.call_args.args[3],[]);sync.return_value.account.assert_not_called()
 def test_legacy_wire_journals_and_unicode_product_names_address_the_same_folder(self):
  with tempfile.TemporaryDirectory() as root:
   c=Connection();remote=worker.Remote(c,pathlib.Path(root),[{'name':'INBOX','kind':'inbox'},{'name':'已发送','kind':'sent'},{'name':'草稿箱','kind':'drafts'},{'name':'已删除','kind':'trash'}])
   legacy='&XfJT0ZAB-'
   self.assertEqual(remote.folders('sent'),[legacy]);self.assertEqual(remote.select(legacy),'42');self.assertEqual(remote.select('已发送'),'42')
   self.assertEqual(c.selected,[(chr(34)+legacy+chr(34),True)]*2)
   with self.assertRaisesRegex(RuntimeError,'source_folder_unconfigured'):remote.select('unknown')
if __name__=='__main__':unittest.main()
