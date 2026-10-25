import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
const release=JSON.parse(await readFile('PRODUCT-RELEASE.json','utf8'));
if(release.workingTree||release.databaseSchema!==1||!/^[a-f0-9]{40}$/.test(release.sourceCommit))throw Error('invalid_release');
const actual=[];async function walk(path=''){for(const e of await readdir(path||'.',{withFileTypes:true})){if(['.git','node_modules'].includes(e.name))continue;const p=path?path+'/'+e.name:e.name;if(e.isSymbolicLink())throw Error('release_symlink');if(e.isDirectory())await walk(p);else if(p!=='PRODUCT-RELEASE.json')actual.push(p);}}await walk();
if(JSON.stringify(actual.sort())!==JSON.stringify(Object.keys(release.files).sort()))throw Error('release_file_set_changed');
for(const [name,expected] of Object.entries(release.files)){if(name.startsWith('/')||name.split('/').includes('..'))throw Error('unsafe_path');const raw=await readFile(name);if(createHash('sha256').update(raw).digest('hex')!==expected)throw Error('release_hash_changed:'+name);}
console.log(JSON.stringify({verified:Object.keys(release.files).length,sourceCommit:release.sourceCommit}));
