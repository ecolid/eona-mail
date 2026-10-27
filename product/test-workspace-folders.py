import importlib.util,pathlib,tempfile,unittest,sqlite3
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('workspace',pathlib.Path(__file__).with_name('workspace-worker.py'));worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Connection:
 capabilities=(b'UIDPLUS',)
 def __init__(self):self.selected=[]
 def select(self,name,readonly):self.selected.append((name,readonly));return 'OK',[b'0']
 def response(self,key):return key,[b'42']
class FolderCompatibility(unittest.TestCase):
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
