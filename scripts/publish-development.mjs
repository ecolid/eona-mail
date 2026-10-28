// The public publisher always requires the complete exact-commit local evidence.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {publishChannel} from './development-channel.mjs';
const flag=process.argv.indexOf('--verification');
if(flag<0||!process.argv[flag+1])throw Error('complete_local_verification_required');
const verifier=fileURLToPath(new URL('./local-ci.py',import.meta.url));
execFileSync(process.env.MAIL_CI_PYTHON||'python3',[verifier,'verify','--evidence',process.argv[flag+1]],{stdio:['ignore','ignore','inherit']});
const commit=await publishChannel(process.argv[2]);if(commit)console.log(commit);
