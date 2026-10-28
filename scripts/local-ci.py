#!/usr/bin/env python3
"""Run the complete product contract locally; publish only its exact checked commit."""
import argparse,datetime,hashlib,importlib.util,json,os,pathlib,platform,shlex,shutil,subprocess,sys,tempfile,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
PLAN='ci/local.json'

def git(*args,root=ROOT):
 return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.PIPE,text=True).strip()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def load_gate(root=ROOT):
 spec=importlib.util.spec_from_file_location('mail_coverage',root/'scripts/check-product-ci.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def verify_report(report,plan,commit,tree,folder,coverage):
 if report.get('schemaVersion')!=1 or report.get('product')!='eona-mail' or report.get('status')!='passed':raise ValueError('complete_local_verification_required')
 if report.get('sourceCommit')!=commit or report.get('sourceTree')!=tree:raise ValueError('local_verification_source_mismatch')
 if report.get('planSha256')!=hashlib.sha256(json.dumps(plan,sort_keys=True).encode()).hexdigest():raise ValueError('local_verification_plan_changed')
 checked=datetime.datetime.fromisoformat(report['completedAt']);age=(datetime.datetime.now(datetime.timezone.utc)-checked).total_seconds()
 if not -60<=age<=86400:raise ValueError('local_verification_expired')
 if report.get('nodeMajor')!=plan['nodeMajor'] or report.get('pythonMinor')!=plan['pythonMinor']:raise ValueError('local_verification_runtime_mismatch')
 rows=report.get('checks',[])
 if [r.get('id')for r in rows]!=[s['id']for s in plan['steps']] or any(r.get('exitCode')!=0 for r in rows):raise ValueError('local_verification_incomplete_or_failed')
 expected={'reports/unit.xml','reports/contracts-source.json','reports/python.json','reports/results.json','reports/coverage.json','PRODUCT-RELEASE.json'}
 if not expected.issubset(report.get('files',{})):raise ValueError('local_verification_missing_evidence')
 for name,want in report['files'].items():
  path=folder/name
  if pathlib.PurePosixPath(name).is_absolute() or '..'in pathlib.PurePosixPath(name).parts or path.is_symlink()or not path.resolve().is_relative_to(folder.resolve())or not path.is_file()or digest(path)!=want:raise ValueError('local_verification_evidence_changed:'+name)
 actual=coverage(folder/'reports')
 saved=json.loads((folder/'reports/coverage.json').read_text())
 if actual!=saved or actual.get('status')!='passed' or actual.get('sourceCommit')!=commit:raise ValueError('local_verification_coverage_changed')
 meta=json.loads((folder/'PRODUCT-RELEASE.json').read_text())
 if meta['sourceCommit']!=commit or meta['sourceTree']!=tree or meta['workingTree']:raise ValueError('local_verification_bundle_mismatch')
 return report

def verify(path,root=ROOT):
 path=pathlib.Path(path).resolve();head=git('rev-parse','HEAD',root=root)
 if git('status','--porcelain',root=root):raise ValueError('local_verification_requires_clean_source')
 plan=json.loads(git('show',head+':'+PLAN,root=root));gate=load_gate(root)
 def coverage(folder):
  value=gate.inventory()
  return gate.verify(value,(folder/'unit.xml').read_bytes(),json.loads((folder/'contracts-source.json').read_text()),json.loads((folder/'python.json').read_text()),[json.loads((folder/'results.json').read_text())],head)
 return verify_report(json.loads(path.read_text()),plan,head,git('rev-parse','HEAD^{tree}',root=root),path.parent,coverage)

def verify_bundle(evidence,bundle):
 # Compare to the manifest captured during tests, not a replaceable package's
 # own claims. Every entry is bound to those exact bytes before publication.
 folder=pathlib.Path(evidence).resolve().parent;bundle=pathlib.Path(bundle).resolve()
 expected=folder/'PRODUCT-RELEASE.json';manifest=bundle/'PRODUCT-RELEASE.json'
 if manifest.is_symlink() or not manifest.is_file() or manifest.read_bytes()!=expected.read_bytes():raise ValueError('checked_bundle_manifest_changed')
 meta=json.loads(expected.read_text())
 for name,want in meta['files'].items():
  relative=pathlib.PurePosixPath(name);path=bundle/name
  if relative.is_absolute()or '..'in relative.parts or path.is_symlink()or not path.is_file()or not path.resolve().is_relative_to(bundle)or digest(path)!=want:raise ValueError('checked_bundle_file_changed:'+name)
 return meta

def cached(root=ROOT):
 common=pathlib.Path(git('rev-parse','--path-format=absolute','--git-common-dir',root=root))
 return common/'local-ci'/git('rev-parse','HEAD',root=root)/'evidence-path.json'
def remember(path):
 target=cached();target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps({'path':str(path.resolve())})+'\n');target.chmod(0o600)
