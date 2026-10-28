import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root=resolve(process.env.MAIL_PRODUCT_ROOT||fileURLToPath(new URL('.',import.meta.url)));
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const fixture=(port,extra)=>({
  command:`node ${quote(root+'/test/browser/mail-directory-fixture.mjs')} ${port}`,
  url:`http://127.0.0.1:${port}/`, reuseExistingServer:false, timeout:60000,
  env:{MAIL_PRODUCT_ROOT:root,MAIL_FIXTURE_DENSE:'1',MAIL_FIXTURE_JOURNEYS:'1',MAIL_FIXTURE_CONTROLS:'1',...extra},
});
export default defineConfig({
  metadata:{product:'eona-mail',sourceCommit:process.env.GITHUB_SHA||'local'},
  testDir:'test/browser/specs', fullyParallel:false, workers:1, retries:0,
  timeout:120000, globalTimeout:12*60*1000, expect:{timeout:15000},
  forbidOnly:!!process.env.CI,
  outputDir:'test-results',
  reporter:[['line'],['html',{open:'never'}],['json',{outputFile:'test-results/results.json'}]],
  use:{viewport:{width:1440,height:1000},hasTouch:true,actionTimeout:15000,
    screenshot:'only-on-failure',trace:{mode:'retain-on-failure',snapshots:false,screenshots:false,sources:true}},
  projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit'}}],
  webServer:[fixture(8791,{MAIL_FIXTURE_RICH:'1',MAIL_FIXTURE_MOTION:'1'}),
    fixture(8792,{MAIL_FIXTURE_RICH:'1'}),
    fixture(8793,{MAIL_FIXTURE_PAINT:'1',MAIL_FIXTURE_VISUAL:'1'})],
});
