
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./src/index.js", import.meta.url), "utf8");

function extract(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start === -1) start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到函数 ${name} —— 它被改名或删了`);
  let depth = 0;
  let index = source.indexOf("{", start);
  for (; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, index + 1);
}

// 鉴权判定那一段逻辑是内联在 handler 里的,抽不出独立函数,
// 所以这里按同一份规则重建一遍 **并用下面一条测试钉住它没跑偏** ——
// 重建的规则和源码脱节,是这类测试最常见的死法。
const sandbox = `
${extract("timingSafeEqual")}
function decide(env, headers, method, path) {
  const cookie = (headers.cookie || "");
  const m = cookie.match(/(?:^|;\\s*)mh=([^;]+)/);
  const cookieAuthed = Boolean(m && m[1] === "valid-session");

  const bearer = headers.authorization || "";
  const presented = bearer.toLowerCase().startsWith("bearer ")
    ? bearer.slice(7).trim()
    : "";
  const machineTokens = String(env.READONLY_TOKENS || "")
    .split(",").map((x) => x.trim()).filter((x) => x.length >= 32);
  const machineAuthed = presented.length >= 32
    && machineTokens.some((token) => timingSafeEqual(token, presented));

  const authed = cookieAuthed || machineAuthed;
  const readOnly = machineAuthed && !cookieAuthed;
  if (!authed) return { status: 401, readOnly };
  if (readOnly) {
    const allowed = method === "GET" && (
      path === "/api/emails"
      || /^\\/api\\/email\\/\\d+$/.test(path)
      || /^\\/api\\/email\\/\\d+\\/raw$/.test(path)
      || path === "/api/forward-health"
      || path === "/api/routes"
    );
    if (!allowed) return { status: 403, readOnly };
  }
  return { status: 200, readOnly };
}
return { decide, timingSafeEqual };
`;

const { decide, timingSafeEqual } = new Function(sandbox)();

const TOKEN = "m".repeat(48);
const ENV = { READONLY_TOKENS: TOKEN };
const machine = { authorization: `Bearer ${TOKEN}` };
const browser = { cookie: "mh=valid-session" };

// -- 机器码能读它该读的 -----------------------------------------------------

test("机器码能读 context-sources 里声明的那五个端点", () => {
  // 转发健康接口只公开计数和时间戳。
  for (const path of ["/api/emails", "/api/email/42", "/api/email/42/raw", "/api/forward-health", "/api/routes"]) {
    const result = decide(ENV, machine, "GET", path);
    assert.equal(result.status, 200, `${path} 被拒了`);
    assert.equal(result.readOnly, true, `${path} 没被认成只读身份`);
  }
});

// -- 机器码不能碰别的 -------------------------------------------------------

test("机器码读不了没声明的端点", () => {
  // 白名单而不是黑名单:以后加新端点,默认是「机器进不来」而不是「机器能进」。
  for (const path of ["/api/logs", "/api/ai-usage", "/api/aliases", "/api/file"]) {
    assert.equal(
      decide(ENV, machine, "GET", path).status, 403,
      `${path} 对机器码开着 —— 白名单漏了`,
    );
  }
});

test("机器码发不了任何写请求", () => {
  for (const [method, path] of [
    ["POST", "/api/block"],
    ["POST", "/api/alias/toggle-block"],
    ["POST", "/api/email/42"],
    ["POST", "/api/login"],
    ["POST", "/api/routes"],
    ["POST", "/api/routes/delete"],
    ["DELETE", "/api/email/42"],
  ]) {
    assert.equal(
      decide(ENV, machine, method, path).status, 403,
      `${method} ${path} 对机器码开着 —— 它能改他的邮件`,
    );
  }
});

test("机器码进不了 GET 白名单之外的路径形态", () => {
  // 正则写松一点就会漏,比如 /api/email/42/../logs 或 /api/emails-secret
  for (const path of [
    "/api/emails-secret", "/api/email/42/html", "/api/email/abc",
    "/api/email/42/raw/extra", "/api/emailsx",
  ]) {
    assert.equal(
      decide(ENV, machine, "GET", path).status, 403,
      `${path} 被白名单放进来了`,
    );
  }
});

// -- 浏览器身份不受影响 -----------------------------------------------------

test("浏览器 cookie 照常全权限,而且不算只读", () => {
  for (const [method, path] of [
    ["GET", "/api/emails"], ["GET", "/api/logs"], ["POST", "/api/block"],
  ]) {
    const result = decide(ENV, browser, method, path);
    assert.equal(result.status, 200, `${method} ${path} 把机主拦住了`);
    assert.equal(result.readOnly, false, "机主被当成了只读身份");
  }
});

test("两个凭据同时带时,以浏览器为准(不降级成只读)", () => {
  const both = { ...browser, ...machine };
  const result = decide(ENV, both, "POST", "/api/block");
  assert.equal(result.status, 200);
  assert.equal(result.readOnly, false, "机主带着机器码来就被降级了");
});

// -- 凭据本身 ---------------------------------------------------------------

test("错的机器码进不来", () => {
  assert.equal(decide(ENV, { authorization: `Bearer ${"x".repeat(48)}` }, "GET", "/api/emails").status, 401);
  assert.equal(decide(ENV, { authorization: "Bearer short" }, "GET", "/api/emails").status, 401);
  assert.equal(decide(ENV, {}, "GET", "/api/emails").status, 401);
});

test("没配机器码时,谁也别想用 Bearer 进来", () => {
  // 空配置绝不能变成「什么都放行」—— 那是配置缺失最经典的翻车方式。
  assert.equal(decide({}, machine, "GET", "/api/emails").status, 401);
  assert.equal(decide({ READONLY_TOKENS: "" }, machine, "GET", "/api/emails").status, 401);
  assert.equal(decide({ READONLY_TOKENS: "   " }, machine, "GET", "/api/emails").status, 401);
});

test("太短的码不算数,哪怕配置里写了", () => {
  // 长度门槛挡的是「有人图省事配了个 123456」。
  assert.equal(
    decide({ READONLY_TOKENS: "short" }, { authorization: "Bearer short" }, "GET", "/api/emails").status,
    401,
  );
});

test("凭据比较是定长的", () => {
  assert.equal(timingSafeEqual("abcd", "abcd"), true);
  assert.equal(timingSafeEqual("abcd", "abce"), false);
  assert.equal(timingSafeEqual("abcd", "abc"), false, "长度不同该直接假");
  assert.equal(timingSafeEqual("abcd", ""), false);
});

// -- 只读必须真的只读 -------------------------------------------------------

test("机器读一封信,不许把它标成已读", () => {
  // 源码门禁保证标为只读的请求不执行已读写入。
  const guard = /if \(!row\.is_read && !readOnly\)\s*\{/;
  assert.match(
    source, guard,
    "读详情又会标已读了 —— 机器每轮拉一遍就把他的未读清空,而且他不知道是谁标的",
  );
});

test("源码里的白名单和这份测试重建的那份没跑偏", () => {
  // 上面的判定逻辑是按源码重建的。**重建的规则和源码脱节,是这类测试最常见的死法** ——
  // 源码改了、测试没改,于是测试还在验一套已经不存在的规则,而且全绿。
  // 这里把三个端点模式逐个对回源码。
  for (const pattern of [
    `path === '/api/emails'`,
    `/^\\/api\\/email\\/\\d+$/.test(path)`,
    `/^\\/api\\/email\\/\\d+\\/raw$/.test(path)`,
    `path === '/api/forward-health'`,
    `path === '/api/routes'`,
  ]) {
    assert.ok(
      source.includes(pattern),
      `源码里找不到白名单模式 ${pattern} —— 测试重建的规则已经和源码对不上了`,
    );
  }
  assert.ok(
    source.includes("READONLY_TOKENS"),
    "源码里没有 READONLY_TOKENS 了,这份测试在验一个不存在的机制",
  );
});

test("转发健康端点只给数字和时间戳,不带 detail 原文", () => {
  // detail 里有目标地址和错误串,机器码能读这个端点,所以它只能是计数。
  const start = source.indexOf("path === '/api/forward-health') {");
  assert.notEqual(start, -1, "找不到 /api/forward-health 端点");
  const body = source.slice(start, source.indexOf("if (path === '/api/logs')", start));
  assert.ok(!/SELECT[^;]*detail/i.test(body), "转发健康端点把 detail 原文查出来了");
  assert.ok(/COUNT\(\*\)/.test(body), "它应该数计数,而不是列明细");
});