def evidence_path(value):
 if value:return pathlib.Path(value).resolve()
 return pathlib.Path(json.loads(cached().read_text())['path'])

def demo(root,temp,environment):
 import socket
 with socket.socket()as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 directory=temp/'demo';origin='http://127.0.0.1:'+str(port)
 subprocess.run(['node','product/cli.mjs','init','--mode','demo','--directory',str(directory),'--origin',origin,'--email','demo@example.test'],cwd=root,env=environment,check=True,stdout=subprocess.DEVNULL)
 with(temp/'demo.log').open('w')as log:
  process=subprocess.Popen(['node','product/cli.mjs','serve','--config',str(directory/'mail.json')],cwd=root,env=environment,stdout=log,stderr=log)
  try:
   deadline=time.monotonic()+30
   while True:
    try:
     with urllib.request.urlopen(origin+'/health',timeout=2)as reply:health=json.load(reply)
     if not health['ok']or health['mode']!='demo':raise ValueError('demo_health_failed')
     with urllib.request.urlopen(origin+'/',timeout=2)as reply:assert reply.read(),'empty_demo_page'
     break
    except OSError:
     if time.monotonic()>deadline or process.poll()is not None:raise ValueError('demo_startup_failed')
     time.sleep(.1)
  finally:
   process.terminate()
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:process.kill();process.wait()


def preserve_artifacts(source,output):
 for name in ['test-results','playwright-report']:
  path=source/name
  if path.is_dir():shutil.copytree(path,output/'diagnostics'/name,dirs_exist_ok=True)

