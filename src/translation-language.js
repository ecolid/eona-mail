// Detect prose in all scripts used by the reader and pretranslation worker.
// Keep the same function browser-serializable as part of the Mail reader.
export function hasForeignProse(value) {
 const source=String(value||'').replace(/[\p{Cf}\uFE00-\uFE0F]/gu,'')
  .replace(/(?:https?:\/\/|mailto:)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:[a-z\d-]+\.)+[a-z]{2,}\b/gi,' ')
  .replace(/\b[A-Za-z\d+/_=%-]{48,}\b/g,' ');
 for(const line of source.split(/[\r\n。！？；]+/u)){
  const trimmed=line.trim();
  if(!trimmed||/^(?:[A-Z\d_]+[-:]){2,}[A-Z\d_-]+$/u.test(trimmed))continue;
  if(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(trimmed))return true;
  const words=trimmed.replace(/\p{Script=Han}/gu,' ').match(/\p{L}[\p{L}\p{M}'’-]*/gu)||[];
  const count=words.reduce((n,word)=>n+(word.match(/\p{L}/gu)||[]).length,0);
  if(count<2)continue;
  const han=(trimmed.match(/\p{Script=Han}/gu)||[]).length;
  if(han===0||count>=han||words.length>=3||words.some(word=>/[^\p{Script=Latin}\p{M}'’-]/u.test(word)&&word.length>=3))return true;
 }
 return false;
}

// Isolated product names or notification footers in a Chinese mail do not
// make it a foreign-language mail. Preserve non-Latin and mixed prose.
export function needsMailTranslation(subject,body){
 const lines=String(body||'').split(/\r?\n/).map(value=>value.trim()).filter(value=>
  value&&!/^(?:unsubscribe|view (?:this email )?in (?:your )?browser|privacy policy|all rights reserved|powered by|©|\bcopyright\b)/i.test(value)
 );
 const content=[String(subject||'').replace(/^(?:(?:re|fw|fwd):\s*)+/i,''),...lines].join('\n')
  .replace(/(?:https?:\/\/|mailto:)\S+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[A-Za-z\d+/_=%-]{48,}\b/gi,' ');
 if(!hasForeignProse(content))return false;
 if((content.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)||[]).length>=2)return true;
 const han=(content.match(/\p{Script=Han}/gu)||[]).length;
 const nonHan=(content.replace(/\p{Script=Han}/gu,'').match(/\p{L}/gu)||[]).length;
 return han<12||nonHan>=han*.65||
  /(?:\p{Script=Latin}{2,}[ ,.:;'"()/-]+){4}\p{Script=Latin}{2,}/u.test(content)||
  /\p{Script=Cyrillic}{8,}|\p{Script=Arabic}{8,}|\p{Script=Devanagari}{8,}/u.test(content);
}

// Names, brands, identifiers and address fragments can be identical in the
// translation. They must not turn a successfully translated mail into a retry.
export function isTranslationLiteral(value,source=value){
 const original=String(source||'').normalize('NFKC').replace(/\p{Cf}/gu,'').trim();
 if(/^@?[a-z\d][a-z\d._-]+\/[a-z\d][a-z\d._-]+$/i.test(original)||
    /^[a-z\d]+(?:_[a-z\d.]+)+$/i.test(original)||
    /^[a-z][a-z\d]*-[a-z.]*\d[a-z\d.-]*$/i.test(original)||
    /^(?:Mozilla|Opera)\/\d[\s\S]+\b(?:Chrome|Safari|Firefox|Edg)\/\d/i.test(original)||
    /^\p{Script=Han}{1,16}\s*[:：]\s*[a-z]+(?:[_.-][a-z\d]+)+$/iu.test(original))return true;
 const text=String(value||'').normalize('NFKC').replace(/\p{Cf}/gu,'').trim();
 if(!text||/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text))return !text;
 const withoutHan=text.replace(/\p{Script=Han}/gu,' ');
 const words=withoutHan.match(/\p{L}[\p{L}\p{M}\p{N}'’-]*/gu)||[];
 if(!words.length||words.length>8&&(!/\p{Script=Han}/u.test(text)||new Set(words).size>8))return false;
 if(words.some(word=>!/\p{Script=Latin}/u.test(word)))return false;
 if(/\b(?:hello|thanks|thank|welcome|dear|best|regards|cheers|attention|notice|alert|action|update|updates|confirm|confirmation|verify|verification|success|successful|failed|delivered|shipped|shipping|receipt|invoice|payment|order|renewal|reminder|status|important|review|required|read|reply|unsubscribe|view|subscribe|click|open|download|cancel|settings|here|please|free|new|your|you|this|is|no|not|with|now|expires?|today|tomorrow|sign|report|version|password|login|price|code|first|second)\b/i.test(withoutHan))return false;
 return words.every(word=>/\p{Lu}|^[ivxlcdm]+$/u.test(word)||/^(?:of|the|de|van|von|da|del|and|&|la|le|et|at|v\d+)$/i.test(word));
}
