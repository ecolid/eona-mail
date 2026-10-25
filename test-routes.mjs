import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/index.js", import.meta.url), "utf8");

function extract(name) {
  let start = source.indexOf(`export function ${name}(`);
  if (start === -1) start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到函数 ${name}`);
  let depth = 0, i = source.indexOf("{", start);
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") { depth -= 1; if (depth === 0) break; }
  }
  return source.slice(start, i + 1).replace(/^export\s+/, "");
}
// 不 import src/index.js(顶上 import 了 postal-mime,服务器上没 node_modules),抠源码单独求值
const { originRecipient } = new Function(`${extract("originRecipient")}; return { originRecipient };`)();
const H = (obj) => ({ get: (k) => obj[k.toLowerCase()] || "" });

test("Delivered-To 优先:163 转进来的信认出是寄给 163 子邮箱的", () => {
  const h = H({ "delivered-to": "sub@163.com" });
  const parsed = { to: [{ address: "sub@163.com" }] };
  assert.equal(originRecipient(h, parsed, "sample.163@eona.top"), "sub@163.com");
});

test("没有 Delivered-To 时退到 To: 头", () => {
  const parsed = { to: [{ address: "Me@Gmail.com", name: "me" }] };
  assert.equal(originRecipient(H({}), parsed, "sample.gmail@eona.top"), "me@gmail.com");
});

test("分身地址自己不算原始收件人 —— 直投 eona.top 的信 origin 为空", () => {
  const parsed = { to: [{ address: "sample.163@eona.top" }] };
  assert.equal(originRecipient(H({ "delivered-to": "sample.163@eona.top" }), parsed, "sample.163@eona.top"), null);
});

test("认不出就是 null,不猜", () => {
  assert.equal(originRecipient(H({}), {}, "x@eona.top"), null);
  assert.equal(originRecipient(H({ "delivered-to": "not an address" }), { to: [] }, "x@eona.top"), null);
  assert.equal(originRecipient(null, null, "x@eona.top"), null);
});

test("多个候选取第一个非 eona.top 的;大小写归一", () => {
  const h = H({ "x-original-to": "A@163.com, sample.163@eona.top" });
  assert.equal(originRecipient(h, {}, "sample.163@eona.top"), "a@163.com");
});

test("iCloud 回流的转发目标不能覆盖原始 QQ 收件人", () => {
  const h = H({ 'x-forwarded-to': 'copy@icloud.com', 'x-forwarded-for': 'qq.entry@eona.top copy@icloud.com' });
  assert.equal(originRecipient(h, {to:[{address:'child@qq.com'}]}, 'icloud.return@eona.top'), 'child@qq.com');
});

test("最终 Delivered-To 也不能把回流邮件归到转发目的地", () => {
  const h = H({ 'delivered-to':'copy@icloud.com', 'x-forwarded-to':'copy@icloud.com' });
  assert.equal(originRecipient(h, {to:[{address:'child@qq.com'}]}, 'icloud.return@eona.top'), 'child@qq.com');
});

test("密送依靠投递证据;显式原收件人优先于最终 Delivered-To", () => {
  assert.equal(originRecipient(H({'delivered-to':'bcc@example.com','x-forwarded-to':'copy@icloud.com'}), {}, 'entry@eona.top'), 'bcc@example.com');
  assert.equal(originRecipient(H({'x-original-to':'bcc@example.com','delivered-to':'copy@icloud.com'}), {}, 'entry@eona.top'), 'bcc@example.com');
});

test("无 To 的转发链保留源地址,仅有转发目的地不能猜成来源", () => {
  assert.equal(originRecipient(H({'x-forwarded-for':'source@example.com copy@icloud.com','x-forwarded-to':'copy@icloud.com'}), {}, 'entry@eona.top'), 'source@example.com');
  assert.equal(originRecipient(H({'x-forwarded-to':'copy@icloud.com'}), {}, 'entry@eona.top'), null);
});

test("原信就发给 iCloud 时仍归 iCloud;Cc 保留为后备", () => {
  const h = H({'x-forwarded-to':'copy@icloud.com'});
  assert.equal(originRecipient(h, {to:[{address:'copy@icloud.com'}]}, 'icloud.return@eona.top'), 'copy@icloud.com');
  assert.equal(originRecipient(h, {to:[{address:'entry@eona.top'}],cc:[{address:'child@example.com'}]}, 'entry@eona.top'), 'child@example.com');
});

test("入库真的把 origin_to 写进去了(不是解析了扔掉)", () => {
  assert.match(source, /INSERT INTO emails[\s\S]*origin_to\)/, "INSERT 列表里没有 origin_to");
  // 入站与导入共用 archiveRaw；测试确认原始收件人在写入前解析。
  assert.match(source, /originTo\s*=\s*originRecipient\(\{ get: headerGet \},\s*parsed,/,
    "入库前没调 originRecipient");
});

test("映射表写操作只给浏览器,机器码 403", () => {
  const post = source.slice(source.indexOf("path === '/api/routes' && request.method === 'POST'"));
  assert.match(post.slice(0, 200), /if \(readOnly\) return json\(\{ error: 'forbidden' \}, 403\)/,
    "POST /api/routes 没挡机器码 —— 只读钥匙能改他的映射表");
  const del = source.slice(source.indexOf("path === '/api/routes/delete'"));
  assert.match(del.slice(0, 200), /if \(readOnly\) return json/, "delete 没挡机器码");
});

test("映射视图不内联拼 onclick(交给委托监听)", () => {
  // Settings now owns route editing. Stop at the next list controller even
  // when its signature takes options; never inspect the entire remaining UI.
  const view = source.slice(source.indexOf("async function loadRoutes()"), source.indexOf("async function loadList("));
  assert.ok(!/onclick=/.test(view), "映射视图里有内联 onclick —— 邮箱地址是用户数据");
  assert.match(view,/return loadMailSettings\(\)/);
});

test("邮件列表实际响应保留 message_id，双路去重不依赖 SQL 字符串所在文件", async () => {
  const {SQLiteD1}=await import('./sv/storage.mjs'),{fetchWithIdentity}=await import('./src/index.js');
  const db=new SQLiteD1(':memory:');db.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  try{
    db.db.prepare("INSERT INTO emails(message_id,alias,from_addr,subject,received_at) VALUES('<dedup-proof@example.test>','owner@example.test','sender@example.test','Subject','2026-10-21 00:00:00')").run();
    const response=await fetchWithIdentity(new Request('https://mail.eona.top/api/emails'),{MAILDB:db},{authenticated:true,subject:'fixture',email:'owner@example.test'});
    assert.equal(response.status,200);const value=await response.json();assert.equal(value.emails.length,1);assert.equal(value.emails[0].message_id,'<dedup-proof@example.test>');
  }finally{db.close()}
});
