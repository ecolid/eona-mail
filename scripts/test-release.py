"""Exercise the real release publisher and follower against a local Git origin."""
import argparse,json,pathlib,subprocess,tempfile,os,shutil
p=argparse.ArgumentParser();p.add_argument('--bundle',required=True,type=pathlib.Path);a=p.parse_args();root=pathlib.Path(__file__).resolve().parents[1];source=json.loads((a.bundle/'PRODUCT-RELEASE.json').read_text())['sourceCommit']
def run(args,cwd=None,env=None):
 result=subprocess.run(args,cwd=cwd,env=env,text=True,capture_output=True)
 if result.returncode:raise RuntimeError(result.stdout+'\n'+result.stderr)
 return result.stdout.strip()
with tempfile.TemporaryDirectory(prefix='mail-channel-test-')as d:
 d=pathlib.Path(d);bare=d/'origin.git';work=d/'work';run(['git','clone','--bare','--no-hardlinks',str(root),str(bare)]);git=['git','--git-dir',str(bare)]
 old=run(['git','rev-list','--max-parents=0',source],cwd=root).splitlines()[0];run(git+['update-ref','refs/heads/main',source]);run(git+['update-ref','refs/heads/channels/development',old]);run(['git','clone','--branch','main',str(bare),str(work)])
 revision=run(['node',str(root/'scripts/publish-development.mjs'),str(a.bundle)],cwd=work,env={**os.environ,'GITHUB_SHA':source});assert len(revision)==40
 assert run(git+['rev-parse','main'])==source and run(git+['rev-parse','channels/development'])==revision
 for ancestor in [source,old]:run(git+['merge-base','--is-ancestor',ancestor,revision])
 adapter=d/'adapter.py';adapter.write_text('''import json,pathlib,sys
p=pathlib.Path(__file__).with_name('installed.json')
if sys.argv[1]=='recover':print(p.read_text()if p.exists()else '{}')
else:
 r=sys.argv[sys.argv.index('--revision')+1];p.write_text(json.dumps({'installed':r}));print(json.dumps({'healthy':True,'installed':r}))
''');cfg=d/'follow.json';cfg.write_text(json.dumps({'repository':bare.as_uri(),'stateDirectory':str(d/'state'),'sshCommand':'false','adapter':['python3',str(adapter)]}));cfg.chmod(0o600)
 state=json.loads(run(['python3',str(root/'scripts/follow.py'),'--config',str(cfg),'once']));assert state['status']=='current' and state['installed']==revision and state['sourceCommit']==source
 again=json.loads(run(['python3',str(root/'scripts/follow.py'),'--config',str(cfg),'once']));assert again['installed']==revision and again['status']=='current'
 print(json.dumps({'sourceCommit':source,'checkedRelease':revision,'mainPreserved':True,'channelHistoryPreserved':True,'followerInstalledAndRechecked':True}))
