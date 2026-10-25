-- mailhub 的 D1 表结构。2026-09-13 从线上 sqlite_master 导出来的(此前只存在于远端,机器重建时没法重建库)。
-- 本地开发:npx wrangler d1 execute mailhub_db --local --file schema.sql
-- 改表结构:先在这里改,再 --remote 执行同一条 ALTER,两边一致。

-- tr_* 是「翻译自己花了多少」的分账:总额度共用,但翻译不能把打标的份额吃光(2026-09-14 就是这么塌的)
CREATE TABLE ai_usage (day TEXT PRIMARY KEY, calls INTEGER DEFAULT 0, in_tokens INTEGER DEFAULT 0, out_tokens INTEGER DEFAULT 0, tr_in_tokens INTEGER DEFAULT 0, tr_out_tokens INTEGER DEFAULT 0);
CREATE TABLE aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT NOT NULL UNIQUE,
  label TEXT,
  first_seen TEXT DEFAULT (datetime('now')),
  email_count INTEGER DEFAULT 0,
  is_blocked INTEGER DEFAULT 0
);
CREATE TABLE blocked_senders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  kind TEXT DEFAULT 'sender',
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  alias TEXT NOT NULL,
  from_addr TEXT NOT NULL,
  from_name TEXT,
  to_addr TEXT,
  subject TEXT,
  text_body TEXT,
  html_key TEXT,
  raw_key TEXT,
  has_attachments INTEGER DEFAULT 0,
  attachment_keys TEXT,
  verification_code TEXT,
  is_read INTEGER DEFAULT 0,
  is_starred INTEGER DEFAULT 0,
  folder TEXT DEFAULT 'inbox',
  received_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
, ai_category TEXT, ai_summary TEXT, ai_action INTEGER DEFAULT 0, ai_at TEXT, ai_tries INTEGER DEFAULT 0, origin_to TEXT, ai_rev INTEGER DEFAULT 0
-- text_rev:补正文用的转换器版本(backfillTextBodies,2026-09-23 起代码在读写它)。
-- 2026-09-24 补记到这里:这份文件原来没有它,照这份文件重建的库补正文那一步每轮都会报错。
, text_rev INTEGER DEFAULT 0,labels_json TEXT,labels_rev INTEGER DEFAULT 0,labels_updated_at TEXT NOT NULL DEFAULT '');
CREATE TABLE event_log (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE mailbox_routes (id INTEGER PRIMARY KEY, mailbox TEXT NOT NULL UNIQUE COLLATE NOCASE, hop TEXT, alias TEXT, role TEXT, eona_reads INTEGER NOT NULL DEFAULT 1, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_emails_alias ON emails(alias);
CREATE INDEX idx_emails_folder ON emails(folder);
CREATE UNIQUE INDEX idx_emails_msgid ON emails(message_id);
CREATE INDEX idx_emails_received ON emails(received_at DESC);

-- 2026-09-13:B2 备份进度(Worker 定时任务自己会建;这里是给重建库用)
CREATE TABLE IF NOT EXISTS backup_state (k TEXT PRIMARY KEY, v TEXT);

-- 2026-09-13 晚:D1 读额度一天烧掉 62%(300 万行)。EXPLAIN 出来两处全表扫:
--   列表 WHERE folder ORDER BY received_at 走 idx_emails_folder 后临时排序 —— 每分钟 Eona 拉一次,每次读全部 6000 行;
--   AI 补标那句 SCAN emails,每 10 分钟一次。
-- 三个索引把它们变成索引扫描。partial index 的 WHERE 必须和查询里的一模一样才会被用上。
CREATE INDEX IF NOT EXISTS idx_emails_folder_received ON emails(folder, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_emails_ai_pending ON emails(id DESC) WHERE ai_at IS NULL AND COALESCE(ai_tries, 0) < 3 AND folder <> 'trash';
-- 重打(换了提示词/类目之后回头补课)靠这两条走索引。**不许给重打的查询加 ORDER BY**:
-- 09-21 实测带 ORDER BY id DESC 时一次读 1975 / 13640 行,去掉之后都是 4 行。
CREATE INDEX IF NOT EXISTS idx_emails_retag_tier ON emails(ai_category, ai_rev, id DESC) WHERE ai_at IS NOT NULL AND folder <> 'trash';
CREATE INDEX IF NOT EXISTS idx_emails_retag_all ON emails(ai_rev, id DESC) WHERE ai_at IS NOT NULL AND folder <> 'trash';
CREATE INDEX IF NOT EXISTS idx_event_log_kind_time ON event_log(kind, created_at);

-- 2026-09-14:译文(原文不动,单独存);Worker 第一次翻译时自己会建
CREATE TABLE IF NOT EXISTS translations (email_id INTEGER PRIMARY KEY, lang TEXT NOT NULL DEFAULT 'zh', model TEXT, paragraphs TEXT, translated TEXT, truncated INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));

CREATE INDEX IF NOT EXISTS idx_emails_label_updates ON emails(labels_updated_at,id);

-- Account-owned writing state; sending records remain separate from drafts.
CREATE TABLE IF NOT EXISTS mail_drafts(owner TEXT NOT NULL,id TEXT NOT NULL,to_addr TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,rev INTEGER NOT NULL,updated_at TEXT NOT NULL,envelope_json TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS mail_important_contacts(owner TEXT NOT NULL,address TEXT NOT NULL,name TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,address));
CREATE TABLE IF NOT EXISTS mail_outbox(owner TEXT NOT NULL,id TEXT NOT NULL,draft_id TEXT NOT NULL,draft_rev INTEGER NOT NULL,payload_json TEXT NOT NULL,state TEXT NOT NULL,message_id TEXT NOT NULL,accepted_json TEXT NOT NULL DEFAULT '[]',rejected_json TEXT NOT NULL DEFAULT '[]',error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,id),UNIQUE(owner,draft_id,draft_rev));
CREATE INDEX IF NOT EXISTS mail_outbox_owner_time ON mail_outbox(owner,created_at DESC);

CREATE TABLE IF NOT EXISTS mail_assets(owner TEXT NOT NULL,id TEXT NOT NULL,draft_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,data_base64 TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner,id));
