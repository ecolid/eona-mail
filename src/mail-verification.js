// One decision supplies both the mail label and the copyable token. A number
// elsewhere in a mail, a URL or an inherited/model category is never evidence.
export const VERIFICATION_REV = 1;
const MARKER = /验证码|校验码|验证代码|安全代码|登录代码|登录码|动态密码|一次性(?:代码|密码|口令)|\b(?:(?:verification|security|authentication|confirmation|login|log[ -]?in|sign[ -]?in|one[ -]?time|single[ -]?use|access|guard)\s+(?:code|password|passcode)|otp|passcode)\b/gi;
const TOKEN = '(?:[0-9]{3}[ \\t][0-9]{3}|[A-Za-z0-9]{4,20})';
const DIRECT = new RegExp('^\\s*(?:(?:是|为|為|is|equals)\\s*)?[:：=\\[【(（]*\\s*('+TOKEN+')(?![A-Za-z0-9@/_-]|\\.[0-9])','i');
const INSTRUCTION = new RegExp('^\\s+(?:to|for|in|below)\\b[^:：\\n]{0,180}[:：]\\s*('+TOKEN+')(?![A-Za-z0-9@/_-]|\\.[0-9])','i');
const INPUT = new RegExp('^\\s*输入框[^:：\\n]{0,40}[:：]\\s*('+TOKEN+')(?![A-Za-z0-9@/_-]|\\.[0-9])');
const LOCAL_ACTION = new RegExp('^[^0-9A-Za-z:：\\n]{0,50}(?:输入|操作|登录|验证|注册)[^0-9A-Za-z:：\\n]{0,30}[:：]\\s*('+TOKEN+')(?![A-Za-z0-9@/_-]|\\.[0-9])');
const LINE_TOKEN = new RegExp('^[ \\t=]*(?:G-)?('+TOKEN+')[ \\t=.。!！]*$');
const VALUE_WITH_PURPOSE = new RegExp('^[ \\t]*(?:G-)?('+TOKEN+')(?![A-Za-z0-9@/_-]|\\.[0-9])\\s*[，,]?\\s*[(（]?(?:为了|请填|请在|以完成|用于|有效|valid\\b|expires\\b|to (?:complete|sign|log|verify)\\b)','i');
const REVERSE = new RegExp('(?:^|[^A-Za-z0-9@/_.-])(?:(?:G|FB)-)?('+TOKEN+')\\s*(?:是|为|is)\\s*(?:您|你|您的|你的|your)?[^\\n。.!！:：]{0,45}$','i');
const META = /教程|原理|示例|样例|指南|如何.*(?:验证码|安全代码)|\b(?:tutorial|documentation|example|sample)\b|how to.*(?:verification|security|one.time) code/i;
const ALERT = /安全(?:警报|提醒)|异常.{0,12}(?:登录|活动)|检测到.{0,25}(?:登录|访问)|security alert|unusual.{0,15}(?:login|sign.in)/i;
const MARKER_TEST = new RegExp(MARKER.source,'i');
const REFERENCE = /(?:此|该|上述)代码|\b(?:this|your) code\b/gi;
const AUTH_ACTION = /(?:log[ -]?in|sign[ -]?in|authentication|verify (?:your |the )?(?:account|email)|registration)|(?:登录|登陆|绑定|身份验证)|(?:请|输入).{0,30}验证码.{0,30}(?:操作|继续|完成)/i;

