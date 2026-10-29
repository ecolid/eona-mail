import importlib.util
import json
import pathlib
import sqlite3
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('state_sync', HERE / 'state-worker.py')
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)
FOLDERS = [{'name': 'INBOX', 'kind': 'inbox'}, {'name': 'Trash', 'kind': 'trash'}]

class Remote:
    def __init__(self):
        self.data = {'INBOX': {'1': {'seen': False, 'flagged': False}}, 'Trash': {}}
        self.copies = 0
        self.fail_copy = False
        self.fail_retire = False
        self.ambiguous = False
        self.after_flags = None
    def inventory(self, folder):
        return '9', {int(k): v.copy() for k,v in self.data[folder].items()}
    def flags(self, copy, desired):
        if copy['uid'] not in self.data[copy['folder']]: raise state.Unknown('state_source_missing')
        self.data[copy['folder']][copy['uid']] = {'seen': bool(desired['is_read']), 'flagged': bool(desired['is_starred'])}
        if self.after_flags:
            fn, self.after_flags = self.after_flags, None
            fn()
    def copy(self, copy, target):
        self.copies += 1
        self.data[target]['2'] = self.data[copy['folder']][copy['uid']].copy()
        if self.fail_copy: raise TimeoutError('reply lost after accepted COPY')
        return {'validity': '9', 'uid': '2'}
    def find(self, target, raw, receipt=None):
        matches = [{'validity': '9', 'uid': uid} for uid in self.data[target]]
        if receipt: matches = [x for x in matches if x == receipt]
        if self.ambiguous and not receipt: matches *= 2
        return matches
    def retire(self, copy):
        if self.fail_retire: raise TimeoutError('network unavailable')
        self.data[copy['folder']].pop(copy['uid'], None)

