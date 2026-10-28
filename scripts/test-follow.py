import importlib.util,json,pathlib,tempfile,unittest,hashlib,tarfile,io
spec=importlib.util.spec_from_file_location('follow',pathlib.Path(__file__).with_name('follow.py'));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
class FollowTests(unittest.TestCase):
 def fixture(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);p=pathlib.Path(t.name);(p/'code').write_text('checked')
  m={'schema':1,'product':'eona-mail','version':'0.2.0','sourceCommit':'a'*40,'workingTree':False,'files':{'code':hashlib.sha256(b'checked').hexdigest()}};(p/'PRODUCT-RELEASE.json').write_text(json.dumps(m));return p
 def cycle(self,p,state=None,config=None,install=None):
  return f.cycle(config or {},state or {},lambda pin,installed:('b'*40,p),install or(lambda *args:{'healthy':True}),lambda:None)
 def test_success_then_no_reinstallation(self):
  p=self.fixture();s=self.cycle(p);self.assertEqual(s['installed'],'b'*40)
  self.assertEqual(self.cycle(p,s,install=lambda *a:self.fail('reinstalled'))['status'],'current')
 def test_failed_release_is_not_retried(self):
  p=self.fixture()
  def fail(*a):raise ValueError('start_failure')
  s=self.cycle(p,install=fail);self.assertEqual(s['status'],'failed');self.assertEqual(self.cycle(p,s,install=lambda *a:self.fail('retried'))['status'],'blocked_failed_release')
 def test_pause_recovers_but_does_not_fetch(self):
  calls=[];v=f.cycle({'paused':True},{},lambda p,installed:self.fail('fetched'),lambda *a:None,lambda:calls.append('recover'));self.assertEqual(calls,['recover']);self.assertEqual(v['status'],'paused')
 def test_recovered_installed_receipt_is_used_for_ancestry_validation(self):
  p=self.fixture();seen=[]
  def fetch(pin,installed):seen.append(installed);return ('b'*40,p)
  result=f.cycle({}, {'installed':'c'*40},fetch,lambda *args:{'healthy':True},lambda:{'installed':'b'*40})
  self.assertEqual(seen,['b'*40]);self.assertEqual(result['status'],'current')
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

class CommandLifecycleTests(unittest.TestCase):
 def test_checked_channel_pause_pin_and_failure_backoff(self):
  import subprocess,sys
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);root=pathlib.Path(t.name).resolve();repo=root/'upstream';repo.mkdir()
  def git(*args):return subprocess.check_output(['git','-C',str(repo),*args],stderr=subprocess.DEVNULL,text=True).strip()
  git('init','-b','main');git('config','user.name','Release fixture');git('config','user.email','fixture@example.test')
  def commit(text):
   (repo/'code').write_text(text);m={'schema':1,'product':'eona-mail','version':'0.2.0','sourceCommit':'a'*40,'workingTree':False,'files':{'code':hashlib.sha256(text.encode()).hexdigest()}};(repo/'PRODUCT-RELEASE.json').write_text(json.dumps(m));git('add','-A');git('commit','-m',text);return git('rev-parse','HEAD')
  first=commit('first');git('branch','channels/development');second=commit('unchecked main')
  adapter=root/'adapter.py';adapter.write_text('''import json,pathlib,sys
root=pathlib.Path(__file__).parent;p=root/'actual.json';action=sys.argv[1]
if action=='recover':print(p.read_text()if p.exists()else '{"installed":null}')
else:
 if (root/'fail').exists():raise RuntimeError('injected start failure')
 revision=sys.argv[sys.argv.index('--revision')+1];p.write_text(json.dumps({'installed':revision}));print(json.dumps({'installed':revision}))
''')
  cfg=root/'follow.json';cfg.write_text(json.dumps({'repository':repo.as_uri(),'stateDirectory':str(root/'state'),'sshCommand':'false','adapter':[sys.executable,str(adapter)]}));cfg.chmod(0o600)
  def follow(action='once',*extra,success=True):
   r=subprocess.run([sys.executable,str(pathlib.Path(f.__file__)),'--config',str(cfg),action,*extra],capture_output=True,text=True);self.assertEqual(r.returncode,0 if success else 1,r.stderr);return json.loads(r.stdout)
  self.assertEqual(follow()['installed'],first) # Unchecked main never installs.
  git('branch','-f','channels/development',second);self.assertEqual(follow()['installed'],second)
  follow('pause');self.assertEqual(follow()['status'],'paused');follow('pin','--revision',first);follow('resume');self.assertEqual(follow()['installed'],first)
  follow('unpin');(root/'fail').touch();self.assertEqual(follow(success=False)['status'],'failed');self.assertEqual(follow(success=False)['status'],'blocked_failed_release')
  (root/'fail').unlink();follow('retry');self.assertEqual(follow()['installed'],second)

if __name__=='__main__':unittest.main()
