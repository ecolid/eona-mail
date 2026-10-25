import importlib.util,json,pathlib,tempfile,unittest,hashlib,tarfile,io
spec=importlib.util.spec_from_file_location('follow',pathlib.Path(__file__).with_name('follow.py'));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
class FollowTests(unittest.TestCase):
 def fixture(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);p=pathlib.Path(t.name);(p/'code').write_text('checked')
  m={'schema':1,'product':'eona-mail','version':'0.2.0','sourceCommit':'a'*40,'workingTree':False,'files':{'code':hashlib.sha256(b'checked').hexdigest()}};(p/'PRODUCT-RELEASE.json').write_text(json.dumps(m));return p
 def cycle(self,p,state=None,config=None,install=None):
  return f.cycle(config or {},state or {},lambda pin:('b'*40,p),install or(lambda *args:{'healthy':True}),lambda:None)
 def test_success_then_no_reinstallation(self):
  p=self.fixture();s=self.cycle(p);self.assertEqual(s['installed'],'b'*40)
  self.assertEqual(self.cycle(p,s,install=lambda *a:self.fail('reinstalled'))['status'],'current')
 def test_failed_release_is_not_retried(self):
  p=self.fixture()
  def fail(*a):raise ValueError('start_failure')
  s=self.cycle(p,install=fail);self.assertEqual(s['status'],'failed');self.assertEqual(self.cycle(p,s,install=lambda *a:self.fail('retried'))['status'],'blocked_failed_release')
 def test_pause_recovers_but_does_not_fetch(self):
  calls=[];v=f.cycle({'paused':True},{},lambda p:self.fail('fetched'),lambda *a:None,lambda:calls.append('recover'));self.assertEqual(calls,['recover']);self.assertEqual(v['status'],'paused')
 def test_hash_file_set_and_symlink_rejected(self):
  p=self.fixture();(p/'code').write_text('changed')
  with self.assertRaisesRegex(ValueError,'hash_changed'):f.verify(p)
  (p/'code').write_text('checked');(p/'extra').write_text('x')
  with self.assertRaisesRegex(ValueError,'file_set'):f.verify(p)
  (p/'extra').unlink();(p/'extra').symlink_to(p/'code')
  with self.assertRaisesRegex(ValueError,'symlink'):f.verify(p)
 def test_archive_escape_rejected_before_write(self):
  p=self.fixture();archive=p/'bad.tar'
  with tarfile.open(archive,'w')as tar:
   m=tarfile.TarInfo('../escape');m.size=1;tar.addfile(m,io.BytesIO(b'x'))
  with self.assertRaisesRegex(ValueError,'unsafe_archive'):f.extract(archive,p/'out')
if __name__=='__main__':unittest.main()
