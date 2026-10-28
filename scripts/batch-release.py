#!/usr/bin/env python3
"""Prepare a selected Release from the same fully checked Mail repository."""
import argparse,gzip,hashlib,importlib.util,io,json,pathlib,re,subprocess,tarfile,urllib.error,urllib.parse,urllib.request,os
ROOT=pathlib.Path(__file__).resolve().parents[1]
REPOSITORY='ecolid/eona-mail'

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def git(*args,root=ROOT):return subprocess.check_output(['git','-C',str(root),*args],text=True,stderr=subprocess.PIPE).strip()
def gate(root=ROOT):
 spec=importlib.util.spec_from_file_location('mail_local_ci',root/'scripts/local-ci.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def selected_batch(root,version):
 if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?',version):raise ValueError('invalid_release_version')
 pkg=json.loads((root/'package.json').read_text())
 if pkg['version']!=version or pkg.get('license')!='MIT':raise ValueError('release_version_or_license_mismatch')
 policy=json.loads((root/'release/policy.json').read_text())
 if policy['repository']!=REPOSITORY or policy['development']!='single-product-main' or policy['releases']!='selected-batch' or policy['automaticDevelopmentReleases']:raise ValueError('single_repository_batch_policy_required')
 if policy.get('requirePreviewSiteMatch')is not True or not re.fullmatch(r'https://[a-z0-9.-]+',policy.get('pairedPreviewSite','')):raise ValueError('paired_preview_policy_required')
 batch=json.loads((root/'release/batches'/f'{version}.json').read_text())
 if batch.get('schema')!=1 or batch.get('version')!=version or not isinstance(batch.get('prerelease'),bool):raise ValueError('invalid_batch')
 ids=batch.get('changes',[])
 if not ids or len(ids)!=len(set(ids)):raise ValueError('empty_or_duplicate_changes')
 seen=set()
 for path in (root/'release/batches').glob('*.json'):
  value=json.loads(path.read_text())
  for entry in value['changes']:
   if entry in seen:raise ValueError('change_reused_in_multiple_batches')
   seen.add(entry)
 entries=[]
 for entry in ids:
  if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}',entry):raise ValueError('invalid_change_id')
  value=json.loads((root/'release/changes'/f'{entry}.json').read_text())
  if value.get('id')!=entry or not isinstance(value.get('summary'),str)or not value['summary'].strip()or not isinstance(value.get('details'),list)or not all(isinstance(x,str)and x.strip()for x in value['details']):raise ValueError('invalid_change')
  entries.append(value)
 return batch,entries

def archive_bundle(bundle,path,version):
 meta=json.loads((bundle/'PRODUCT-RELEASE.json').read_text());names=sorted([*meta['files'],'PRODUCT-RELEASE.json'])
 with path.open('xb')as destination,gzip.GzipFile(filename='',mode='wb',fileobj=destination,mtime=0)as compressed,tarfile.open(fileobj=compressed,mode='w')as tar:
  for name in names:
   source=bundle/name;relative=pathlib.PurePosixPath(name)
   if relative.is_absolute()or '..'in relative.parts or source.is_symlink()or not source.is_file()or not source.resolve().is_relative_to(bundle.resolve()):raise ValueError('unsafe_bundle_path')
   raw=source.read_bytes()
   if name!='PRODUCT-RELEASE.json'and hashlib.sha256(raw).hexdigest()!=meta['files'][name]:raise ValueError('bundle_file_changed')
   item=tarfile.TarInfo(f'eona-mail-{version}/'+name);item.size=len(raw);item.mode=0o644;item.mtime=0;tar.addfile(item,io.BytesIO(raw))
 return meta

