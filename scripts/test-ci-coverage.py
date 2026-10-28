import copy,hashlib,importlib.util,json,pathlib,unittest
spec=importlib.util.spec_from_file_location('gate',pathlib.Path(__file__).with_name('check-product-ci.py'));gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class Coverage(unittest.TestCase):
 def fixture(self):
  sha='a'*40;xml=b'<testsuites><testsuite><testcase name="contract"/></testsuite></testsuites>'
  value={'families':[{'id':'family','unit':[{'name':'contract'}],'python':[{'file':'test.py','name':'test_state'}],'browser':['journey']}],'boundaries':[]}
  meta={'sourceCommit':sha,'product':'eona-mail','sha256':hashlib.sha256(xml).hexdigest()};py={'sourceCommit':sha,'product':'eona-mail','tests':[{'file':'test.py','name':'test_state','status':'passed'}]}
  reports=[{'config':{'metadata':{'sourceCommit':sha}},'stats':{'unexpected':0,'skipped':0},'suites':[{'specs':[{'title':'journey','tests':[{'projectName':e,'status':'expected','results':[{'status':'passed'}]}]}]}]}for e in ['chromium','webkit']]
  return [value,xml,meta,py,reports,sha]
 def test_complete_current_evidence(self):self.assertEqual(gate.verify(*self.fixture())['status'],'passed')
 def test_missing_unit_cannot_hide_behind_file(self):
  a=self.fixture();a[0]['families'][0]['unit'][0]['name']='removed';self.assertRaisesRegex(AssertionError,'unit_not_executed',gate.verify,*a)
 def test_missing_protocol_case(self):
  a=self.fixture();a[3]['tests'][0]['name']='different';self.assertRaisesRegex(AssertionError,'python_not_executed',gate.verify,*a)
 def test_engine_and_case_missing(self):
  a=self.fixture();a[4].pop();self.assertRaisesRegex(AssertionError,'missing_browser_engine',gate.verify,*a)
  a=self.fixture();a[0]['families'][0]['browser']=['omitted'];self.assertRaisesRegex(AssertionError,'browser_not_executed',gate.verify,*a)
 def test_stale_or_changed_source(self):
  a=self.fixture();a[2]['sourceCommit']='b'*40;self.assertRaisesRegex(AssertionError,'source_mismatch',gate.verify,*a)
  a=self.fixture();a[4][0]['config']['metadata']['sourceCommit']='b'*40;self.assertRaisesRegex(AssertionError,'source_mismatch',gate.verify,*a)
  a=self.fixture();a[1]+=b' ';self.assertRaisesRegex(AssertionError,'evidence_changed',gate.verify,*a)
 def test_skip_retry_and_expected_failure_do_not_pass(self):
  for field,value in [('status','skipped'),('status','unexpected'),('annotations',[{'type':'fail'}]),('results',[{'status':'passed'},{'status':'passed'}]),('results',[{'status':'failed'}])]:
   a=self.fixture();a[4][0]['suites'][0]['specs'][0]['tests'][0][field]=value;self.assertRaisesRegex(AssertionError,'browser_retry_skip_or_failure',gate.verify,*a)
 def test_empty_and_duplicate_report(self):
  a=self.fixture();a[4].append(copy.deepcopy(a[4][0]));self.assertRaisesRegex(AssertionError,'duplicate_browser_case',gate.verify,*a)
  a=self.fixture();a[1]=b'<testsuites/>';a[2]['sha256']=hashlib.sha256(a[1]).hexdigest();self.assertRaisesRegex(AssertionError,'empty_unit_report',gate.verify,*a)
if __name__=='__main__':unittest.main()
