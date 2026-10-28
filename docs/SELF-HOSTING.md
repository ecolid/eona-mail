# 部署与升级

## 1. 选择代码版本

从公开发行版取得源码归档或检出对应标签。公开发行按批进行，实例默认使用你选定的版本；不会自动追随维护者的内部开发渠道。

需要 Node.js 24.12+（24.x）和 Python 3.12。安装前用 `node --version`、`python3 --version` 核对。npm 依赖使用仓库的 package-lock.json：

```sh
npm ci --ignore-scripts --no-audit --no-fund
```

## 2. 先运行隔离演示

按 README 的演示命令启动，确认能进入列表、打开邮件、搜索、返回和保存合成草稿。演示不连接真实服务商，不能证明真实收发已接通。

## 3. 创建个人实例

选一个源码目录之外的目录。将至少16位的初始密码放入当前进程环境变量 `MAIL_INITIAL_PASSWORD`，不要写进命令参数或 Git，然后执行：

```sh
node product/cli.mjs init --mode personal --directory /path/to/mail-instance --origin http://127.0.0.1:8799 --email you@example.test
```

初始密码只用于生成密码散列。初始化生成 mail.json 与权限0600的 credentials.json；完成后从进程环境删除初始明文密码。重复初始化会拒绝覆盖已有配置。

本机访问可使用回环 HTTP。远程访问使用自己的 HTTPS 反向代理，将 origin 改为最终 HTTPS 地址；产品进程只监听回环地址，设置 port 或 internal_url 指定内部连接。反向代理应保留正确 Host、请求体和 WebSocket/长连接需要的超时。不要把凭据目录作为静态文件目录发布。

```sh
node product/cli.mjs serve --config /path/to/mail-instance/mail.json
```

访问页面，用初始密码登录。OIDC、AI 和外部通知均可选；它们的端点、凭据引用和拥有者由实例配置提供。

## 4. 接入邮箱

以 config.example.json 为结构参考，配置 accounts。每个账号使用唯一 id、address，以及服务商允许的 IMAP 993 / SMTP 465或587。credentials.json 保存 password_env 所引用的密钥；不要把密码直接放在 mail.json 或提交仓库。部分服务商需要启用 IMAP/SMTP、应用专用密码或其他授权方式，以服务商实际设置为准。

imap.folders 声明 INBOX、已发送、草稿和垃圾箱的真实名称与角色；discovery 设为 all 时收集所有可读目录，已知原件不会每轮全量下载。目录名称由服务商返回，不能假定所有服务商都叫 Sent/Drafts/Trash。Gmail 另设 imap.provider 为 gmail，host 为 imap.gmail.com，按 Gmail 身份关联多标签。

SMTP 单独配置，开启后页面可使用该账号发信。首次接入先核来源状态与历史同步进度，核对新邮件、正文、附件和真实接收端。

## 5. 运行持久任务

在独立进程中启动 worker，个人实例配置为同一文件：

```sh
node product/cli.mjs worker --config /path/to/mail-instance/mail.json
```

worker 按30秒间隔尝试来源、工作区与持久任务；失败保留待办并继续重试。服务进程与 worker 均需由你自己的进程管理器保持运行。单次诊断可加 `--once`；检查结果中的来源和任务状态，不只看进程退出。

默认 sync.enabled 为 false，来源状态不会因页面操作而回写。确认目录角色并备份后，可设 sync.enabled 为 true，启用双方已读、星标、目录和草稿同步；账号可另设 sync.enabled 为 false。发信权限由 SMTP 配置独立决定。

## 6. 备份、升级与恢复

备份实例配置、受保护的秘密文件与完整 data_root。数据库、原件、对象、草稿和任务责任应作为同一数据集保存；不要只复制 mail.db。停服务和 worker 后备份，或使用具有一致性保证的 SQLite/文件备份工具。

升级步骤：备份并记录旧代码版本，停止两个进程，安装新标签的锁定依赖，用原配置重新启动服务和 worker，核对来源、收发、草稿、附件和已有数据。数据目录不进入代码发布包。

代码回退不会自动回退数据库。出现不兼容的数据库版本或拥有者不匹配时，产品会拒绝打开；按对应发行说明处理，不删除数据库绕过检查。