function clean(value) {
  return String(value || '').slice(0,100000)
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/https?:\/\/[^\s<>]+/gi,' ')
    .replace(/<[^>]{1,1000}>/g,' ')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,dec)=>{
      const n=parseInt(hex || dec,hex?16:10);return n<=0x10ffff?String.fromCodePoint(n):' ';
    }).replace(/&nbsp;|&zwnj;|&zwj;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/[\p{Cf}\u034f\ufe00-\ufe0f]/gu,'')
    .replace(/[\p{Zs}\t]+/gu,' ').replace(/\r\n?/g,'\n')
    .replace(/\b(verification|security|authentication|confirmation|login|log[ -]?in|sign[ -]?in|one[ -]?time|single[ -]?use) *\n *(code|password|passcode)\b/gi,'$1 $2')
    .replace(/(?:\n *){3,}/g,'\n\n').trim();
}
function token(value,standalone=false,allowLong=false) {
  const s=String(value || '').replace(/[ \t]/g,'');
  // English prose is not a token. Pure-letter inline codes must be uppercase;
  // preserve the case supplied by the mail, including mixed codes.
  if(!/^[A-Za-z0-9]{4,20}$/.test(s) || (s.length>10 && !allowLong))return null;
  if(/^[A-Za-z]+$/.test(s) && !/^[A-Z]+$/.test(s) && !(standalone && /^[a-z]+$/.test(s)))return null;
  if(/^(?:please|thanks|regards|verify|enter|account|security|confirm|password|code|login|otp)$/i.test(s))return null;
  return s;
}

export function inspectVerification(row={}) {
  const subject=clean(row.subject),body=clean(row.text_body || row.textBody);
  const candidates=new Set();let markers=0;
  if(META.test(subject))return {version:VERIFICATION_REV,state:'unknown',code:null,otp_only:false,reason:'explanation_not_token_delivery'};
  const auth=AUTH_ACTION.test(subject+'\n'+body);
  for(const text of [subject,body]){
    const lines=text.split('\n');
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(/^\s*>/.test(line))continue;
      const mentions=[...line.matchAll(MARKER)];
      if(MARKER_TEST.test(subject+'\n'+lines.slice(Math.max(0,i-5),i).join('\n').slice(-400)))mentions.push(...line.matchAll(REFERENCE));
      if(auth && !META.test(line))mentions.push(...line.matchAll(/\bcode\b(?=\s*(?:is\s*)?[:：=\[])/gi));
      for(const m of mentions){
        markers++;
        if(META.test(line))continue;
        const tail=line.slice(m.index+m[0].length);
        const direct=DIRECT.exec(tail) || INSTRUCTION.exec(tail) || INPUT.exec(tail) || LOCAL_ACTION.exec(tail),reverse=REVERSE.exec(line.slice(0,m.index));
        if(direct){const linked=/(?:[:：=\[【]|是|为)/.test(direct[0].slice(0,-direct[1].length));const v=token(direct[1],linked,auth);if(v)candidates.add(v);}
        if(reverse){const v=token(reverse[1],false,auth);if(v)candidates.add(v);}
        let previous=i-1;while(previous>=0 && !lines[previous].trim())previous--;
        if(previous>=0 && /(?:输入|enter|use).{0,30}(?:验证码|verification code|this code)/i.test(line)){
          const value=LINE_TOKEN.exec(lines[previous]);if(value){const v=token(value[1],true,auth);if(v)candidates.add(v);}
        }
        // MIME/HTML layout commonly places a labelled code on the next
        // nonempty line. Never skip an intervening sentence, ID or location.
        let next=i+1;while(next<lines.length && !lines[next].trim())next++;
        if(next<lines.length && next-i<=12){
          const value=LINE_TOKEN.exec(lines[next]) || VALUE_WITH_PURPOSE.exec(lines[next]);
          if(value){const v=token(value[1],true,auth);if(v)candidates.add(v);}
        }
      }
    }
  }
  if(candidates.size!==1)return {version:VERIFICATION_REV,state:markers?'unknown':'absent',code:null,otp_only:false,
    reason:candidates.size>1?'conflicting_tokens':markers?'no_linked_token':'no_token_evidence'};
  const code=[...candidates][0];
  return {version:VERIFICATION_REV,state:'confirmed',code,otp_only:!ALERT.test(subject),reason:'linked_authentication_token'};
}

export function confirmedVerification(value) {
  return value?.version===VERIFICATION_REV && value.state==='confirmed'
    && typeof value.otp_only==='boolean' && !!token(value.code,true,true);
}
