# 翻译预算与阅读优先

原邮件和HTML文字节点结构保持，参考上下文只帮助理解，不作为待翻译输出预留。每次模型请求继续先检查最大输出预算，不能通过去掉门禁恢复可用性。

后台预译保留新信分类余量，并另给手动阅读翻译保留默认1500 neurons，可由AI_TRANSLATE_MANUAL_RESERVE配置（显式0仍保留）。预算总上限AI_DAILY_NEURONS保持；手动请求仍受总预算约束。缓存命中无需新模型调用，后台暂停不阻断已缓存译文。

预算拒绝返回429及budget中的used、limit、required、remaining、reset_at。remaining大于0表示不足以承接当前请求，不能写成已用尽；reset_at按实际UTC日边界生成。失败保留原文和已完成节点，下一次请求继续复用。

参数与用量按当前模型核对，平台参考[Workers AI配额](https://developers.cloudflare.com/workers-ai/platform/pricing/)与[模型合同](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)。本地账本不是账号其他服务的全量用量证明。

永久回归在test-inline-translation.mjs：大只读上下文的输出预算、自动／手动分工、总预算耗尽后的缓存、429真实余量及原文保留。界面继续沿原翻译／重试／切回原文状态，不重排阅读页。
