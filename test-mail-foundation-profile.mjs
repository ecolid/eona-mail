import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EONA_FOUNDATION_CSS,EONA_FOUNDATION_JS} from './src/eona-foundation-assets.js';

test('standalone Foundation dependency and generated Mail assets have identical locked bytes',()=>{
 const root=new URL('./vendor/eona-foundation/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('eona-foundation.release.json',root)));
 assert.equal(manifest.profile,'standalone-v1');assert.equal(manifest.artifact,`eona-foundation/${manifest.version}/standalone-v1`);
 for(const [name,text]of [['eona-foundation.css',EONA_FOUNDATION_CSS],['eona-foundation.js',EONA_FOUNDATION_JS]]){
  const raw=readFileSync(new URL(name,root));assert.equal(text,raw.toString());assert.equal(createHash('sha256').update(raw).digest('hex'),manifest.files[name]);
 }
 assert.equal(readFileSync(new URL('./product/public/eona-foundation.css',import.meta.url),'utf8'),EONA_FOUNDATION_CSS);
});

test('standalone Foundation contains no personal application inventory or account destination',()=>{
 assert.doesNotMatch(EONA_FOUNDATION_JS,/https?:\/\/(?:[a-z0-9-]+\.)*(?:eona\.top|landi\.im)(?:[/:]|$)/i);
 assert.match(EONA_FOUNDATION_JS,/const applicationLinks=\[\];/);
 assert.match(EONA_FOUNDATION_JS,/const applicationIconData=\{\};/);
});
