import contextlib,io,os
from unittest.mock import patch
import copy,datetime,hashlib,importlib.util,json,pathlib,subprocess,tempfile,unittest
spec=importlib.util.spec_from_file_location('local_ci',pathlib.Path(__file__).with_name('local-ci.py'));gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class LocalVerification(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);self.plan={'nodeMajor':24,'pythonMinor':[3,12],'steps':[{'id':'full','run':'tests'}]};self.commit='a'*40;self.tree='b'*40
  coverage={'sourceCommit':self.commit,'status':'passed'};files={'reports/unit.xml':'<testsuites/>','reports/contracts-source.json':'{}','reports/python.json':'{}','reports/results.json':'{}','reports/coverage.json':json.dumps(coverage),'PRODUCT-RELEASE.json':json.dumps({'sourceCommit':self.commit,'sourceTree':self.tree,'workingTree':False})}
  for name,raw in files.items():p=self.root/name;p.parent.mkdir(exist_ok=True);p.write_text(raw)
  self.coverage=coverage;self.report={'schemaVersion':1,'product':'eona-mail','status':'passed','sourceCommit':self.commit,'sourceTree':self.tree,'planSha256':hashlib.sha256(json.dumps(self.plan,sort_keys=True).encode()).hexdigest(),'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'nodeMajor':24,'pythonMinor':[3,12],'checks':[{'id':'full','exitCode':0}],'files':{n:gate.digest(self.root/n)for n in files}}
 def verify(self,value=None,coverage=None):return gate.verify_report(value or self.report,self.plan,self.commit,self.tree,self.root,coverage or(lambda _:self.coverage))
 def test_complete_exact_local_report(self):self.assertEqual(self.verify()['status'],'passed')
 def test_source_tree_plan_and_runtime_changes_are_rejected(self):
  for key,value in [('sourceCommit','c'*40),('sourceTree','c'*40),('planSha256','old'),('nodeMajor',22),('pythonMinor',[3,14])]:
   report={**self.report,key:value}
   with self.subTest(key=key):self.assertRaises(ValueError,self.verify,report)
 def test_failed_missing_reordered_or_skipped_checks_are_rejected(self):
  for changes in [{'status':'failed'},{'checks':[]},{'checks':[{'id':'other','exitCode':0}]},{'checks':[{'id':'full','exitCode':1}]},{'checks':[{'id':'full','exitCode':None}]}]:self.assertRaises(ValueError,self.verify,{**self.report,**changes})
 def test_expired_report_is_rejected(self):
  report={**self.report,'completedAt':(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=2)).isoformat()};self.assertRaisesRegex(ValueError,'expired',self.verify,report)
 def test_changed_or_missing_raw_report_is_rejected(self):
  path=self.root/'reports/unit.xml';path.write_text('changed');self.assertRaisesRegex(ValueError,'evidence_changed',self.verify)
  path.unlink();self.assertRaisesRegex(ValueError,'evidence_changed',self.verify)
 def test_coverage_is_recomputed_and_must_be_identical(self):
  self.assertRaisesRegex(ValueError,'coverage_changed',self.verify,None,lambda _:{**self.coverage,'status':'failed'})
  report=copy.deepcopy(self.report);del report['files']['reports/results.json'];self.assertRaisesRegex(ValueError,'missing_evidence',self.verify,report)
 def test_symlink_and_escape_reports_are_rejected(self):
  path=self.root/'reports/unit.xml';path.unlink();path.symlink_to(self.root/'reports/python.json');self.assertRaisesRegex(ValueError,'evidence_changed',self.verify)
 def test_failure_artifacts_survive_source_cleanup(self):
  source=self.root/'source';(source/'test-results').mkdir(parents=True);(source/'test-results/failure.png').write_bytes(b'failure frame')
  gate.preserve_artifacts(source,self.root/'evidence')
  import shutil;shutil.rmtree(source)
  self.assertEqual((self.root/'evidence/diagnostics/test-results/failure.png').read_bytes(),b'failure frame')
 def test_public_publisher_requires_verification_before_git_or_network(self):
  p=subprocess.run(['node',str(pathlib.Path(__file__).with_name('publish-development.mjs')),'/nonexistent'],capture_output=True,text=True)
  self.assertNotEqual(p.returncode,0);self.assertIn('complete_local_verification_required',p.stderr)
class ReleasePolicy(unittest.TestCase):
 def test_daily_publication_updates_channel_without_creating_a_release(self):
  source='a'*40;output=io.StringIO()
  def git(*args,**kwargs):
   if args[:2]==('remote','get-url'):return 'https://github.com/ecolid/eona-mail.git'
   if args and args[0]=='ls-remote':return source+' refs/heads/main'
   return source
  with patch.object(gate,'verify',return_value={'sourceCommit':source}),patch.object(gate,'git',side_effect=git),patch.object(gate,'evidence_path',return_value=pathlib.Path('/evidence/verification.json')),patch.object(pathlib.Path,'unlink'),patch.object(gate.subprocess,'run'),patch.object(gate.subprocess,'check_output',return_value='b'*40),patch.object(gate.urllib.request,'urlopen',side_effect=AssertionError('daily publication must not call GitHub Release API')),patch('sys.argv',['local-ci.py','publish']),contextlib.redirect_stdout(output):gate.main()
  result=json.loads(output.getvalue());self.assertIsNone(result['release']);self.assertEqual(result['channelCommit'],'b'*40)
 def test_manual_platform_check_accepts_same_repo_before_and_after_publication(self):
  class Reply:
   def __init__(self,private):self.io=io.BytesIO(json.dumps({'private':private,'full_name':'ecolid/eona-mail'}).encode())
   def __enter__(self):return self.io
   def __exit__(self,*args):return False
  for private in [True,False]:
   with patch.dict(os.environ,{'GH_TOKEN':'synthetic','GITHUB_REPOSITORY':'ecolid/eona-mail','GITHUB_EVENT_NAME':'workflow_dispatch','GITHUB_SHA':'a'*40}),patch.object(gate.urllib.request,'urlopen',return_value=Reply(private)),contextlib.redirect_stdout(io.StringIO()):gate.platform_check()
if __name__=='__main__':unittest.main()
