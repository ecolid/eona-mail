# 服务 API v1

实例外调用统一走 HTTPS `/v1`，同机可走受限 loopback。浏览器继续用原会话；不把服务令牌交给浏览器。每个实例绑定配置 owner，不接受请求指定 owner 或借用浏览器 Cookie。

## 配置与权限

```json
{"service_clients":[{"id":"assistant-reader","token_env":"MAIL_ASSISTANT_TOKEN","scopes":["mail.read","mail.status","mail.events"]},{"id":"sender","token_env":"MAIL_SENDER_TOKEN","scopes":["mail.drafts","mail.send"],"allowed_from_ids":["primary"]}]}
```

账号 id 来自实例 accounts。令牌是至少 32 字节的随机秘密，放 secrets_file、既有秘密文件映射或环境变量；配置和秘密文件权限 0600。服务请求带 `Authorization: Bearer <token>`。不接受 Cookie、Origin 或浏览器跨站请求，不开放 CORS。未知令牌 401，权限不足 403，配置不可读取 503；不降级为浏览器权限。

轮换时为同一用途另加客户端及秘密，重启 Mail，切换调用端并验证，最后移除旧客户端并重启。秘密解析函数能读取实时秘密的接入可直接轮换值；文件加载实例须重启。撤销不会影响其他独立客户端和浏览器会话。

| 接口 | 权限 | 语义 |
| --- | --- | --- |
| GET /v1/messages | mail.read | 列表、分页和搜索，兼容既有邮件查询参数 |
| GET /v1/messages/:id | mail.read | 详情，不改变已读状态 |
| GET /v1/messages/:id/raw | mail.read | 原始 MIME |
| GET /v1/messages/:id/translation | mail.read | 既有译文缓存，不发起模型调用 |
| GET /v1/file、/v1/export | mail.read | 附件、分页导出，参数沿用既有只读合同 |
| GET /v1/routes、/v1/forward-health、/v1/backup-health | mail.read | 既有只读接入与健康投影 |
| POST /v1/messages/:id/read、unread、star、unstar、trash、restore | mail.write | 明确状态操作；删除为移入垃圾箱 |
| GET /v1/drafts、/v1/drafts/:id | mail.drafts | 草稿 |
| PUT /v1/drafts/:id | mail.drafts | to、subject、body、from_id、rev；可带 cc/bcc、富文档和既有附件引用 |
| DELETE /v1/drafts/:id | mail.drafts | 带 rev；保留恢复记录 |
| GET /v1/senders | mail.send | 实际可用发件账号，并受 allowed_from_ids 限制 |
| POST /v1/send | mail.send | `{draft_id,rev}`，必须有 Idempotency-Key |
| GET /v1/send/:id | mail.send | 仅可查该客户端自己的发送请求 |
| GET /v1/status | mail.status | 来源覆盖、检查时间和缺口，失败返回 503 |
| GET /v1/events?after=0&limit=100 | mail.events | 持久游标、message.created/message.changed；含 id，不含正文 |

草稿 PUT 初次 rev=0，成功后递增；版本冲突 409，调用方保留输入并重新读取，禁止覆盖别处更新。发件地址来自配置账号及发送权限；调用方不能伪造发件地址。

发送幂等键在客户端内唯一，重试同一内容取得同一发送记录；同键换内容 409。发送结果以 message.state 为准：sent/partial/failed/sending/unknown。HTTP 200 仅表示返回记录，不等于已经送达；unknown 和 sending 必须查询原记录，不能换键盲重发。SMTP 接受不等于收件人最终收妥。

事件由邮件库触发器写入，同事务提交、重启保留。首次接入先分页读取当前存量，再用 after 游标接增量；重叠读取按事件 cursor 去重。游标大于库当前上限 409，不能把更换数据库当作正常空结果。当前事件不自动裁剪，未来如引入保留期限必须给出过期游标语义。

收信 worker 的 /internal/product 接口与实例私人导入/原件修复适配独立保留，沿用各自用途凭据；服务令牌不能进入这些端点。