class Cases(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.executescript("""CREATE TABLE emails(id INTEGER PRIMARY KEY,is_read INTEGER,is_starred INTEGER,folder TEXT);
        INSERT INTO emails VALUES(1,0,0,'inbox');
        CREATE TABLE product_source_copies(account TEXT,folder TEXT,validity TEXT,uid TEXT,email_id INTEGER,raw_key TEXT,raw_sha TEXT,source_at TEXT,kind TEXT,seen INTEGER,base_rev INTEGER DEFAULT 0,PRIMARY KEY(account,folder,validity,uid));
        INSERT INTO product_source_copies(account,folder,validity,uid,email_id,raw_key,raw_sha,source_at,kind,seen) VALUES('one','INBOX','9','1',1,'original','sha','now','inbox',0);""")
        self.db.executescript((HERE / 'state-schema.sql').read_text())
        self.sync = state.StateSync(self.db, None, lambda *_: b'original')
        self.remote = Remote()
        self.sync.observe('one', self.remote, FOLDERS)
    def tearDown(self): self.db.close()
    def test_adding_a_seen_historical_source_keeps_the_existing_canonical_state(self):
        # A second mailbox can contain an old, independently marked backup of
        # the same message. Its first observation establishes a baseline.
        with self.db:
            self.db.execute("INSERT INTO product_source_copies(account,folder,validity,uid,email_id,raw_key,raw_sha,source_at,kind,seen) VALUES('backup','INBOX','9','1',1,'original','sha','now','inbox',1)")
        backup=Remote();backup.data['INBOX']['1']={'seen':True,'flagged':True}
        self.sync.observe('backup',backup,FOLDERS)
        current=self.db.execute('SELECT is_read,is_starred,folder FROM emails WHERE id=1').fetchone()
        self.assertEqual(tuple(current),(0,0,'inbox'))
        self.assertEqual(self.db.execute("SELECT seen FROM product_source_copies WHERE account='backup'").fetchone()[0],1)
        # Once adopted, an actual source edit still participates in sync.
        backup.data['INBOX']['1']['flagged']=False
        self.sync.observe('backup',backup,FOLDERS)
        backup.data['INBOX']['1']['flagged']=True
        self.sync.observe('backup',backup,FOLDERS)
        self.assertEqual(self.db.execute('SELECT is_starred FROM emails WHERE id=1').fetchone()[0],1)
    def test_first_observation_of_a_new_original_keeps_native_flags(self):
        with self.db:
            self.db.execute("INSERT INTO emails VALUES(2,0,0,'inbox')")
            self.db.execute("INSERT INTO product_source_copies(account,folder,validity,uid,email_id,raw_key,raw_sha,source_at,kind,seen) VALUES('new','INBOX','9','1',2,'new-original','new-sha','now','inbox',1)")
        remote=Remote();remote.data['INBOX']['1']={'seen':True,'flagged':True}
        self.sync.observe('new',remote,FOLDERS)
        self.assertEqual(tuple(self.db.execute('SELECT is_read,is_starred FROM emails WHERE id=2').fetchone()),(1,1))
    def test_unchanged_inventory_does_not_rewrite_archive_or_source_state(self):
        before=self.db.total_changes
        self.sync.observe('one',self.remote,FOLDERS)
        self.assertEqual(self.db.total_changes,before)
        self.remote.data['INBOX']['1']['seen']=True
        self.sync.observe('one',self.remote,FOLDERS)
        self.assertEqual(self.db.execute('SELECT is_read FROM emails WHERE id=1').fetchone()[0],1)
        before=self.db.total_changes
        self.sync.observe('one',self.remote,FOLDERS)
        self.assertEqual(self.db.total_changes,before)
    def edit(self, folder='inbox', read=1, star=1):
        with self.db: self.db.execute('UPDATE emails SET folder=?,is_read=?,is_starred=? WHERE id=1', (folder,read,star))
    def run_sync(self):
        self.sync.observe('one', self.remote, FOLDERS)
        errors = self.sync.push('one', self.remote, FOLDERS)
        return errors, self.sync.complete()
    def test_flags_delete_restore_full_lifecycle(self):
        self.edit()
        self.assertEqual(self.run_sync(), ([], []))
        self.assertEqual(self.remote.data['INBOX']['1'], {'seen': True, 'flagged': True})
        self.edit('trash')
        self.assertEqual(self.run_sync(), ([], []))
        self.assertFalse(self.remote.data['INBOX'])
        self.assertEqual(self.remote.copies, 1)
        self.edit('inbox',read=0,star=0)
        self.assertEqual(self.run_sync(), ([], []))
        self.assertFalse(self.remote.data['Trash'])
        self.assertEqual(self.remote.data['INBOX']['2'], {'seen': False, 'flagged': False})
    def test_discovered_folder_flags_stay_in_place_and_restore_returns_to_original(self):
        folders=[*FOLDERS,{'name':'Project','kind':'archive'}]
        self.remote.data['Project']=self.remote.data.pop('INBOX');self.remote.data['INBOX']={}
        with self.db:self.db.execute("UPDATE product_source_copies SET folder='Project',kind='archive'");self.db.execute('DELETE FROM product_copy_state')
        self.sync.observe('one',self.remote,folders)
        def run():
            self.sync.observe('one',self.remote,folders);errors=self.sync.push('one',self.remote,folders);return errors,self.sync.complete()
        self.edit();self.assertEqual(run(),([],[]));self.assertIn('1',self.remote.data['Project']);self.assertFalse(self.remote.data['INBOX'])
        self.edit('trash');self.assertEqual(run(),([],[]));self.assertFalse(self.remote.data['Project'])
        self.edit('inbox');self.assertEqual(run(),([],[]));self.assertIn('2',self.remote.data['Project']);self.assertFalse(self.remote.data['INBOX'])
    def test_copy_lost_reply_never_replayed(self):
        self.edit('trash');self.remote.fail_copy = True;self.remote.fail_retire = True
        self.assertTrue(self.run_sync()[0]);self.assertEqual(self.remote.copies, 1)
        self.remote.fail_retire = False
        self.assertEqual(self.run_sync(), ([], []));self.assertEqual(self.remote.copies, 1)
    def test_copyuid_disambiguates_identical_existing_target(self):
        self.remote.data['Trash']['88'] = {'seen': False, 'flagged': False}
        self.remote.ambiguous = True
        self.edit('trash')
        self.assertEqual(self.run_sync(), ([], []))
        self.assertIn('88',self.remote.data['Trash'])
    def test_unknown_ambiguous_copy_preserves_source_and_intent(self):
        self.remote.fail_copy = True;self.remote.ambiguous = True;self.edit('trash')
        errors, pending = self.run_sync()
        self.assertIn('copy_confirmation_ambiguous',errors);self.assertEqual(pending,[1])
        self.run_sync();self.assertEqual(self.remote.copies,1);self.assertIn('1',self.remote.data['INBOX'])
    def test_new_edit_during_request_remains_pending(self):
        self.edit();self.remote.after_flags = lambda: self.edit(read=0,star=0)
        self.sync.push('one', self.remote, FOLDERS)
        self.assertEqual(self.sync.complete(),[1])
        self.assertEqual(self.run_sync(),([],[]))
        self.assertEqual(self.remote.data['INBOX']['1'],{'seen':False,'flagged':False})
    def test_crash_after_retire_reconciles_missing_source(self):
        self.edit('trash');self.remote.fail_retire = True
        self.assertTrue(self.run_sync()[0])
        self.remote.data['INBOX'].clear();self.remote.fail_retire = False
        self.assertEqual(self.run_sync(),([],[]));self.assertEqual(self.remote.copies,1)
    def test_source_uidvalidity_change_cannot_confirm(self):
        self.edit();self.remote.data['INBOX'].clear()
        self.assertEqual(self.run_sync()[1],[1]);self.assertEqual(self.remote.copies,0)
    def test_migrated_local_state_survives_initial_cloud_inventory(self):
        with self.db:
            self.db.execute('INSERT INTO product_migrated_emails VALUES(1)')
            self.db.execute('UPDATE product_state_guard SET remote_apply=1')
            self.db.execute("UPDATE emails SET is_read=1,is_starred=1,folder='trash'")
            self.db.execute('UPDATE product_state_guard SET remote_apply=0')
            self.db.execute('DELETE FROM product_copy_state')
        self.assertEqual(self.run_sync(),([],[]))
        self.assertEqual(tuple(self.db.execute('SELECT is_read,is_starred,folder FROM emails').fetchone()),(1,1,'trash'))
        self.assertEqual(self.remote.copies,0)
        self.remote.data['INBOX']['1']['flagged']=True
        self.run_sync()
        self.remote.data['INBOX']['1']['flagged']=False
        self.run_sync()
        self.assertEqual(tuple(self.db.execute('SELECT is_read,is_starred,folder FROM emails').fetchone()),(1,0,'trash'))
    def test_configuration_change_refuses_old_proof(self):
        with self.assertRaisesRegex(RuntimeError,'state_folder_unconfigured'):
            self.sync.observe('one', self.remote,[{'name':'Other','kind':'inbox'}])
    def test_discovered_directory_removed_retains_original_and_other_folders_keep_syncing(self):
        with self.db:
            self.db.execute("UPDATE product_source_copies SET folder='Removed project',kind='archive'")
            self.db.execute("INSERT INTO emails VALUES(2,0,0,'inbox')")
            self.db.execute("INSERT INTO product_source_copies(account,folder,validity,uid,email_id,raw_key,raw_sha,source_at,kind,seen) VALUES('one','INBOX','9','1',2,'other-original','sha','now','inbox',0)")
            self.db.execute('DELETE FROM product_copy_state')
        self.remote.data['INBOX']['1']['seen']=True
        self.sync.observe('one',self.remote,FOLDERS,discovered=True)
        self.assertEqual(self.db.execute('SELECT raw_key FROM product_source_copies WHERE email_id=1').fetchone()[0],'original')
        self.assertEqual(self.db.execute('SELECT folder FROM emails WHERE id=1').fetchone()[0],'inbox')
        self.assertEqual(self.db.execute("SELECT present FROM product_copy_state WHERE folder='Removed project'").fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT is_read FROM emails WHERE id=2').fetchone()[0],1)

if __name__ == '__main__': unittest.main()
