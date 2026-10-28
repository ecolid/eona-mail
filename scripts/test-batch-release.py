"""Regression for batch selection, reproducible packages and public data boundaries."""
import copy,hashlib,importlib.util,io,json,pathlib,tarfile,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('batch',pathlib.Path(__file__).with_name('batch-release.py'));release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
class Batches(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);(self.root/'release/batches').mkdir(parents=True);(self.root/'release/changes').mkdir();self.version='0.1.0'
  self.write('package.json',{'version':self.version,'license':'MIT'});self.write('release/policy.json',{'repository':release.REPOSITORY,'development':'single-product-main','releases':'selected-batch','automaticDevelopmentReleases':False,'pairedPreviewSite':'https://demo.example.test','requirePreviewSiteMatch':True});self.batch={'schema':1,'version':self.version,'prerelease':True,'changes':['one']};self.write('release/batches/0.1.0.json',self.batch);self.write('release/changes/one.json',{'id':'one','summary':'Summary','details':['Verified feature']})
 def write(self,name,value):
  path=self.root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value))
 def selected(self):return release.selected_batch(self.root,self.version)
 def test_selected_changes_are_explicit_and_not_all_feedback(self):
  self.write('release/changes/unselected.json',{'id':'unselected','summary':'Pending','details':[]});batch,entries=self.selected();self.assertEqual([x['id']for x in entries],['one'])
 def test_duplicate_or_reused_changes_are_rejected(self):
  self.write('release/batches/0.1.0.json',{**self.batch,'changes':['one','one']});self.assertRaisesRegex(ValueError,'duplicate',self.selected)
  self.write('release/batches/0.1.0.json',self.batch);self.write('release/batches/0.0.9.json',{**self.batch,'version':'0.0.9'});self.assertRaisesRegex(ValueError,'reused',self.selected)
 def test_empty_missing_or_path_traversal_changes_are_rejected(self):
  for changes in [[],['../private'],['missing']]:
   self.write('release/batches/0.1.0.json',{**self.batch,'changes':changes})
   with self.subTest(changes=changes):self.assertRaises((ValueError,FileNotFoundError),self.selected)
 def test_different_source_version_and_unapproved_license_are_rejected(self):
  for fields in [{'version':'0.2.0','license':'MIT'},{'version':self.version,'license':'UNLICENSED'}]:
   self.write('package.json',fields);self.assertRaisesRegex(ValueError,'version_or_license',self.selected)
 def test_second_repository_or_per_commit_release_policy_is_rejected(self):
  original=json.loads((self.root/'release/policy.json').read_text())
  for change in [{'repository':'someone/other'},{'automaticDevelopmentReleases':True},{'releases':'every-commit'}]:
   self.write('release/policy.json',{**original,**change});self.assertRaisesRegex(ValueError,'policy',self.selected)
 def bundle(self):
  bundle=self.root/'bundle';bundle.mkdir();raw=b'MIT\n';(bundle/'LICENSE').write_bytes(raw);self.write('bundle/PRODUCT-RELEASE.json',{'files':{'LICENSE':hashlib.sha256(raw).hexdigest()},'sourceCommit':'a'*40});return bundle
 def test_archive_is_reproducible_and_only_contains_verified_files(self):
  bundle=self.bundle();(bundle/'private-runtime.json').write_text('must not be exported');a=self.root/'a.gz';b=self.root/'b.gz';release.archive_bundle(bundle,a,self.version);release.archive_bundle(bundle,b,self.version);self.assertEqual(a.read_bytes(),b.read_bytes())
  with tarfile.open(a)as archive:self.assertEqual(archive.getnames(),['eona-mail-0.1.0/LICENSE','eona-mail-0.1.0/PRODUCT-RELEASE.json'])
 def test_modified_checked_bundle_is_rejected(self):
  bundle=self.bundle();(bundle/'LICENSE').write_text('changed');self.assertRaisesRegex(ValueError,'bundle_file_changed',release.archive_bundle,bundle,self.root/'bad.gz',self.version)
 def test_symlink_and_escaping_archive_paths_are_rejected(self):
  bundle=self.bundle();(bundle/'LICENSE').unlink();(bundle/'LICENSE').symlink_to(self.root/'package.json');self.assertRaisesRegex(ValueError,'unsafe_bundle_path',release.archive_bundle,bundle,self.root/'link.gz',self.version)
  self.write('bundle/PRODUCT-RELEASE.json',{'files':{'../package.json':'a'}});self.assertRaisesRegex(ValueError,'unsafe_bundle_path',release.archive_bundle,bundle,self.root/'escape.gz',self.version)
 def test_publish_without_explicit_confirmation_does_not_touch_git_or_network(self):self.assertRaisesRegex(ValueError,'explicit_repository',release.publish,self.root,self.root/'absent',None)
 def preview(self):
  plan={'version':self.version,'sourceCommit':'a'*40,'files':{'eona-mail-0.1.0.tar.gz':'b'*64}}
  receipt={'schema':1,'mode':'demo','version':self.version,'sourceCommit':'a'*40,'archiveSha256':'b'*64}
  return plan,receipt
 def replies(self,*values):
  result=[]
  for value in values:
   response=io.BytesIO(json.dumps(value).encode());response.url='https://demo.example.test/';result.append(response)
  return result
 def test_preview_must_match_version_source_package_and_demo_mode(self):
  plan,receipt=self.preview()
  for change in [{'version':'old'},{'sourceCommit':'c'*40},{'archiveSha256':'d'*64},{'mode':'personal'}]:
   with self.subTest(change=change),patch.object(release.urllib.request,'urlopen',side_effect=self.replies({**receipt,**change},{'ok':True,'mode':'demo'})):
    self.assertRaisesRegex(ValueError,'preview_release_mismatch',release.verify_preview,plan,self.root)
  with patch.object(release.urllib.request,'urlopen',side_effect=self.replies(receipt,{'ok':True,'mode':'demo'})):self.assertEqual(release.verify_preview(plan,self.root),receipt)
 def test_preview_failure_stops_before_github_credentials_or_mutations(self):
  plan,_=self.preview();plan['tag']='v'+self.version
  with patch.object(release,'verify_prepared',return_value=plan),patch.object(release,'git',side_effect=['https://github.com/ecolid/eona-mail',plan['sourceCommit']+' refs/heads/main']),patch.object(release,'verify_preview',side_effect=ValueError('preview_release_mismatch')),patch.object(release.subprocess,'run')as run:
   self.assertRaisesRegex(ValueError,'preview_release_mismatch',release.publish,self.root,self.root/'proof',release.REPOSITORY,self.root)
   run.assert_not_called()
 def test_preview_cannot_redirect_to_another_site(self):
  plan,receipt=self.preview();responses=self.replies(receipt);responses[0].url='https://other.example.test/'
  with patch.object(release.urllib.request,'urlopen',side_effect=responses):self.assertRaisesRegex(ValueError,'preview_redirected',release.verify_preview,plan,self.root)
if __name__=='__main__':unittest.main()
