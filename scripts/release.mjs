import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,rm,writeFile,readFile,readdir,stat} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildRelease(output){
 output=resolve(output);if(output===resolve(root)||output.startsWith(resolve(root)+'/'))throw Error('release_output_inside_source');
 try{await stat(output);throw Error('release_output_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
 if(git('status','--porcelain'))throw Error('release_requires_committed_source');
 const sourceCommit=git('rev-parse','HEAD'),sourceTree=git('rev-parse','HEAD^{tree}');
 const temp=await mkdtemp(join(tmpdir(),'mail-release-'));
 try{
  const archive=join(temp,'source.tar');execFileSync('git',['-C',root,'archive','--format=tar','--output',archive,sourceCommit]);await mkdir(output,{recursive:true});execFileSync('tar',['-xf',archive,'-C',output]);
  const files={};async function walk(dir=''){for(const entry of await readdir(join(output,dir),{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isSymbolicLink())throw Error('release_symlink');if(entry.isDirectory())await walk(p);else{
   const raw=await readFile(join(output,p));if(/\.(?:m?js|py|json|md|ya?ml)$/.test(p)&&!p.startsWith('vendor/')){const text=raw.toString();if(/\/Users\/landi|\/srv\/tools-dsh|\/var\/lib\/accompany|-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\becolid@(?:163|126|foxmail|qq)\.com/.test(text))throw Error('private_material_in_product:'+p);}
   files[p]=createHash('sha256').update(raw).digest('hex');
  }}}await walk();
  const pkg=JSON.parse(await readFile(join(output,'package.json'),'utf8')),foundation=JSON.parse(await readFile(join(output,'vendor/eona-foundation/eona-foundation.release.json'),'utf8'));
  const meta={schema:1,product:'eona-mail',version:pkg.version,sourceRepository:'ecolid/eona-mail',releaseModel:'source-main',sourceCommit,sourceTree,workingTree:false,databaseSchema:1,compatibility:{adapterApi:1,nodeMajor:24,databaseSchema:1,foundation},files};
  await writeFile(join(output,'PRODUCT-RELEASE.json'),JSON.stringify(meta,null,2)+'\n');return meta;
 }catch(error){await rm(output,{recursive:true,force:true});throw error;}finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const i=process.argv.indexOf('--output');if(i<0||!process.argv[i+1])throw Error('output_required');const m=await buildRelease(process.argv[i+1]);console.log(JSON.stringify({sourceCommit:m.sourceCommit,files:Object.keys(m.files).length}));}
