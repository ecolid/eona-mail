"""Validate the product-owned regression inventory against actual CI evidence."""
import argparse,hashlib,importlib.util,json,pathlib,subprocess,sys,unittest,xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[1]
PYTHON=['product/test-imap.py','product/test-source-inventory.py','product/test-state-sync.py','product/test-workspace-folders.py','product/test-gmail-sync.py','scripts/test-follow.py']
def load(path):return json.loads(path.read_text())
def source():return subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
def inventory():
 value=load(ROOT/'test/ci-contracts.json');assert value['schema']==1 and value['product']=='eona-mail'
 ids=set()
 for f in value['families']:
  assert f['id'] not in ids and f['trigger'] in ['reusable','repeated-3-plus'] and f['contract'] and f['evidence'],f['id'];ids.add(f['id'])
  assert f['browser'] or f['unit'] or f['python'],'uncovered_family:'+f['id']
  for case in f['unit']+f['python']:
   path=ROOT/case['file'];assert path.is_file() and case['name'] in path.read_text(),'missing_case:'+str(case)
 assert ids and all(x.get('method') for x in value['boundaries'])
 return value
class Recorded(unittest.TextTestResult):
 def startTest(self,test):super().startTest(test);self.rows.append({'id':test.id(),'status':'running'})
 def addSuccess(self,test):super().addSuccess(test);self.rows[-1]['status']='passed'
def python_tests(output):
 rows=[]
 for i,name in enumerate(PYTHON):
  spec=importlib.util.spec_from_file_location('mail_ci_'+str(i),ROOT/name);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  class Result(Recorded):pass
  Result.rows=[]
  result=unittest.TextTestRunner(resultclass=Result,verbosity=1).run(unittest.defaultTestLoader.loadTestsFromModule(module))
  assert result.testsRun>0 and result.wasSuccessful() and not result.skipped,name
  rows += [{'file':name,'name':r['id'].split('.')[-1],'status':r['status']} for r in result.rows]
 output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps({'product':'eona-mail','sourceCommit':source(),'tests':rows},indent=2)+'\n')
def verify(value,unit_xml,unit_meta,py,browsers,sha):
 assert unit_meta['sourceCommit']==py['sourceCommit']==sha and unit_meta['product']==py['product']=='eona-mail','contract_source_mismatch'
 assert hashlib.sha256(unit_xml).hexdigest()==unit_meta['sha256'],'unit_evidence_changed'
 cases=ET.fromstring(unit_xml).findall('.//testcase');assert cases,'empty_unit_report'
 assert all(not list(c) and c.get('status') not in ['skipped','failed'] for c in cases),'unit_failure_or_skip'
 units={c.attrib['name'] for c in cases};assert len(units)==len(cases),'duplicate_unit_name'
 assert py['tests'] and all(t['status']=='passed' for t in py['tests']),'python_failure_or_skip'
 pys={(t['file'],t['name']) for t in py['tests']}
 seen={}
 for report in browsers:
  assert report['config']['metadata']['sourceCommit']==sha,'browser_source_mismatch'
  assert report['stats']['unexpected']==0 and report['stats']['skipped']==0 and not report.get('errors'),'browser_failure_or_skip'
  def visit(suite):
   for spec in suite.get('specs',[]):
    for test in spec['tests']:
     assert not test.get('annotations') and test['status']=='expected' and len(test['results'])==1 and test['results'][0]['status']=='passed','browser_retry_skip_or_failure'
     key=(test['projectName'],spec['title']);assert key not in seen,'duplicate_browser_case';seen[key]=True
   for child in suite.get('suites',[]):visit(child)
  for suite in report['suites']:visit(suite)
 assert {engine for engine,_ in seen}=={'chromium','webkit'},'missing_browser_engine'
 result=[]
 for family in value['families']:
  for case in family['unit']:
   assert case['name'] in units,'unit_not_executed:'+case['name']
   if case.get('file'):assert any(c.get('name')==case['name'] and c.get('file','').endswith('/'+case['file']) for c in cases),'unit_wrong_file:'+case['name']
  for case in family['python']:assert (case['file'],case['name']) in pys,'python_not_executed:'+case['name']
  for case in family['browser']:
   for engine in ['chromium','webkit']:assert (engine,case) in seen,'browser_not_executed:'+engine+':'+case
  result.append({'id':family['id'],'status':'passed','unit':len(family['unit']),'python':len(family['python']),'browserPerEngine':len(family['browser'])})
 return {'product':'eona-mail','sourceCommit':sha,'status':'passed','families':result,'executed':{'unit':len(cases),'python':len(py['tests']),'browser':len(seen)},'boundaries':value['boundaries']}
def main():
 p=argparse.ArgumentParser();p.add_argument('--python',type=pathlib.Path);p.add_argument('--reports',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path,default=pathlib.Path('test-results/coverage.json'));a=p.parse_args();v=inventory()
 if a.python:return python_tests(a.python)
 if not a.reports:
  listed=json.loads(subprocess.check_output(['node','node_modules/@playwright/test/cli.js','test','--list','--reporter=json'],cwd=ROOT,text=True))
  titles=set()
  def visit(suite):
   titles.update(s['title'] for s in suite.get('specs',[]))
   for child in suite.get('suites',[]):visit(child)
  for suite in listed['suites']:visit(suite)
  for f in v['families']:
   for title in f['browser']:assert title in titles,'unregistered_browser_case:'+title
  print(json.dumps({'status':'inventory-valid','families':len(v['families']),'browserCases':len(titles)}));return
 def one(name):
  paths=list(a.reports.rglob(name));assert len(paths)==1,'expected_one:'+name;return paths[0]
 report=verify(v,one('unit.xml').read_bytes(),load(one('contracts-source.json')),load(one('python.json')),[load(p) for p in a.reports.rglob('results.json')],source())
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False))
if __name__=='__main__':main()
