// MailHub owns the result. Consumers project it; they never reinterpret a
// sender, an old topic bucket or a model's boolean as permission to silence mail.
import { inspectVerification, confirmedVerification } from './mail-verification.js';
export const LABEL_REV = 1;
export const CONTENT_CATEGORIES = ['验证码','账单','订阅续费','账户安全','物流','工作','社交','通知','政务银行','医疗健康','游戏娱乐','服务器运维','技术资讯','其他'];
const PROMO = /促销|打折|折扣|抢购|特卖|限时(?:优惠|特惠)|优惠(?:券|活动|促销)|新品(?:上市|发售)|\bsale\b|\d+\s*%\s*(?:off|discount)|half price|launch offer|coupon/i;
const SECURITY = /安全(?:警报|提醒|风险)|异常登录|异地登录|新.{0,8}(?:SSH|密钥)|new.{0,20}(?:ssh key|public key|sign.in|login)|password (?:changed|reset)|security alert|密码(?:修改|重置)|two.factor.*(?:enabled|disabled)|(?:账户|账号).{0,12}(?:安全|登录|注销|数据)|验证电子邮件|verify (?:your )?email|紧急.{0,8}(?:管理|存储)/i;
const TRANSACTION = /退款(?:成功|已|完成|申请|正在)|refund (?:processed|received|approved|request)|感谢您.{0,16}购买|thank you for your .{0,24}purchase|购买(?:成功|完成|发生错误)|订单(?:确认|摘要)|order (?:confirmation|summary)|processing your order|receipt|收据|付款(?:失败|成功|完成)|payment (?:failed|due|received)|扣款|欠费|还款|账单|发票|invoice|月度消费报告|每日信用管家/i;
const COMPLETED = /退款.*(?:成功|完成|已)|refund (?:processed|received|approved)|感谢您.{0,16}购买|thank you for your .{0,24}purchase|购买(?:成功|完成)|付款(?:已)?(?:成功|完成)|payment received|扣款成功|receipt|收据|已续订|已续期|订阅已确认|会员开通通知|renewed|payment confirmation/i;
const OPS = /monitor is (?:down|up)|\b(?:CPU|VPS|D1|KV|R2)\b.{0,25}(?:alert|quota|usage|限额|告警|操作限制)|宕机|恢复通知|服务.{0,12}(?:中断|恢复)|额度(?:达到|告警)|资源包.*到期|spend cap applied|monthly uptime report|\b(?:ticket id|abuse complaint|maintenance notice)\b/i;
const TECH = /\b(?:claude|chatgpt|openai|gemini|antigravity|notion|backblaze|nvidia|mcp|cloudflare|termius|railway|devpost|adobe)\b/i;
const TECH_CONTENT = /安全.*更新|security.*(?:update|fix)|(?:开发工具|AI 工具|人工智能|硬盘|存储|模型|生成图片|api|sdk)|\b(?:developer|release notes|changelog|reliability|vulnerability|drive stats|hard drive|(?:data|cloud|object) storage|model|coding|terminal|projects|webhooks|template|pdf|planner|workers|launches)\b/i;
const GAME = /\b(?:steam|stardock|star citizen|netflix|xbox|playstation|rockstar|epic games)\b|游戏|影视|音乐/i;
const WORK = /面试|录用|入职|岗位|合同|签署|\b(?:interview|job offer|offer letter)\b/i;
const LOGISTICS = /发货|物流|快递|已送达|\b(?:shipped|shipment|delivery|tracking number|gift card has been sent)\b/i;
const RENEWAL = /订阅.*(?:续费|到期|确认)|会员.*(?:到期|通知)|续订|续期|\b(?:subscription|renewal|renewed)\b/i;
const SOCIAL = /新对象|匹配成功|成为好友|给你发了消息|粉丝的推荐|\b(?:new match|friend request accepted)\b/i;
const KNOWN_TAGS = new Set(['营销','安全提醒','交易回执','订阅更新','服务告警','验证码','技术更新','待核对']);
const iso = (s) => { let text=String(s || '').replace(' ','T'); if(!/(?:Z|[+-]\d\d:\d\d)$/i.test(text))text+='Z'; const n=Date.parse(text); return Number.isFinite(n)?n:null; };

