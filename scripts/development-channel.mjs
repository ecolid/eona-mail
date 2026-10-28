import {execFileSync} from 'node:child_process';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
export async function publishChannel(bundle){
bundle=resolve(bundle);const meta=JSON.parse(await readFile(join(bundle,'PRODUCT-RELEASE.json'),'utf8'));
const git=(args,extra={})=>execFileSync('git',args,{encoding:'utf8',...extra}).trim();
const source=git(['rev-parse','HEAD']);if(meta.releaseModel!=='source-main'||meta.sourceCommit!==source)throw Error('unchecked_source');
// A single-branch maintainer clone may fetch the channel only into FETCH_HEAD.
// Bind both authoritative heads explicitly before building the next ancestor.
git(['fetch','origin','+refs/heads/main:refs/remotes/origin/main','+refs/heads/channels/development:refs/remotes/origin/channels/development']);if(git(['rev-parse','origin/main'])!==source)process.exit(0);
const previous=git(['rev-parse','origin/channels/development']);
let prior={};try{prior=JSON.parse(git(['show',previous+':PRODUCT-RELEASE.json']));}catch{}
if(prior.sourceCommit===source){if(JSON.stringify(prior.files)!==JSON.stringify(meta.files))throw Error('published_source_bundle_changed');return previous;}
const temp=await mkdtemp(join(tmpdir(),'mail-channel-'));
try{
 const env={...process.env,GIT_DIR:git(['rev-parse','--absolute-git-dir']),GIT_LITERAL_PATHSPECS:'1',GIT_INDEX_FILE:join(temp,'index'),GIT_WORK_TREE:bundle,GIT_AUTHOR_NAME:'eona-mail release',GIT_AUTHOR_EMAIL:'release@users.noreply.github.com',GIT_COMMITTER_NAME:'eona-mail release',GIT_COMMITTER_EMAIL:'release@users.noreply.github.com'};
 git(['read-tree','--empty'],{env});git(['add','--force','--pathspec-from-file=-','--pathspec-file-nul'],{env,cwd:bundle,input:[...Object.keys(meta.files),'PRODUCT-RELEASE.json'].join('\0')+'\0'});const tree=git(['write-tree'],{env});
 const commit=git(['commit-tree',tree,'-p',previous,'-p',source],{env,input:'Release checked Mail '+source+'\n'});
 git(['push','origin',commit+':refs/heads/channels/development']);return commit;
}finally{await rm(temp,{recursive:true,force:true});}

}
