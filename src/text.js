import {hasForeignProse} from './translation-language.js';
// 纯文本转换无外部依赖，可独立运行和测试。


export function htmlToText(html) {
  let t = String(html || '');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/<(script|style|head|noscript)[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<\/t[dh]>\s*(?=<t[dh][\s>])/gi, ': ');
  // 段落使用空行分隔，保留翻译对照的段落边界。
  t = t.replace(/<\/tr>/gi, '\n\n');
  t = t.replace(/<\/(p|div|li|h[1-6]|blockquote|table|section|article)>/gi, '\n\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<[^>]+>/g, ' ');
  const ENTITIES = {
    nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    rarr: '→', larr: '←', mdash: '—', ndash: '–', hellip: '…', middot: '·',
    bull: '·', copy: '©', reg: '®', trade: '™', laquo: '«', raquo: '»',
    times: '×', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢',
  };
  // 数字实体(十进制和十六进制)先解,再解具名的;**不认识的原样留着** ——
  // 换成空格会把 &pound;29 这种价格信息变成「29」,那是**静默改变语义**;
  // 留个 &pound; 至少是「看得出来没处理好」。**能坏得明显,就别让它坏得好看。**
  t = t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  t = t.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  t = t.replace(/&([a-z]+);/gi, (whole, name) => {
    const value = ENTITIES[String(name).toLowerCase()];
    return value === undefined ? whole : value;
  });
  t = t.replace(/[ \t\u00a0]+/g, ' ');
  // 空单元格会留下光秃秃的「: 」(实测他那封 UptimeRobot 的信开头就是),
  // 纯标点的行对翻译和搜索都是噪音,整行丢掉。
  // 丢的是「只剩标点」的行,**不是空行** —— 空行正是段落分隔符,
  // 一起丢掉的话整封信会塌成一大段(09-19 我就是这么把他那封信弄塌的:
  // 译文按空行分段,没有空行就只剩一个巨块,对照视图里左右各一坨)。
  t = t.split('\n')
       .filter((line) => line.trim() === '' || !/^[\s:：|·—-]+$/.test(line))
       .join('\n');
  t = t.replace(/^\s*[:：]\s*/gm, '');
  t = t.replace(/\n\s*\n\s*\n+/g, '\n\n');
  return t.trim().slice(0, 100000);
}

// Retain the old exported threshold for callers of the legacy endpoint.
export const FOREIGN_CJK_RATIO = 0.5;

export function looksForeign(text) {
  return hasForeignProse(text);
}

// 老名字留个别名给判据和外部调用方用。**必须是函数**:这个文件的具名导出只要有非函数,
// workerd 起不来(09-13 撞过一次,判据钉着)。
export function looksEnglish(text) { return looksForeign(text); }