// Clean only the classifier's view, before its length budget is applied. Keep
// the stored original and notification body intact. Tracking URLs and invisible
// preheader padding must not evict readable paragraphs from the model input.
export function mailSemanticText(value) {
  return String(value || '').slice(0,100000)
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/https?:\/\/[^\s<>]+/gi,' ')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,dec)=>{
      const n=parseInt(hex || dec,hex?16:10);return n<=0x10ffff?String.fromCodePoint(n):' ';
    }).replace(/&nbsp;|&zwnj;|&zwj;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/<[^>]{1,1000}>/g,' ').replace(/[\p{Cf}\u034f\ufe00-\ufe0f]/gu,'')
    .replace(/[\t\p{Zs}]+/gu,' ').replace(/(?:\r?\n[ \t]*){3,}/g,'\n\n').trim();
}
const CONDITIONAL = /如果|如要|若|if you|if this|if .*wasn.t you|如非本人|不是您|unsubscribe|退订|查看.*浏览器|view .*browser|如需帮助|need (?:help|assistance)/i;
const NEGATED = /请(?:勿|不要|无需)|无需(?:回复|采取|任何)|不(?:要|必)(?:回复|确认)|(?:do not|don.t|no need to|not necessary to)\s*(?:reply|respond|pay|confirm|verify)|cannot (?:receive|accept) replies|无法接收回复|要回复此(?:短信|消息)|如要回复/i;
// Split clauses first so a conditional help footer cannot erase a separate real
// request in the same paragraph; negation can never become a positive action.
export function actionableText(row) {
  return mailSemanticText(`${row.subject || ''}\n${row.text_body || row.textBody || ''}`).slice(0,12000).split(/\n|(?<=[。！？!?；;])|(?<=\.)\s+/)
    .filter(s=>!CONDITIONAL.test(s) && !NEGATED.test(s))
    .join('\n');
}
function explicitAction(row) {
  const text=actionableText(row);
  const rules=[['付款',/请.{0,10}(?:支付|付款|还款|缴费)|(?:payment|balance) (?:is )?due|payment failed|付款失败|欠费|逾期/i],
    ['回复',/请.{0,10}(?:回复|答复)|please (?:reply|respond)|reply (?:by|before)/i],
    ['确认',/请.{0,10}(?:确认|签署|提交|验证|采取行动)|please (?:confirm|sign|submit|verify)|action required|需要您.{0,8}(?:确认|处理)/i]];
  for(const [kind,re] of rules) if(re.test(text))return {kind,evidence:`explicit_${kind}`,expires_at:null};
  return {kind:'无',evidence:'no_explicit_request',expires_at:null};
}
// All non-OTP mail gets one semantic call for three independent decisions.
// Topic rules provide hints for unavailable/legacy results, not completion.
export const DECISION_REV = 2;
export function mailModelView(row={}) {
  const full=mailSemanticText(row.text_body || row.textBody);
  return {body:full.length<=6000?full:full.slice(0,4500)+'\n[中段省略]\n'+full.slice(-1500),complete:full.length<=6000};
}
const judgment=(state,source,evidence)=>({state,source,evidence});
function quotedClause(row,quote) {
  const text=mailSemanticText(`${row.subject || ''}\n${row.text_body || row.textBody || ''}`);
  const q=quote.replace(/\s+/g,' ').trim();
  if(q.length<3 || q.length>160)return null;
  // Match exact words, allowing MIME wrapping. Extract only the enclosing
  // request, not an unrelated conditional footer elsewhere in the mail.
  const escaped=q.split(' ').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+');
  const match=new RegExp(escaped).exec(text);if(!match)return null;
  const boundary=/\n\s*\n|[。！？!?；;]|\.\s/g;
  const before=text.slice(0,match.index),after=text.slice(match.index+match[0].length);
  let start=0;for(const b of before.matchAll(boundary))start=b.index+b[0].length;
  const end=/[。！？!?；;.]$/.test(match[0].trim())?0:after.search(boundary);
  return text.slice(start,match.index+match[0].length+(end<0?after.length:end)).replace(/\s+/g,' ').trim();
}
export function buildMailLabels(row={}, {model=null, legacy=false, failed=false}={}) {
  const subject=mailSemanticText(row.subject), body=mailSemanticText(row.text_body || row.textBody).slice(0,12000);
  const combined=subject+'\n'+mailSemanticText(row.from_name || row.fromName)+'\n'+body;
  let category=CONTENT_CATEGORIES.includes(model?.category)?model.category:
    CONTENT_CATEGORIES.includes(row.ai_category)?row.ai_category:'其他';
  let source=model?'model':legacy && row.ai_category?'legacy':'rules';
  const tags=[], evidence=[];let protectedMail=false;
  const set=(c,tag,key)=>{category=c;if(tag)tags.push(tag);evidence.push(key);source='rules';};
  const verification=inspectVerification(row);
  const codeEvidence=verification.state==='confirmed' && verification.otp_only;
  // A model/old topic is not evidence of an OTP. Otherwise an important alert
  // can inherit the 30-minute expiry and be silently dropped on delayed delivery.
  const unsupportedCode=category==='验证码' && !codeEvidence;
  if(unsupportedCode){category='其他';source='rules';evidence.push('unproven_code_rejected');}
  if(verification.state==='confirmed')tags.push('验证码');
  if(codeEvidence)set('验证码','验证码','explicit_code');
  else if(SECURITY.test(subject)){set('账户安全','安全提醒','subject_security');protectedMail=true;}
  else if(LOGISTICS.test(subject)){set('物流',/gift card has been sent/i.test(subject)?'交易回执':null,'subject_delivery');protectedMail=true;}
  else if(TRANSACTION.test(subject)){set(RENEWAL.test(subject)?'订阅续费':'账单',COMPLETED.test(subject+'\n'+body)?'交易回执':null,'subject_transaction');protectedMail=true;}
  else if(OPS.test(subject)){set('服务器运维','服务告警','subject_ops');protectedMail=true;}
  else if(/(?:passing|reached).{0,25}pageviews|访问量.{0,12}(?:达到|报告)/i.test(subject)){set('通知',null,'own_usage_report');protectedMail=true;}
  else if(WORK.test(subject)){set('工作',null,'subject_work_request');protectedMail=true;}
  else if(RENEWAL.test(subject) && !PROMO.test(subject)){set('订阅续费',COMPLETED.test(subject+'\n'+body)?'交易回执':'订阅更新','subject_subscription');protectedMail=true;}
  else if(SOCIAL.test(subject))set('社交',null,'subject_social_event');
  else if(/hackathons?/i.test(subject) && /devops|machine learning|web|code|developer/i.test(body))set('技术资讯','技术更新','developer_events');
  else if(/\bVPS\b/i.test(subject) && /\b(?:servers?|RAM|KVM)\b/i.test(body))set('服务器运维',null,'hosting_content');
  else if(TECH.test(combined) && TECH_CONTENT.test(combined))set('技术资讯','技术更新','technology_content');
  else if(GAME.test(combined))set('游戏娱乐',null,'entertainment_content');
  // Topic and promotional nature are orthogonal. Domain/footer alone and an
  // old AI category can never confirm marketing. Protect concrete requests.
  const taskReport=/^\[Task Update\]/i.test(subject);
  const safetyEvent=SECURITY.test(subject) || OPS.test(subject) || (TRANSACTION.test(subject) && COMPLETED.test(subject+'\n'+body));
  // Confirm the main purpose, not the presence of a brand, unsubscribe footer,
  // music example or secondary coupon. These are evidence-bearing solicitations.
  const primaryPromotion=/this is a marketing email/i.test(body) ||
    (/sponsored by/i.test(body) && /subscribe for free|join \d+[mM+]/i.test(body)) ||
    (/\b(?:template|planner|classroom)\b/i.test(subject+'\n'+body.slice(0,1800)) && /get (?:started for free|the .{0,60}planner)|premium .{0,30}templates/i.test(body)) ||
    (/邀请您参与.{0,20}(?:特别直播|新品发布)/.test(body) && /下载.{0,20}App/i.test(body)) ||
    (/concert|afterparty/i.test(body) && /conference pass/i.test(body) && /register now/i.test(body));
  if(!protectedMail && category!=='验证码' && !taskReport && (PROMO.test(subject) || primaryPromotion ||
      (/VPS/i.test(subject) && PROMO.test(body.slice(0,1500))))){
    evidence.push('subject_promotion');
    if(primaryPromotion)evidence.push('primary_product_solicitation');
    if(/sponsored by/i.test(body) && /subscribe for free/i.test(body))category='通知';
    if(/concert|afterparty/i.test(body) && /conference pass/i.test(body))category='游戏娱乐';
  }

  const candidateCategory=category;
  const defaultState=failed?'unknown':legacy?'inherited':'pending';
  const dimensions={
    category:judgment(defaultState,source,evidence[0] || 'topic_not_judged'),
    nature:judgment(defaultState,source,'nature_not_judged'),
    action:judgment(defaultState,source,'action_not_judged'),
  };
  let action={kind:'无',evidence:'action_not_judged',expires_at:null};
  let marketing=false;
  if(codeEvidence) {
    const at=iso(row.received_at || row.receivedAt || row.created_at);
    category='验证码';
    action={kind:'验证码',evidence:'explicit_code',expires_at:at===null?null:new Date(at+1800000).toISOString()};
    for(const key of Object.keys(dimensions))dimensions[key]=judgment('known','rules','explicit_code');
  } else if(model) {
    // A topic dictionary cannot override a semantic category just because a
    // brand, music example or receipt keyword occurred in the mail.
    const view=mailModelView(row);
    category=CONTENT_CATEGORIES.includes(model.category) && model.category!=='验证码'?model.category:'其他';
    dimensions.category=judgment(!CONTENT_CATEGORIES.includes(model.category) || model.category==='验证码'?'unknown':'known','model',
      model.category==='验证码'?'unproven_code_rejected':'semantic_topic');
    const quote=mailSemanticText(model.nature_evidence);
    const clause=quotedClause(row,quote);
    // Marketing means the main purpose is solicitation. Footer-only evidence,
    // a truncated view or an actual personal request cannot silence mail.
    const footer=clause && /unsubscribe|退订|隐私政策|privacy policy|view .*browser/i.test(clause);
    if(model.nature==='普通' && body && view.complete)dimensions.nature=judgment('known','model','ordinary_main_purpose');
    else if(model.nature==='营销' && clause && !footer && view.complete && !safetyEvent && !taskReport){
      marketing=true;dimensions.nature=judgment('known','model',quote);evidence.push('quoted_primary_promotion');
    } else dimensions.nature=judgment('unknown','model',model.nature==='营销'?'marketing_proof_rejected':'nature_uncertain');
    const request=mailSemanticText(model.action_evidence);
    const requestClause=quotedClause(row,request);
    if(['付款','回复','确认'].includes(model.action) && requestClause && !NEGATED.test(requestClause) && !CONDITIONAL.test(requestClause)){
      action={kind:model.action,evidence:request,expires_at:null};
      dimensions.action=judgment('known','model',request);
      // A direct recipient obligation wins over marketing. Never silence it.
      if(marketing){marketing=false;dimensions.nature=judgment('unknown','model','request_conflicts_with_marketing');}
    } else if(model.action==='无' && body && view.complete){
      action.evidence='semantic_no_request';dimensions.action=judgment('known','model','semantic_no_request');
    } else dimensions.action=judgment('unknown','model',model.action==='无'?'incomplete_mail':'request_proof_rejected');
    source='model';
  } else if(legacy) {
    // Legacy evidence stays explicitly inherited; its topic cannot complete
    // the two dimensions that the old classifier never evaluated.
    action=explicitAction(row);
    if(tags.includes('交易回执'))action={kind:'无',evidence:'legacy_completed_receipt',expires_at:null};
    if(evidence.includes('subject_promotion') && !protectedMail && !taskReport){
      marketing=true;tags.push('营销');dimensions.nature=judgment('known','rules','subject_promotion');
      action={kind:'无',evidence:'legacy_promotion',expires_at:null};
    }
  }
  // Old topic hints are not semantic evidence and cannot carry topic tags
  // across an independently judged different category.
  if(model && category!==candidateCategory){
    for(let i=tags.length-1;i>=0;i--)if(['技术更新','服务告警','安全提醒','交易回执','订阅更新'].includes(tags[i]))tags.splice(i,1);
  }
  if(marketing && dimensions.action.state!=='known'){marketing=false;dimensions.nature=judgment('unknown','model','action_unresolved');}
  if(marketing)tags.push('营销');
  else {const i=tags.indexOf('营销');if(i!==-1)tags.splice(i,1);}
  const pending=Object.values(dimensions).some(d=>d.state==='pending');
  const known=Object.values(dimensions).every(d=>d.state==='known');
  const state=known?'ready':pending?'pending':legacy?'inherited':'fallback';
  if(!known)tags.push('待核对');
  return {version:LABEL_REV,decision_rev:DECISION_REV,verification,category,tags:[...new Set(tags)],action,state,source,dimensions,
    evidence:[...new Set([...evidence,...Object.values(dimensions).map(d=>d.evidence)])],
    marketing_confirmed:marketing,needs_model:pending};
}
export function parseMailLabels(row) {
  try {
    const l=typeof row.labels_json==='string'?JSON.parse(row.labels_json):row.labels;
    if(l?.version!==LABEL_REV || !CONTENT_CATEGORIES.includes(l.category) || !Array.isArray(l.tags)
      || !l.tags.every(t=>KNOWN_TAGS.has(t)) || !['ready','pending','fallback','inherited'].includes(l.state)
      || !l.action || !['无','验证码','付款','回复','确认'].includes(l.action.kind))return null;
    if(l.decision_rev!==undefined && l.decision_rev!==DECISION_REV)return null;
    if((l.category==='验证码' || l.action.kind==='验证码') &&
      (!confirmedVerification(l.verification) || !l.verification.otp_only))return null;
    if(l.decision_rev===DECISION_REV){
      if(!l.dimensions || !['category','nature','action'].every(k=>['known','pending','unknown','inherited'].includes(l.dimensions[k]?.state)))return null;
      if(l.state==='ready' && !Object.values(l.dimensions).every(d=>d.state==='known'))return null;
      if(l.marketing_confirmed && (l.dimensions.nature.state!=='known' || l.dimensions.action.state!=='known' || l.action.kind!=='无'))return null;
    }
    return l;
  }catch{return null;}
}
export function labelsForNotice(row) {
  return parseMailLabels(row) || buildMailLabels(row,{legacy:true});
}
export function actionNeeded(labels,now=Date.now()) {
  if(labels.action.kind==='无')return 0;
  if(labels.action.kind==='验证码')return labels.action.expires_at && now<=Date.parse(labels.action.expires_at)?1:0;
  return 1;
}
export function labelProjection(labels,row={}) {
  // Do not let a model summary turn a conditional footer into a task. Keep
  // notification text raw; the concise summary is only a list/detail aid.
  const summary=labels.category==='验证码'?'验证码来信；无需回复。':
    String(row.ai_summary || row.summary || row.subject || '').trim().slice(0,120);
  return {category:labels.category,summary,action:actionNeeded(labels)};
}
