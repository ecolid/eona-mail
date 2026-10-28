// Use the ordinary product test command, adding evidence reporters only.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const pkg=JSON.parse(readFileSync('package.json','utf8'));
if(!pkg.scripts.test.startsWith('node --test '))throw Error('unsupported_product_test_command');
mkdirSync('test-results',{recursive:true});
const args=pkg.scripts.test.slice('node --test '.length).trim().split(/\s+/);
const result=spawnSync(process.execPath,['--test','--test-reporter=spec','--test-reporter=junit','--test-reporter-destination=stdout','--test-reporter-destination=test-results/unit.xml',...args],{stdio:'inherit'});
const xml=readFileSync('test-results/unit.xml');
writeFileSync('test-results/contracts-source.json',JSON.stringify({product:'eona-mail',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sha256:createHash('sha256').update(xml).digest('hex')})+'\n');
process.exit(result.status??1);
