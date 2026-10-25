import {compileWorkspaceMime} from '../sv/mail-mime.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export {compileWorkspaceMime};
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  let chunks=[],size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>80*1024*1024)throw Error('mime_input_limit');chunks.push(chunk);}
  process.stdout.write(await compileWorkspaceMime(JSON.parse(Buffer.concat(chunks))));
}
