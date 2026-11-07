# Foundation 固定依赖

Mail 消费 `standalone-v1` 通用 profile。旁边的发行清单记录完整产物标识、不可变源版本，以及源文件和输出文件的 SHA-256。Foundation 的 Eona 自有代码随本项目采用 MIT 许可。

本 profile 保留相同样式与控件，移除私人应用目录、内嵌品牌库存和默认外部账号页。`mountTools` 只接收产品明确提供的 `applications`、`accountUrl`；未配置的入口不显示。产品鉴权和数据授权继续由业务层负责。

维护者从组件所有者已登记的导出更新 CSS、JS 和清单，不在本仓修改 vendor 实现，也不能把私人包当作同一个产物使用。安装和运行 Mail 无需访问私人仓库。

`python3 scripts/build-foundation-assets.py` 生成实际消费的模块和公开 CSS。`--check` 验证依赖散列及派生字节，已接入 `npm run check:assets`。产品回归覆盖默认与显式配置、桌面/手机控件、图标回退和销毁，并在两个浏览器引擎执行。
