import {hasForeignProse} from './translation-language.js';
import {validateTranslationResult} from './translation-inline.js';

export function splitParagraphs(text) {
 return String(text||'').replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(value=>value.trim()).filter(Boolean);
}

// A legacy result is usable only for the exact archived source. A truncated
// result still needs backfill. Old engines sometimes regrouped paragraphs.
export function completeLegacyTranslation(row,source){
 if(row?.lang!=='zh'||row.truncated)return null;
 try{
  const paragraphs=JSON.parse(row.paragraphs),translated=JSON.parse(row.translated);
  const original=splitParagraphs(source);
  const canonical=value=>String(value).replace(/[\p{Cf}\uFE00-\uFE0F]/gu,'').replace(/\s+/gu,' ').trim();
  if(!Array.isArray(paragraphs)||!Array.isArray(translated)||!original.length||
     paragraphs.length!==original.length||!translated.length||translated.some(value=>typeof value!=='string'||!value.trim())||
     original.some((value,i)=>canonical(paragraphs[i])!==canonical(value))||!original.some(hasForeignProse))return null;
  const sourceText=original.join('\n\n'),targetText=translated.join('\n\n');
  if(!/\p{Script=Han}/u.test(targetText)||targetText.length<sourceText.length*.08)return null;
  validateTranslationResult(sourceText,targetText);
  return {paragraphs,translated,model:row.model};
 }catch{return null;}
}
