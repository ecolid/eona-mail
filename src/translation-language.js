// Detect prose in all scripts used by the reader and pretranslation worker.
// Keep the same function browser-serializable as part of the Mail reader.
export function hasForeignProse(value) {
 const source=String(value||'').replace(/[\p{Cf}\uFE00-\uFE0F]/gu,'')
  .replace(/(?:https?:\/\/|mailto:)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:[a-z\d-]+\.)+[a-z]{2,}\b/gi,' ')
  .replace(/\b(?:Windows Hello|Hello Kitty)\b/gi,' ')
  .replace(/\b[A-Za-z\d+/_=%-]{48,}\b/g,' ');
 for(const line of source.split(/[\r\n。！？；]+/u)){
  const trimmed=line.trim();
  if(!trimmed||/^(?:[A-Z\d_]+[-:]){2,}[A-Z\d_-]+$/u.test(trimmed))continue;
  const damaged=(trimmed.match(/\uFFFD/gu)||[]).length;
  if(damaged>=2&&damaged>=trimmed.replace(/\s/gu,'').length*.08)continue;
  if(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(trimmed))return true;
  const words=trimmed.replace(/\p{Script=Han}/gu,' ').match(/\p{L}[\p{L}\p{M}'’-]*/gu)||[];
  const count=words.reduce((n,word)=>n+(word.match(/\p{L}/gu)||[]).length,0);
  if(count<2)continue;
  const han=(trimmed.match(/\p{Script=Han}/gu)||[]).length;
  if(han===0)return true;
  // Evaluate each phrase on its own. Chinese sentences can include names
  // and identifiers spread across several phrases.
  for(const phrase of trimmed.split(/[\p{Script=Han}，、：；]+/u)){
   const parts=phrase.match(/\p{L}[\p{L}\p{M}'’-]*/gu)||[];
   if(!parts.length)continue;
   if(/[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}]{3,}/u.test(phrase))return true;
   if(/\b(?:hello|goodbye|thanks|welcome|unsubscribe)\b/i.test(phrase))return true;
   if(parts.length<2)continue;
   if(/\b(?:please|you|your|this|these|is|are|was|were|has|have|will|would|can|could|should|received|required|shipped|failed|succeeded|payment|invoice|delivery|verify|confirm|task update|ouvrez|votre|veuillez|su|usted|por favor|seu|sua|bitte|ihre|vielen dank)\b/i.test(phrase))return true;
   if(parts.length>=4&&parts.filter(word=>/^\p{Ll}{2,}$/u.test(word)).length>=3)return true;
  }
 }
 return false;
}

// Isolated product names or notification footers in a Chinese mail do not
// make it a foreign-language mail. Preserve non-Latin and mixed prose.
export function needsMailTranslation(subject,body){
 const lines=[String(subject||'').replace(/^(?:(?:re|fw|fwd):\s*)+/i,''),...String(body||'').split(/\r?\n/)];
 const content=lines.map(value=>value.trim()).filter((value,i)=>
  value&&(i===0||!/^(?:unsubscribe|view (?:this email )?in (?:your )?browser|privacy policy|all rights reserved|powered by|©|\bcopyright\b)/i.test(value))
 ).join('\n').replace(/(?:https?:\/\/|mailto:)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[A-Za-z\d+/_=%-]{48,}\b/gi,' ');
 const han=(content.match(/\p{Script=Han}/gu)||[]).length;
 const phrases=content.split(/[\r\n。！？；]+/u).filter(value=>hasForeignProse(value)&&!isTranslationLiteral(value));
 if(!phrases.length)return false;
 const foreign=phrases.join('\n');
 if(han<12||/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]{2,}/u.test(foreign))return true;
 const substantial=phrases.filter(value=>{
  if(/\p{Script=Han}/u.test(value))return true;
  if(/[\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Thai}]{3,}/u.test(value))return true;
  const words=value.match(/\p{L}[\p{L}\p{M}'’-]*/gu)||[];
  return words.length>=4&&words.filter(word=>/^\p{Ll}{2,}$/u.test(word)).length>=2||
   /\b(?:hello|welcome|thanks|please|you|your|payment|invoice|verify|confirm|task update|unsubscribe)\b/i.test(value);
 });
 return substantial.length>0;
}

// Names, brands, identifiers and address fragments can be identical in the
// translation. They must not turn a successfully translated mail into a retry.
export function isTranslationLiteral(value,source=value){
 const original=String(source||'').normalize('NFKC').replace(/\p{Cf}/gu,'').trim();
 const field=original.replace(/^[:：#]\s*/u,'').replace(/^["'`]+|["'`]+$/gu,'').trim();
 if(/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(field)||
    /^(?:[a-z\d-]+\.)+[a-z]{2,}\/[a-z\d_~./\-\u2011]+$/iu.test(field)||
    /^\{[a-z_][a-z\d_.-]*\}$/i.test(field)||
    /^ref:[a-z\d.!_-]+:ref$/i.test(field)||
    /^(?:[A-Za-z]{2,12}\s+)?[A-Z]{2,4}\d+:[\w_-]+(?:\([\w_-]+\))?(?::[a-z\d_-]*)+$/u.test(field)||
    /^"[a-z_][a-z\d_]*"\s*:\s*"[^\r\n]*"\s*,?$/i.test(original)||
    /^(?:\d[\w-]*\s+)?rue\s+[\p{L} .'-]{3,70},\s*\d{4,6}\s+\p{L}[\p{L} .'-]+$/iu.test(field)||
    /^(?:>>?)?\s*(?:\.{1,2}\/|~\/|\/)[a-z\d_./~-]+(?:\s+(?:--?[\w-]+|\/\S+))*$/i.test(field)||
    /^(?:curl|chmod|chattr|wget|sh|bash|netlify)\s+(?:-\S+|\/\S+|\$[A-Z_]+|dev$)/u.test(field)||
    /^[a-z][a-z\d]+(?:-[a-z\d]+){2,}$/iu.test(field)&&/\d/.test(field)||
    /^@?[a-z\d][a-z\d._-]+\/[a-z\d][a-z\d._-]+$/i.test(original)||
    /^\/\s*[a-z\d_.-]+(?:\/[a-z\d_.-]+)*\/?$/i.test(original)||
    /^(?:[\da-f]{0,4}:){2,8}[\da-f]{0,4}(?:%[a-z\d_.-]+)?$/i.test(original)||
    /^(?:ref:[a-z\d]+:ref|(?:[a-z]{2,5}[a-z\d_-]*[:.])?\d{7,}[a-z\d_.:-]*)$/i.test(original)||
    /^\[(?:math|latex)\][\s\S]+\[\/(?:math|latex)\]$/i.test(original)||
    /^(?:timeout\s+\d+(?:\.\d+)?\s+)?(?:npm\s+(?:i|install|run|exec)\s|npx\s|bash\s+-c\s|pip(?:3)?\s+install\s|git\s+(?:clone|fetch|pull|push|checkout|switch)\s)\S[\s\S]*$/u.test(original)||
    /^[a-z_][\w.]*\s*=\s*(?:[a-z_][\w.]*\s*\([^\r\n]*|["'][^\r\n]*["'])$/i.test(original)||
    /^(?=[^\s]*\d)(?:[A-Z0-9]{2,}-){2,}[A-Z0-9]{2,}$/u.test(original)||
    /^(?=[^\s]*\d)(?=[^\s]*[_:=])[A-Z0-9:/+=._-]{8,}$/i.test(original)||
    /^(?:UID|GUID|SKU|VPS)\s*:\s*[a-z\d][a-z\d._-]{1,63}$/i.test(original)||
    /^[\w.-]{2,40}\s*\(\d{3,}\)$/u.test(original)||
    /^(?:[A-Za-z]{2,12}\s+)?[A-Z]{2,4}\d+:[\w_-]+(?:\([\w_-]+\))?(?::[a-z\d_-]+)+$/u.test(original)||
    /^©\s*\d{4}\s+[^\r\n]+\b(?:LLC|Inc\.|Ltd\.|GmbH)\b[^\r\n]*\b(?:Street|St|Road|Rd|Drive|Dr|Blvd|Boulevard|Avenue|Ave)\b/i.test(original)||
    /^(?:VS Code|Visual Studio Code|Claude Code)$/i.test(original)||
    /^[a-z\d]+(?:_[a-z\d.]+)+$/i.test(original)||
    /^[a-z][a-z\d]*-[a-z.]*\d[a-z\d.-]*$/i.test(original)||
    /^(?:Mozilla|Opera)\/\d[\s\S]+\b(?:Chrome|Safari|Firefox|Edg)\/\d/i.test(original)||
    /^\p{Script=Han}{1,16}\s*[:：]\s*[a-z]+(?:[_.-][a-z\d]+)+$/iu.test(original))return true;
 const text=String(value||'').normalize('NFKC').replace(/\p{Cf}/gu,'').trim();
 if(!text||/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text))return !text;
 if(/(?:^|[,·・])\s*\d{1,6}[\w-]*\s+[\p{L}\p{N} .’'-]{1,95}\s+(?:street|st|road|rd|drive|dr|parkway|pkwy|avenue|ave|boulevard|blvd|lane|ln|way|place|pl)\.?(?:\s*(?:[,·・]|$))/iu.test(original)&&
    !/\b(?:please|your|you|we|received|delivery|shipped|mail to|send to)\b/i.test(original))return true;
 const withoutHan=text.replace(/\p{Script=Han}/gu,' ').replace(/\bs\s*\.\s*r\s*\.\s*o\s*\.|\bb\s*\.\s*v\s*\./gi,' ');
 const words=withoutHan.match(/\p{L}[\p{L}\p{M}\p{N}'’-]*/gu)||[];
 if(!words.length||words.length>8&&(!/\p{Script=Han}/u.test(text)||new Set(words).size>8))return false;
 if(words.some(word=>!/\p{Script=Latin}/u.test(word)))return false;
 if(/\b(?:hello|thanks|thank|welcome|dear|best|regards|cheers|attention|notice|alert|action|update|updates|confirm|confirmation|verify|verification|success|successful|failed|delivered|shipped|shipping|receipt|invoice|payment|order|renewal|reminder|status|important|review|required|read|reply|unsubscribe|view|subscribe|click|open|download|cancel|settings|here|please|free|new|your|you|this|is|no|not|with|now|expires?|today|tomorrow|sign|report|version|password|login|price|code|first|second)\b/i.test(withoutHan))return false;
 return words.every(word=>/\p{Lu}|^[ivxlcdm]+$/u.test(word)||/^(?:of|the|de|van|von|da|del|and|&|la|le|et|at|mini|pro|max|ultra|v\d+)$/i.test(word));
}
