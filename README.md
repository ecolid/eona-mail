# Eona Mail

单拥有者、多邮箱的邮件工作区，提供来源归档、搜索、阅读、撰写、草稿与已发送同步，以及按会话隔离的演示环境。

当前仓库处于私有试运行。每次开发版本经过独立检查后发布；稳定版本另行标记。自用环境跟随已通过检查的开发版本。

## 运行

需要 Node.js 24.12+ 和 Python 3.10+。

```sh
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
MAIL_INITIAL_PASSWORD='自行设置至少12字符密码' node product/cli.mjs init --directory /absolute/path/mail-instance --origin http://127.0.0.1:8799 --email owner@example.test
node product/cli.mjs serve --config /absolute/path/mail-instance/mail.json
node product/cli.mjs worker --config /absolute/path/mail-instance/mail.json
```

在生成的实例配置中按 `config.example.json` 接入邮箱。密码通过实例凭据文件或已有受保护文件引用提供，数据库、原件和凭据放在源码目录之外。默认只导入；开启 `sync.enabled` 后才进行状态、草稿和已发送写回。

`imap.discovery: "all"` 自动发现当前账号可读取的全部目录。联通、目录范围、UID覆盖、原件缺口与检查时间在“邮件设置 → 同步状态”查看。失联和过期状态不会显示为完整；已保存原件不因源邮箱后来删除而自动清理。

## 演示

```sh
node product/cli.mjs init --mode demo --directory /absolute/path/mail-demo --origin http://127.0.0.1:8799 --email demo@example.test
node product/cli.mjs serve --config /absolute/path/mail-demo/mail.json
```

演示会话使用合成邮件和独立临时数据，不连接真实邮箱、模型和通知。演示模式的发送仅改变当前会话。

## 开发版本

本仓库当前接收开发源导出的产品快照，独立安装依赖、运行回归并生成带散列的发布包。`PRODUCT-RELEASE.json` 记录开发源提交和实际文件字节，`channels/development` 只指向通过独立检查的 main 提交。不要直接修改生成快照；变更应回到开发源后再次导出。

`scripts/follow.py` 可在实例端通过只读仓库身份跟随检查渠道，调用本机安装的实例适配器完成升级和异常恢复。支持暂停、固定已检查版本及失败版本停止重试。实例适配器须核产品清单中的接口、数据库和运行组件兼容性，更新时保留实例数据；不能直接执行下载包中的特权脚本。

许可证尚未确定，当前不授予本项目的开源使用许可。第三方组件按 `vendor/` 下各自许可证分发。实例数据、私人配置、部署身份和开发源历史不进入本仓库。
