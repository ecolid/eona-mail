import importlib.util,pathlib,unittest,copy
from unittest.mock import patch
ROOT=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('original_tests',ROOT/'test-imap.py');old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old);worker=old.worker
class IMAP(old.IMAP):
 def uid(self,command,*args):
  if command.upper()=='SEARCH' and args[-1]=='ALL':return 'OK',[b' '.join(str(x).encode() for x in self.values)]
  return super().uid(command,*args)
class API(old.API):
 def call(self,path,body=None):
  if path.endswith('/source-coverage'):
   known=set(getattr(self,'known',[]))|{r['source']['uid'] for r in self.receipts};return {'missing':[u for u in body['uids'] if u not in known]}
  return super().call(path,body)
class Tests(unittest.TestCase):
 def test_gmail_metadata_keeps_provider_identity_labels_and_readonly_original_intact(self):
  client=IMAP([1]);original=client.uid
  def uid(command,*args):
   if command.lower()=='fetch':
    self.assertIn('BODY.PEEK[]',args[-1]);self.assertIn('X-GM-MSGID X-GM-LABELS',args[-1]);client.fetched.append(int(args[0]))
    return 'OK',[(b'1 (UID 1 FLAGS (\\Seen) INTERNALDATE "7-Feb-2014 15:30:56 +0800" X-GM-MSGID 18446744073709551615 X-GM-LABELS (\\Sent "Project (2026)" "&V4NXPpCuTvY-") BODY[] {40}',b'From: sender@example.test\r\n\r\nOriginal body')]
   return original(command,*args)
  client.uid=uid;api=API()
  state=worker.collect_folder(client,api,{'id':'google','imap':{'provider':'gmail'}},{'name':'All','kind':'archive'},audit=True)
  self.assertEqual(state['state'],'ok');self.assertEqual(api.receipts[0]['source']['gmail'],{'message_id':'18446744073709551615','labels':['\\Sent','Project (2026)','垃圾邮件']})
  self.assertTrue(api.receipts[0]['source']['historical']);self.assertEqual(client.fetched,[1])
 def test_gmail_missing_or_truncated_labels_cannot_commit_a_copy(self):
  for header in [b'UID 1',b'X-GM-MSGID 1 X-GM-LABELS ("unterminated',b'X-GM-MSGID 1 X-GM-LABELS ("bad\\q")']:
   with self.assertRaises(RuntimeError):worker.gmail.metadata(header,worker.inventory.decode_folder)
 def test_receive_only_account_collects_sent_even_with_other_account_sync_enabled(self):
  client=IMAP([1]);client.login=lambda *args:None;client.logout=lambda:None
  account={'id':'one','sync':{'enabled':False},'imap':{'host':'imap.example.test','port':993,'user':'owner','password_env':'PASSWORD','folders':[{'name':'INBOX','kind':'inbox'},{'name':'Sent','kind':'sent'},{'name':'Drafts','kind':'drafts'}]}}
  api=API();worker.run_once({'mode':'personal','sync':{'enabled':True},'accounts':[account]},{'PASSWORD':'test'},api,connect=lambda *args,**kwargs:client)
  self.assertEqual({r['source']['kind'] for r in api.receipts},{'inbox','sent','drafts'})
 def test_discovery_decodes_names_and_keeps_no_select_out_of_scope(self):
  client=IMAP([]);client.list=lambda:('OK',[b'(\\HasChildren \\Noselect) "/" "Parent"',b'() "/" INBOX',b'(\\Junk) "/" "&V4NXPpCuTvY-"',b'() "/" "Work/&- misc"'])
  settings={'discovery':'all','folders':[{'name':'INBOX','kind':'inbox'}]};rows=worker.inventory.discover(client,settings)
  self.assertEqual(rows,[{'name':'INBOX','kind':'inbox'},{'name':'垃圾邮件','kind':'junk'},{'name':'Work/& misc','kind':'archive'}])
  self.assertEqual(worker.inventory.discover(client,{**settings,'discovery':'configured'}),settings['folders'])
 def test_failed_list_is_failure_not_empty_inventory(self):
  client=IMAP([]);client.list=lambda:('NO',None)
  with self.assertRaisesRegex(RuntimeError,'inventory_unavailable'):worker.inventory.discover(client,{'folders':[],'discovery':'all'})
 def test_uid_set_audit_repairs_old_interior_gap_without_refetching_known_bodies(self):
  api=API();api.known=['1','3'];client=IMAP([1,2,3]);oldstate={'validity':'42','last_uid':3,'backfill_cursor':3,'backfill_until':3,'state':'ok'}
  state=worker.collect_folder(client,api,{'id':'one'},{'name':'INBOX','kind':'inbox'},oldstate,audit=True)
  self.assertEqual(client.fetched,[2]);self.assertTrue(api.receipts[0]['source']['historical']);self.assertEqual(state['state'],'ok')
 def test_complete_uid_set_never_downloads_bodies(self):
  api=API();api.known=['1','2'];client=IMAP([1,2]);oldstate={'validity':'42','last_uid':2,'backfill_cursor':2,'backfill_until':2,'state':'ok'}
  worker.collect_folder(client,api,{'id':'one'},{'name':'INBOX','kind':'inbox'},oldstate,audit=True);self.assertEqual(client.fetched,[])
if __name__=='__main__':unittest.main()
