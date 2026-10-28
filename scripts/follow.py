#!/usr/bin/env python3
"""Follow a checked Git channel through a locally installed instance adapter.

The publisher owns the channel. A read-only repository key stays on the instance;
no API token is needed. The downloaded repository cannot replace this controller
or its privileged adapter. Run once from a service timer, using a protected JSON
config. All processes have bounded waits; one lock covers recovery and install.
"""
import argparse,fcntl,hashlib,json,os,pathlib,re,subprocess,tarfile,tempfile,time

SHA=re.compile(r'[0-9a-f]{40}')
def run(args,**kwargs):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=600,**kwargs).stdout.strip()
def write(path,value):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temporary=path.with_suffix('.next')
    with temporary.open('w') as f:
        os.chmod(temporary,0o600);json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    os.replace(temporary,path)
def verify(root):
    root=pathlib.Path(root);meta=json.loads((root/'PRODUCT-RELEASE.json').read_text())
    if meta.get('schema')!=1 or meta.get('product')!='eona-mail' or meta.get('workingTree') is not False or not SHA.fullmatch(meta.get('sourceCommit','')):raise ValueError('invalid_product_release')
    files=meta['files'];actual=set()
    for p in root.rglob('*'):
        if p.is_symlink():raise ValueError('release_symlink')
        if p.is_file() and p.relative_to(root).as_posix()!='PRODUCT-RELEASE.json':actual.add(p.relative_to(root).as_posix())
    if actual!=set(files):raise ValueError('release_file_set_changed')
    for name,want in files.items():
        p=pathlib.PurePosixPath(name)
        if p.is_absolute() or '..' in p.parts or str(p)!=name or not re.fullmatch('[0-9a-f]{64}',want):raise ValueError('unsafe_manifest')
        if hashlib.sha256((root/name).read_bytes()).hexdigest()!=want:raise ValueError('release_hash_changed:'+name)
    return meta
def extract(archive,root):
    with tarfile.open(archive) as tar:
        members=tar.getmembers()
        if len(members)>5000 or sum(m.size for m in members)>100*1024*1024:raise ValueError('release_size_limit')
        for m in members:
            p=pathlib.PurePosixPath(m.name)
            if p.is_absolute() or '..' in p.parts or not(m.isdir() or m.isfile()):raise ValueError('unsafe_archive')
            target=root/m.name
            if m.isdir():target.mkdir(parents=True,exist_ok=True)
            else:
                target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(tar.extractfile(m).read());target.chmod(0o644)
def cycle(config,state,fetch,install,recover):
    # Recover an interrupted cutover even if the operator has paused updates.
    observed=recover()
    if observed and 'installed' in observed:
        if observed['installed']!=state.get('installed'):state={k:v for k,v in state.items()if k not in ['sourceCommit','version','receipt']}
        state={**state,'installed':observed['installed']}
    if config.get('paused'):return {**state,'status':'paused'}
    revision,root=fetch(config.get('pin'),state.get('installed'))
    if not SHA.fullmatch(revision):raise ValueError('invalid_revision')
    meta=verify(root)
    if revision==state.get('installed'):return {**state,'status':'current','sourceCommit':meta['sourceCommit'],'version':meta['version'],'checkedAt':time.time()}
    if revision==state.get('failed'):return {**state,'status':'blocked_failed_release','checkedAt':time.time()}
    try:
        receipt=install(root,revision,meta)
    except Exception as error:
        return {**state,'status':'failed','failed':revision,'error':type(error).__name__+': '+str(error)[:400],'checkedAt':time.time()}
    return {'status':'current','installed':revision,'sourceCommit':meta['sourceCommit'],'version':meta['version'],'receipt':receipt,'checkedAt':time.time()}
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',required=True,type=pathlib.Path);parser.add_argument('action',choices=['once','status','pause','resume','pin','unpin','retry']);parser.add_argument('--revision');a=parser.parse_args()
    config=json.loads(a.config.read_text());base=pathlib.Path(config['stateDirectory']);base.mkdir(parents=True,exist_ok=True,mode=0o700)
    if a.config.stat().st_mode&0o022:raise ValueError('writable_update_configuration')
    with (base/'lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:print(json.dumps({'status':'busy'}));return
        status=base/'status.json';state=json.loads(status.read_text()) if status.exists() else {}
        if a.action=='status':print(json.dumps(state));return
        if a.action=='retry':
            state.pop('failed',None);state['status']='retry_requested';write(status,state);print(json.dumps(state));return
        if a.action!='once':
            if a.action in ['pause','resume']:config['paused']=a.action=='pause'
            elif a.action=='pin':
                if not SHA.fullmatch(a.revision or ''):raise ValueError('pin_requires_full_revision')
                config['pin']=a.revision
            else:config.pop('pin',None)
            write(a.config,config);print(json.dumps({'paused':config.get('paused',False),'pin':config.get('pin')}));return
        adapter=config['adapter'];env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GIT_SSH_COMMAND':config['sshCommand']}
        temporary=tempfile.TemporaryDirectory(prefix='release-',dir=base)
        def fetch(pin,installed):
            repo=base/'repository.git'
            if not repo.exists():run(['git','init','--bare',str(repo)])
            git=['git','--git-dir',str(repo)]
            run(git+['fetch','--no-tags','--prune',config['repository'],'+refs/heads/main:refs/heads/upstream-main','+refs/heads/channels/development:refs/heads/checked'],env=env)
            channel=run(git+['rev-parse','refs/heads/checked']);revision=pin or channel
            # A pin may only select a previously checked ancestor, never a raw main.
            run(git+['merge-base','--is-ancestor',revision,channel])
            if not pin and installed:run(git+['merge-base','--is-ancestor',installed,revision])
            root=pathlib.Path(temporary.name);archive=root/'bundle.tar'
            run(git+['archive','--format=tar','--output',str(archive),revision]);target=root/'code';target.mkdir();extract(archive,target)
            meta=verify(target)
            if meta.get('releaseModel')=='source-main':
                if meta.get('sourceRepository')!='ecolid/eona-mail':raise ValueError('release_source_repository_invalid')
                run(git+['merge-base','--is-ancestor',meta['sourceCommit'],'refs/heads/upstream-main'])
                run(git+['merge-base','--is-ancestor',meta['sourceCommit'],revision])
            else:run(git+['merge-base','--is-ancestor',revision,'refs/heads/upstream-main'])
            return revision,target
        def adapter_call(*args):return json.loads(run([*adapter,*map(str,args)]))
        try:
            value=cycle(config,state,fetch,lambda root,revision,meta:adapter_call('install','--release',root,'--revision',revision),lambda:adapter_call('recover'))
        except Exception as error:
            value={**state,'status':'check_failed','error':type(error).__name__+': '+str(error)[:400],'checkedAt':time.time()}
        finally:temporary.cleanup()
        write(status,value);print(json.dumps(value))
        if value['status'] in ['failed','check_failed','blocked_failed_release']:raise SystemExit(1)
if __name__=='__main__':main()
