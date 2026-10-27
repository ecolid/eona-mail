import copy,importlib.util,json,pathlib,sqlite3,tempfile,unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).resolve().parent
def load(name,file):
 s=importlib.util.spec_from_file_location(name,HERE/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
gmail=load('gmail_sync_test','gmail-sync.py');old=load('state_fixtures','test-state-sync.py');worker=load('workspace_test','workspace-worker.py')
FOLDERS=[{'name':'INBOX','kind':'inbox'},{'name':'All','kind':'archive'},{'name':'Drafts','kind':'drafts'},{'name':'Sent','kind':'sent'},{'name':'Trash','kind':'trash'}]
class Remote:
 def __init__(self):
  self.item={'folder':'INBOX','validity':'9','uid':'1','message_id':'100','labels':['\\Inbox'],'seen':False,'flagged':False};self.moves=0;self.lost=False;self.after=None
 def inventory_all(self):
  item=copy.deepcopy(self.item)
  return [item,{**copy.deepcopy(item),'folder':'All','uid':'2'}] if item['folder']=='INBOX' else [item]
 def locate(self,mid,preferred=None):return copy.deepcopy(self.item) if mid=='100' else None
 def folder(self,kind):return next(f['name'] for f in FOLDERS if f['kind']==kind)
 def move(self,item,target):
  self.moves+=1;self.item.update(folder=target,uid=str(self.moves+10),labels=['\\Trash'] if target=='Trash' else ['\\Inbox'])
  if self.lost:self.lost=False;raise TimeoutError('lost MOVE receipt')
  return copy.deepcopy(self.item)
 def flags(self,item,desired):
  self.item.update(seen=bool(desired['is_read']),flagged=bool(desired['is_starred']))
  if self.after:f,self.after=self.after,None;f()
  return copy.deepcopy(self.item)
class State(unittest.TestCase):
 def setUp(self):
  self.fixture=old.Cases();self.fixture.setUp();self.db=self.fixture.db
  self.db.executescript("""CREATE TABLE product_gmail_copies(account TEXT,folder TEXT,validity TEXT,uid TEXT,message_id TEXT,labels_json TEXT);
  INSERT INTO product_gmail_copies VALUES('one','INBOX','9','1','100','[]');
  INSERT INTO product_source_copies VALUES('one','All','9','2',1,'original','sha','now','archive',0,0);
  INSERT INTO product_gmail_copies VALUES('one','All','9','2','100','[]');""")
  self.remote=Remote();self.sync=gmail.GmailStateSync(self.db,None,lambda *_:b'original');self.sync.observe('one',self.remote,FOLDERS)
 def tearDown(self):self.fixture.tearDown()
 def edit(self,folder='inbox',read=1,star=1):self.fixture.edit(folder,read,star)
 def run_sync(self):
  self.sync.observe('one',self.remote,FOLDERS);errors=self.sync.push('one',self.remote,FOLDERS);return errors,self.sync.complete('one')
 def test_single_identity_flags_move_restore_across_multiple_label_proofs(self):
  self.edit();self.assertEqual(self.run_sync(),([],[]));self.assertTrue(self.remote.item['flagged'])
  self.edit('trash');self.assertEqual(self.run_sync(),([],[]));self.assertEqual(self.remote.moves,1)
  self.edit('inbox',0,0);self.assertEqual(self.run_sync(),([],[]));self.assertEqual(self.remote.moves,2);self.assertEqual(self.remote.item['folder'],'INBOX');self.assertFalse(self.remote.item['seen'])
 def test_lost_move_receipt_reconciles_without_repeating_move(self):
  self.edit('trash');self.remote.lost=True;self.assertTrue(self.run_sync()[0]);self.assertEqual(self.remote.moves,1)
  self.assertEqual(self.run_sync(),([],[]));self.assertEqual(self.remote.moves,1)
 def test_source_flags_and_trash_restore_update_archive_without_echo(self):
  self.remote.item.update(seen=True,flagged=True);self.run_sync();self.assertEqual(tuple(self.db.execute('SELECT is_read,is_starred,folder FROM emails').fetchone()),(1,1,'inbox'))
  self.remote.move(self.remote.item,'Trash');self.run_sync();self.assertEqual(self.db.execute('SELECT folder FROM emails').fetchone()[0],'trash')
  self.remote.move(self.remote.item,'INBOX');self.run_sync();self.assertEqual(self.db.execute('SELECT folder FROM emails').fetchone()[0],'inbox');self.assertEqual(self.db.execute('SELECT count(*) FROM product_state_intents').fetchone()[0],0)
 def test_provider_reversal_immediately_after_local_ack_is_not_lost(self):
  self.edit();self.assertEqual(self.run_sync(),([],[]))
  self.remote.item.update(seen=False,flagged=False);self.sync.observe('one',self.remote,FOLDERS)
  self.assertEqual(tuple(self.db.execute('SELECT is_read,is_starred FROM emails').fetchone()),(0,0))
 def test_enable_sync_retires_obsolete_readonly_draft_role_without_resurrection(self):
  with self.db:
   self.db.execute('DELETE FROM product_gmail_state')
   self.db.execute('UPDATE product_state_guard SET remote_apply=1')
   self.db.execute("UPDATE emails SET folder='drafts',is_read=1")
   self.db.execute('UPDATE product_state_guard SET remote_apply=0')
  self.remote.move(self.remote.item,'Trash');self.sync.observe('one',self.remote,FOLDERS)
  self.assertEqual(tuple(self.db.execute('SELECT is_read,folder FROM emails').fetchone()),(1,'trash'))
  self.assertEqual(self.db.execute('SELECT count(*) FROM product_state_intents').fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT raw_key FROM product_source_copies LIMIT 1').fetchone()[0],'original')
 def test_new_local_revision_is_not_consumed_by_old_receipt(self):
  self.edit();self.remote.after=lambda:self.edit(read=0,star=0);self.sync.push('one',self.remote,FOLDERS)
  self.assertEqual(self.sync.complete('one'),[1]);self.assertEqual(self.run_sync(),([],[]));self.assertFalse(self.remote.item['seen'])
 def test_unproven_original_does_not_fail_unrelated_accounts_and_remains_durable(self):
  with self.db:self.db.execute("INSERT INTO emails VALUES(2,0,0,'inbox')");self.db.execute('UPDATE emails SET is_read=1 WHERE id=2')
  self.assertEqual(self.sync.complete('one'),[]);self.assertEqual(self.db.execute('SELECT state FROM product_state_intents WHERE email_id=2').fetchone()[0],'pending')
 def test_other_account_inbox_is_retained_when_gmail_sent_is_trashed(self):
  with self.db:
   self.db.execute("INSERT INTO product_source_copies VALUES('other','INBOX','1','1',1,'original','sha','now','inbox',1,0)")
   self.db.execute("INSERT INTO product_copy_state VALUES('other','INBOX','1','1',1,0,'')")
  self.remote.move(self.remote.item,'Trash');self.run_sync();self.assertEqual(self.db.execute('SELECT folder FROM emails').fetchone()[0],'inbox')
class Protocol(unittest.TestCase):
 def test_post_auth_capabilities_and_no_blanket_or_targeted_expunge(self):
  class Connection:
   capabilities=(b'X-GM-EXT-1',)
   def capability(self):return 'OK',[b'X-GM-EXT-1 MOVE UIDPLUS']
  with tempfile.TemporaryDirectory() as root:
   remote=gmail.GmailRemote(worker.Remote(Connection(),pathlib.Path(root),FOLDERS));self.assertIn('MOVE',remote.cap)
   with self.assertRaisesRegex(RuntimeError,'expunge_forbidden'):remote.delete_uid({})
 def test_gmail_sent_is_never_appended_even_after_smtp_saved_copy_is_delayed(self):
  class Remote: smtp_saves_sent=True
  engine=object.__new__(worker.core.Sync)
  engine.all=lambda *_:self.fail('Gmail must not enter generic Sent append')
  engine.push_sent(None,Remote())
 def test_workspace_retirement_uses_provider_recoverable_move_without_backup_append(self):
  class Remote:
   def retire_recoverable(self,copy):self.copy=copy
  engine=object.__new__(worker.core.Sync);engine.owner='owner';engine.db=sqlite3.connect(':memory:');engine.db.execute('CREATE TABLE mail_sync_copies(owner,account,kind,folder,validity,uid,removed)')
  engine.append=lambda *_:self.fail('Gmail draft retirement must not append a duplicate backup')
  remote=Remote();engine.retire(type('Account',(),{'key':'one'})(),remote,{'removed':0,'kind':'draft','folder':'Drafts','validity':'1','uid':2});self.assertEqual(remote.copy['uid'],2);engine.db.close()
if __name__=='__main__':unittest.main()
