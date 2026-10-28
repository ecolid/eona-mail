"""Regression for batch selection, reproducible packages and public data boundaries."""
import copy,hashlib,importlib.util,json,pathlib,tarfile,tempfile,unittest
spec=importlib.util.spec_from_file_location('batch',pathlib.Path(__file__).with_name('batch-release.py'));release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
class Batches(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name);(self.root/'release/batches').mkdir(parents=True);(self.root/'release/changes').mkdir();self.version='0.1.0'
  self.write('package.json',{'version':self.version,'license':'MIT'});self.write('release/policy.json',{'repository':release.REPOSITORY,'development':'single-product-main','releases':'selected-batch','automaticDevelopmentReleases':False});self.batch={'schema':1,'version':self.version,'prerelease':True,'changes':['one']};self.write('release/batches/0.1.0.json',self.batch);self.write('release/changes/one.json',{'id':'one','summary':'Summary','details':['Verified feature']})
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
if __name__=='__main__':unittest.main()
