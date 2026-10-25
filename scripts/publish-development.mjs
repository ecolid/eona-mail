// Only CI's checked main may publish. The channel retains both checked release
// history and source ancestry; source commits and release commits stay distinct.
import {execFileSync} from 'node:child_process';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';
const bundle=resolve(process.argv[2]||''),meta=JSON.parse(await readFile(join(bundle,'PRODUCT-RELEASE.json'),'utf8'));
const git=(args,extra={})=>execFileSync('git',args,{encoding:'utf8',...extra}).trim();
const source=git(['rev-parse','HEAD']);if(meta.releaseModel!=='source-main'||meta.sourceCommit!==source||source!==process.env.GITHUB_SHA)throw Error('unchecked_source');
git(['fetch','origin','main','channels/development']);if(git(['rev-parse','origin/main'])!==source)process.exit(0);
const previous=git(['rev-parse','origin/channels/development']),temp=await mkdtemp(join(tmpdir(),'mail-channel-'));
try{
 const env={...process.env,GIT_DIR:git(['rev-parse','--absolute-git-dir']),GIT_INDEX_FILE:join(temp,'index'),GIT_WORK_TREE:bundle,GIT_AUTHOR_NAME:'eona-mail release',GIT_AUTHOR_EMAIL:'release@users.noreply.github.com',GIT_COMMITTER_NAME:'eona-mail release',GIT_COMMITTER_EMAIL:'release@users.noreply.github.com'};
 git(['read-tree','--empty'],{env});git(['add','--all','--force','.'],{env,cwd:bundle});const tree=git(['write-tree'],{env});
 const commit=git(['commit-tree',tree,'-p',previous,'-p',source],{env,input:'Release checked Mail '+source+'\n'});
 git(['push','origin',commit+':refs/heads/channels/development']);console.log(commit);
}finally{await rm(temp,{recursive:true,force:true});}