def run(output):
 output=output.resolve()
 if output.exists():raise ValueError('local_evidence_destination_exists')
 if output.is_relative_to(ROOT):raise ValueError('evidence_must_be_outside_source')
 if git('status','--porcelain'):raise ValueError('commit_reviewed_source_before_local_ci')
 if sys.version_info[:2]!=(3,12):raise ValueError('Python 3.12 is required; use the project CI environment')
 node=subprocess.check_output(['node','--version'],text=True).strip();major=int(node.lstrip('v').split('.')[0]);plan=json.loads((ROOT/PLAN).read_text())
 if major!=plan['nodeMajor']:raise ValueError('Node major does not match product contract')
 output.mkdir(parents=True);head=git('rev-parse','HEAD');tree=git('rev-parse','HEAD^{tree}')
 report={'schemaVersion':1,'product':'eona-mail','sourceCommit':head,'sourceTree':tree,'planSha256':hashlib.sha256(json.dumps(plan,sort_keys=True).encode()).hexdigest(),'status':'running','nodeMajor':major,'pythonMinor':list(sys.version_info[:2]),'platform':platform.platform(),'checks':[],'files':{}}
 path=output/'verification.json';temp=output/'isolated';source=temp/'source';bundle=temp/'bundle';temp.mkdir()
 environment={k:v for k,v in os.environ.items()if k in ['PATH','HOME','TMPDIR','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH','HTTPS_PROXY','HTTP_PROXY','NO_PROXY']};environment.update(CI='1',GITHUB_SHA=head,MAIL_CI_PYTHON=sys.executable,PYTHONDONTWRITEBYTECODE='1')
 binpath=temp/'bin';binpath.mkdir();(binpath/'python3').symlink_to(sys.executable);environment['PATH']=str(binpath)+os.pathsep+environment.get('PATH','')
 try:
  subprocess.run(['git','worktree','add','--detach',str(source),head],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  for step in plan['steps']:
   start=time.monotonic();row={'id':step['id'],'exitCode':None};report['checks'].append(row)
   print('CHECK '+step['id'],flush=True)
   with(output/(step['id']+'.log')).open('w')as log:
    command=step['run']
    if command=='@release':
     commands=[['node','scripts/release.mjs','--output',str(bundle)],['node',str(source/'scripts/verify-release.mjs')]]
     for i,cmd in enumerate(commands):subprocess.run(cmd,cwd=source if i==0 else bundle,env=environment,stdout=log,stderr=subprocess.STDOUT,check=True)
     shutil.copyfile(bundle/'PRODUCT-RELEASE.json',output/'PRODUCT-RELEASE.json');(bundle/'node_modules').symlink_to(source/'node_modules',target_is_directory=True)
    elif command=='@channel':subprocess.run([sys.executable,'scripts/test-release.py','--bundle',str(bundle)],cwd=source,env=environment,stdout=log,stderr=subprocess.STDOUT,check=True)
    elif command=='@demo':demo(source,temp,environment)
    else:
     childenv={**environment,**({'MAIL_PRODUCT_ROOT':str(bundle)}if step['id']=='browser'else{})}
     subprocess.run(command,shell=True,executable='/bin/bash',cwd=source,env=childenv,stdout=log,stderr=subprocess.STDOUT,check=True)
   row.update(exitCode=0,seconds=round(time.monotonic()-start,3));path.write_text(json.dumps(report,indent=2)+'\n')
  reports=output/'reports';reports.mkdir()
  for name in ['unit.xml','contracts-source.json','python.json','results.json','coverage.json']:shutil.copyfile(source/'test-results'/name,reports/name)
  report['files']={p.relative_to(output).as_posix():digest(p)for p in [output/'PRODUCT-RELEASE.json',*reports.iterdir()]}
  report.update(status='passed',completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path.write_text(json.dumps(report,indent=2)+'\n');verify(path);remember(path)
 except Exception as error:
  report.update(status='failed',error=str(error),completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());path.write_text(json.dumps(report,indent=2)+'\n');raise
 finally:
  preserve_artifacts(source,output)
  if source.exists():subprocess.run(['git','worktree','remove','--force',str(source)],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  # Keep the checked immutable bundle and logs for publication and diagnosis.
 print(json.dumps({'status':report['status'],'sourceCommit':head,'evidence':str(path),'coverage':json.loads((output/'reports/coverage.json').read_text())['executed']}),flush=True)
 return path


def platform_check():
 token=os.environ['GH_TOKEN'];repo=os.environ['GITHUB_REPOSITORY']
 with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/'+repo,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}),timeout=30)as reply:data=json.load(reply)
 if data['full_name']!='ecolid/eona-mail' or os.environ['GITHUB_EVENT_NAME']!='workflow_dispatch':raise ValueError('unexpected_platform_context')
 print(json.dumps({'status':'passed','scope':'GitHub event and read-token access only','sourceCommit':os.environ['GITHUB_SHA']}))

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('mode',choices=['run','verify','promote','publish','platform']);parser.add_argument('--output',type=pathlib.Path);parser.add_argument('--evidence',type=pathlib.Path);parser.add_argument('--bundle',type=pathlib.Path);a=parser.parse_args()
 if a.mode=='platform':return platform_check()
 if a.mode=='run':
  if not a.output:parser.error('--output required')
  return run(a.output)
 path=evidence_path(a.evidence);report=verify(path)
 if a.mode=='verify':
  if a.bundle:verify_bundle(path,a.bundle)
  print(json.dumps({'status':'passed','sourceCommit':report['sourceCommit']}));return
 source=git('rev-parse','HEAD');remote=git('remote','get-url','--push','origin').removesuffix('.git')
 if remote not in ['git@github.com:ecolid/eona-mail','https://github.com/ecolid/eona-mail']:raise ValueError('unexpected_product_remote')
 git('fetch','origin','refs/heads/main:refs/remotes/origin/main')
 if a.mode=='promote':
  subprocess.run(['git','merge-base','--is-ancestor','origin/main',source],cwd=ROOT,check=True);subprocess.run(['git','push','origin','HEAD:refs/heads/main'],cwd=ROOT,check=True)
  if git('ls-remote','origin','refs/heads/main').split()[0]!=source:raise ValueError('main_readback_changed')
  print(json.dumps({'main':source,'verification':'local-complete','cloud':'not-required'}));return
 if git('ls-remote','origin','refs/heads/main').split()[0]!=source:raise ValueError('only_checked_current_main_can_publish')
 bundle=path.parent/'isolated/bundle';verify_bundle(path,bundle);(bundle/'node_modules').unlink(missing_ok=True)
 subprocess.run(['node','scripts/verify-release.mjs'],cwd=bundle,check=True)
 result=subprocess.check_output(['node',str(ROOT/'scripts/publish-development.mjs'),str(bundle),'--verification',str(path)],cwd=ROOT,env={**os.environ,'MAIL_CI_PYTHON':sys.executable},text=True).strip()
 if not result:raise ValueError('main_changed_during_publication')
 print(json.dumps({'checkedSource':source,'channelCommit':result,'verification':'local-complete','evidence':str(path),'release':None,'releaseCadence':'selected-batch'}))

if __name__=='__main__':
 try:main()
 except (OSError,ValueError,AssertionError,subprocess.SubprocessError)as error:print('Local CI failed: '+str(error),file=sys.stderr);raise SystemExit(1)
