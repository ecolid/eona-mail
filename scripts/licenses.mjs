import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url)),check=process.argv.includes('--check');
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const records=[];
for(const [path,pkg]of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b,'en'))){
 if(!path)continue;const name=path.replace(/^node_modules\//,''),license=pkg.license;if(!license)throw Error('missing_dependency_license:'+name);
 const record={name,version:pkg.version,license,optional:!!pkg.optional,integrity:pkg.integrity||null,licenses:[]};
 if(!pkg.optional){
  const local=join(root,path),names=(await readdir(local)).filter(n=>/^(license|copying|notice)(?:[.-].*)?$/i.test(n)).sort();
  if(!names.length&&name==='overlayscrollbars')names.push('@existing');
  if(!names.length)throw Error('missing_license_text:'+name);
  for(const file of names){const raw=await readFile(file==='@existing'?join(root,'vendor/mail-experience/overlayscrollbars-LICENSE'):join(local,file));const target='vendor/npm-licenses/'+name.replaceAll('/','__')+'/'+(file==='@existing'?'LICENSE':file);const sha=createHash('sha256').update(raw).digest('hex');record.licenses.push({file:target,sha256:sha});
   if(check){if(createHash('sha256').update(await readFile(join(root,target))).digest('hex')!==sha)throw Error('license_drift:'+target);}
   else{await mkdir(resolve(root,target,'..'),{recursive:true});await writeFile(join(root,target),raw);}
  }
 }
 records.push(record);
}
const frameworks=JSON.parse(await readFile(join(root,'vendor/framework-licenses/sources.json'),'utf8'));
for(const [file,entry]of Object.entries(frameworks)){
 if(!['Filament-LICENSE.md','Tailwind-LICENSE'].includes(file)||!entry.url.startsWith('https://raw.githubusercontent.com/'))throw Error('unreviewed_framework_license');
 if(createHash('sha256').update(await readFile(join(root,'vendor/framework-licenses',file))).digest('hex')!==entry.sha256)throw Error('framework_license_drift:'+file);
}
const outputs=new Map([['vendor/npm-licenses/manifest.json',JSON.stringify({schema:1,lockfileSha256:createHash('sha256').update(await readFile(join(root,'package-lock.json'))).digest('hex'),packages:records},null,2)+'\n'],['THIRD_PARTY_NOTICES.md',[
 '# 第三方组件','', '本清单由锁文件和原始许可文本生成。Eona 自有代码采用 MIT；第三方保持原许可。可选平台工具仅记录元数据，其二进制不随源码包分发。','',
 'Foundation 固定界面依赖中的 Eona 自有代码随本项目 MIT 许可。Filament/Tailwind 衍生样式的原始 MIT 声明保存在 vendor/framework-licenses/；编辑器与交互组件原有声明也保留。','',
 '| 包 | 版本 | 许可 | 原始声明 |','| --- | --- | --- | --- |',...records.map(r=>'| '+r.name+' | '+r.version+' | '+r.license+' | '+(r.licenses.map(l=>'['+l.file.split('/').at(-1)+']('+l.file+')').join(', ')||'可选平台工具，源码包不含其二进制')+' |'),''].join('\n')]]);
for(const [name,raw]of outputs){if(check){if(await readFile(join(root,name),'utf8')!==raw)throw Error('license_inventory_drift:'+name);}else await writeFile(join(root,name),raw);}
console.log(JSON.stringify({licenses:records.length,status:'verified',mode:check?'check':'generate'}));
