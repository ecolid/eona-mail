import importlib.util,pathlib,tempfile,unittest
spec=importlib.util.spec_from_file_location('workspace',pathlib.Path(__file__).with_name('workspace-worker.py'));worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class Connection:
 capabilities=(b'UIDPLUS',)
 def __init__(self):self.selected=[]
 def select(self,name,readonly):self.selected.append((name,readonly));return 'OK',[b'0']
 def response(self,key):return key,[b'42']
class FolderCompatibility(unittest.TestCase):
 def test_legacy_wire_journals_and_unicode_product_names_address_the_same_folder(self):
  with tempfile.TemporaryDirectory() as root:
   c=Connection();remote=worker.Remote(c,pathlib.Path(root),[{'name':'INBOX','kind':'inbox'},{'name':'已发送','kind':'sent'},{'name':'草稿箱','kind':'drafts'},{'name':'已删除','kind':'trash'}])
   legacy='&XfJT0ZAB-'
   self.assertEqual(remote.folders('sent'),[legacy]);self.assertEqual(remote.select(legacy),'42');self.assertEqual(remote.select('已发送'),'42')
   self.assertEqual(c.selected,[(chr(34)+legacy+chr(34),True)]*2)
   with self.assertRaisesRegex(RuntimeError,'source_folder_unconfigured'):remote.select('unknown')
if __name__=='__main__':unittest.main()
