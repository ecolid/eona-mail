// One registry for the CI runner and maintenance entry. All data is synthetic.
export const scenarios=[
  {id:'render-budget',port:8793,path:'/motion-flow-review',button:'#run',dataset:'mailMotionFlow',performance:true},
  {id:'final-touch',port:8793,path:'/motion-flow-review',button:'#fast',dataset:'mailMotionFastFlow'},
  {id:'refresh-boundary',port:8792,path:'/scroll-review',button:'#run',result:'#result'},
  {id:'pending-refresh',port:8793,path:'/feedback-review',button:'#run-pull',result:'#result'},
  {id:'reading-intent',port:8793,path:'/feedback-review',button:'#run-reader',result:'#result'},
  {id:'body-attachment-commit',port:8793,path:'/reader-paint-review',button:'#run',result:'#result',responsive:true},
  {id:'fast-return',port:8791,path:'/',label:'运行快速动效验收',dataset:'mailFastMotion'},
  {id:'motion-trajectory',port:8791,path:'/',label:'运行滑动帧验收',dataset:'mailMotionSuite'},
  {id:'return-budget',port:8791,path:'/',label:'运行返回开销定位',dataset:'mailReturnBudget',performance:true},
  {id:'repeat-resources',port:8791,path:'/',label:'运行连续返回帧验收',dataset:'mailRepeatPanSuite'},
  {id:'return-first-input',port:8791,path:'/',label:'运行返回首输入验收',dataset:'mailReturnHandoff'},
  {id:'browser-transition',port:8791,path:'/',label:'运行浏览器过渡交接验收',dataset:'mailUAReturn'},
  {id:'page-stack',port:8791,path:'/',label:'运行页面栈连续验收',dataset:'mailPageStack'},
  {id:'late-navigation',port:8791,path:'/',label:'运行迟到导航回放',dataset:'mailNavigationRace'},
  {id:'reader-families',port:8791,path:'/',label:'运行各类阅读退出验收',dataset:'mailReaderFamilies'},
  {id:'body-return',port:8792,path:'/',label:'运行正文与返回验收',dataset:'mailBodyReturnSuite'},
  {id:'continuous-use',port:8792,path:'/',label:'运行连续操作验收',dataset:'mailContinuationSuite'},
];

// Fail closed: running/empty/stale evidence must never become a green check.
export function validateEvidence(value,expectedCommit){
  if(!value||typeof value!=='object')throw Error('missing_browser_evidence');
  if(value.error||!(value.status==='passed'||value.pass===true))throw Error('browser_scenario_failed: '+JSON.stringify(value));
  if(!value.source?.sourceCommit||expectedCommit&&value.source.sourceCommit!==expectedCommit)throw Error('browser_source_mismatch');
  if(!value.source.manifestVerified||value.source.workingTree)throw Error('browser_requires_verified_release');
  const assertions=value.checks||value.cases||value.items;
  if(!assertions||Object.keys(assertions).length===0)throw Error('empty_browser_assertions');
  if(value.checks&&Object.values(value.checks).some(v=>v===false))throw Error('browser_assertion_failed');
  return value;
}