def prepare(evidence,output,root=ROOT):
 evidence=evidence.resolve();output=output.resolve();verification=gate(root).verify(evidence,root)
 if output.exists():raise ValueError('release_destination_exists')
 if output.is_relative_to(root.resolve()):raise ValueError('release_output_inside_source')
 version=json.loads((root/'package.json').read_text())['version'];batch,entries=selected_batch(root,version);bundle=evidence.parent/'isolated/bundle'
 gate(root).verify_bundle(evidence,bundle)
 subprocess.run(['node',str(root/'scripts/verify-release.mjs')],cwd=bundle,check=True,stdout=subprocess.DEVNULL)
 meta=json.loads((bundle/'PRODUCT-RELEASE.json').read_text())
 if meta['sourceCommit']!=verification['sourceCommit']or meta['version']!=version:raise ValueError('verified_bundle_source_mismatch')
 output.mkdir(parents=True);archive=output/f'eona-mail-{version}.tar.gz';archive_bundle(bundle,archive,version)
 coverage=json.loads((evidence.parent/'reports/coverage.json').read_text())
 # Public evidence is a compact summary: no local paths, logs, browser traces or instance data.
 summary={'schema':1,'product':'eona-mail','sourceCommit':verification['sourceCommit'],'sourceTree':verification['sourceTree'],'completedAt':verification['completedAt'],'status':'passed','checks':[x['id']for x in verification['checks']],'coverage':coverage['executed'],'bundleSha256':sha(archive)}
 (output/'verification-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
 notes=f'# Eona Mail {version}\n\n'+('预览版。\n\n'if batch['prerelease']else '')+'\n\n'.join('## '+x['summary']+'\n\n'+'\n'.join('- '+line for line in x['details'])for x in entries)+'\n\n安装与升级见仓库 docs/SELF-HOSTING.md；许可 MIT。\n'
 (output/'RELEASE-NOTES.md').write_text(notes)
 files={p.name:sha(p)for p in output.iterdir()if p.is_file()}
 (output/'SHA256SUMS').write_text(''.join(value+'  '+name+'\n'for name,value in sorted(files.items())))
 files['SHA256SUMS']=sha(output/'SHA256SUMS')
 result={'schema':1,'repository':REPOSITORY,'sourceCommit':verification['sourceCommit'],'sourceTree':verification['sourceTree'],'version':version,'tag':'v'+version,'prerelease':batch['prerelease'],'changes':batch['changes'],'files':files,'published':False}
 (output/'release-plan.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');return result

def verify_prepared(folder,evidence,root=ROOT):
 verification=gate(root).verify(evidence.resolve(),root);plan=json.loads((folder/'release-plan.json').read_text());batch,_=selected_batch(root,plan['version'])
 if plan['repository']!=REPOSITORY or plan['sourceCommit']!=verification['sourceCommit']or plan['sourceTree']!=verification['sourceTree']or plan['tag']!='v'+plan['version']or plan['prerelease']!=batch['prerelease']or plan['changes']!=batch['changes']or plan['published']is not False:raise ValueError('prepared_release_source_mismatch')
 expected={f'eona-mail-{plan["version"]}.tar.gz','verification-summary.json','RELEASE-NOTES.md','SHA256SUMS'}
 if set(plan['files'])!=expected or set(p.name for p in folder.iterdir())!=expected|{'release-plan.json'}:raise ValueError('prepared_release_inventory_changed')
 for name,want in plan['files'].items():
  path=folder/name
  if path.is_symlink()or not path.is_file()or sha(path)!=want:raise ValueError('prepared_release_file_changed')
 # Regenerate the checked source archive and notes, so editing both a file and the plan cannot bypass review.
 import tempfile
 with tempfile.TemporaryDirectory(prefix='mail-batch-verify-')as temporary:
  regenerated=pathlib.Path(temporary)/'prepared';fresh=prepare(evidence,regenerated,root)
  if fresh!=plan:raise ValueError('prepared_release_changed')
 return plan

def verify_preview(plan,root=ROOT):
 origin=json.loads((root/'release/policy.json').read_text())['pairedPreviewSite']
 def get(path):
  request=urllib.request.Request(origin+path,headers={'User-Agent':'mail-batch-readback','Cache-Control':'no-cache'})
  with urllib.request.urlopen(request,timeout=30)as response:
   if urllib.parse.urlsplit(response.url).netloc!=urllib.parse.urlsplit(origin).netloc:raise ValueError('preview_redirected')
   return json.load(response)
 receipt=get('/_mail_release.json');health=get('/health')
 expected={'schema':1,'mode':'demo','version':plan['version'],'sourceCommit':plan['sourceCommit'],'archiveSha256':plan['files'][f'eona-mail-{plan["version"]}.tar.gz']}
 if receipt!=expected or health.get('mode')!='demo' or health.get('ok')is not True:raise ValueError('preview_release_mismatch')
 return receipt

def publish(folder,evidence,confirmation,root=ROOT):
 if confirmation!=REPOSITORY:raise ValueError('explicit_repository_publication_confirmation_required')
 plan=verify_prepared(folder,evidence,root)
 if git('remote','get-url','origin',root=root).removesuffix('.git')not in ['https://github.com/'+REPOSITORY,'git@github.com:'+REPOSITORY]:raise ValueError('unexpected_repository')
 if git('ls-remote','origin','refs/heads/main',root=root).split()[0]!=plan['sourceCommit']:raise ValueError('only_checked_current_main_can_release')
 verify_preview(plan,root)
 credential=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',capture_output=True,text=True,check=True,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_ASKPASS':'/usr/bin/false'})
 token=dict(line.split('=',1)for line in credential.stdout.splitlines()if '='in line)['password']
 def api(method,url,body=None,content='application/json'):
  if urllib.parse.urlsplit(url).hostname not in ['api.github.com','uploads.github.com']:raise ValueError('unexpected_github_endpoint')
  data=json.dumps(body).encode()if isinstance(body,dict)else body
  request=urllib.request.Request(url,data=data,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':content,'User-Agent':'mail-selected-release'})
  with urllib.request.urlopen(request,timeout=90)as response:return json.load(response)
 base='https://api.github.com/repos/'+REPOSITORY;repository=api('GET',base)
 if repository['full_name']!=REPOSITORY or repository['private']:raise ValueError('repository_visibility_review_required_before_public_release')
 refs=git('ls-remote','origin','refs/tags/'+plan['tag'],root=root).split()
 if refs and refs[0]!=plan['sourceCommit']:raise ValueError('existing_release_tag_changed')
 if not refs:
  subprocess.run(['git','push','origin',plan['sourceCommit']+':refs/tags/'+plan['tag']],cwd=root,check=True)
 if git('ls-remote','origin','refs/tags/'+plan['tag'],root=root).split()[0]!=plan['sourceCommit']:raise ValueError('release_tag_readback_failed')
 try:release=api('GET',base+'/releases/tags/'+plan['tag'])
 except urllib.error.HTTPError as error:
  if error.code!=404:raise
  release=api('POST',base+'/releases',{'tag_name':plan['tag'],'target_commitish':plan['sourceCommit'],'name':'Eona Mail '+plan['version'],'body':(folder/'RELEASE-NOTES.md').read_text(),'draft':True,'prerelease':plan['prerelease']})
 if release['prerelease']!=plan['prerelease']or release['body']!=(folder/'RELEASE-NOTES.md').read_text():raise ValueError('existing_release_metadata_changed')
 expected=set(plan['files'])
 if any(x['name']not in expected for x in release['assets']):raise ValueError('existing_release_inventory_changed')
 for name,want in plan['files'].items():
  found=next((x for x in release['assets']if x['name']==name),None)
  if found:
   if found.get('digest')!='sha256:'+want:raise ValueError('existing_release_asset_changed')
  else:
   asset=api('POST',release['upload_url'].split('{')[0]+'?'+urllib.parse.urlencode({'name':name}),(folder/name).read_bytes(),'application/gzip'if name.endswith('.gz')else 'application/octet-stream')
   if asset.get('digest')!='sha256:'+want or asset['state']!='uploaded':raise ValueError('release_asset_readback_failed')
 verify_preview(plan,root)
 if release['draft']:api('PATCH',base+'/releases/'+str(release['id']),{'draft':False})
 current=api('GET',base+'/releases/tags/'+plan['tag'])
 if current['draft']or len(current['assets'])!=len(expected)or any(x.get('digest')!='sha256:'+plan['files'][x['name']]for x in current['assets']):raise ValueError('release_readback_failed')
 verify_preview(plan,root)
 return {'url':current['html_url'],'sourceCommit':plan['sourceCommit'],'tag':plan['tag'],'assetsVerified':len(expected)}

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['prepare','verify','publish']);p.add_argument('--evidence',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--confirm-publication');a=p.parse_args()
 if a.mode=='prepare':value=prepare(a.evidence,a.output)
 elif a.mode=='verify':value=verify_prepared(a.output,a.evidence)
 else:value=publish(a.output,a.evidence,a.confirm_publication)
 print(json.dumps(value,ensure_ascii=False))
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,subprocess.SubprocessError)as error:raise SystemExit(str(error))
