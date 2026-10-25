# Eona Mail

Mail 产品的唯一开发和发布主仓，目前私有。Node 24 + SQLite，保留 IMAP/SMTP 接入、邮件原件、草稿、已发送、搜索、分类和移动交互。实例配置、数据和凭据独立于代码。

- [产品与开发边界](PRODUCT.md)
- [服务 API 与鉴权](docs/API.md)
- [开发与发布](docs/DEVELOPMENT.md)

## 本地验证

```sh
npm ci --ignore-scripts
npm run check:assets
npm test
```

## 独立运行

```sh
node product/cli.mjs init --mode demo --directory /tmp/mail-demo --origin http://127.0.0.1:8799 --email demo@example.test
node product/cli.mjs serve --config /tmp/mail-demo/mail.json
```

演示为隔离的合成数据，不连接真实邮箱。个人实例配置见 config.example.json，生产运行数据不放源码目录。
