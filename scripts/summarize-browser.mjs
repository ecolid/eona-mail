import {readFile,appendFile} from 'node:fs/promises';
const report=JSON.parse(await readFile('test-results/results.json','utf8'));
const rows=[];
function visit(suite){
  for(const spec of suite.specs||[])for(const test of spec.tests||[])rows.push({
    name:spec.title,project:test.projectName,status:test.status,
    seconds:((test.results||[]).reduce((n,r)=>n+r.duration,0)/1000).toFixed(2),
  });
  for(const child of suite.suites||[])visit(child);
}
for(const suite of report.suites||[])visit(suite);
const text=['## Mail browser gates',`Source: ${process.env.GITHUB_SHA||'local'}`,
  `Expected: ${report.stats.expected}; unexpected: ${report.stats.unexpected}; skipped: ${report.stats.skipped}.`,
  '', '| Browser | Scenario | Result | Seconds |','| --- | --- | --- | ---: |',
  ...rows.map(r=>`| ${r.project} | ${r.name} | ${r.status} | ${r.seconds} |`),
  '', 'Raw measurements and source bindings are attached to each test. Failure traces/screenshots and the HTML report are retained in the private run artifact for 14 days.',''].join('\n');
console.log(text);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,text);
if(!rows.length)throw Error('empty_browser_report');
