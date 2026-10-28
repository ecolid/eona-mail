# 开发与发布

通用功能只在 eona-mail 修改。执行 npm ci、资产散列核对、Node 全套产品与界面回归、四项 Python 同步测试、跟版恢复测试。浏览器动效与完整操作由下述 CI 门禁自动执行；产品画面判断与正式回读继续分别记录。

main CI 成功后生成独立发布包，PRODUCT-RELEASE.json 记录产品 main 提交、源树、兼容合同和每个文件散列。channels/development 是连续的已验 release 历史，同时保留产品 main 祖先关系。服务器只读拉该渠道，先校验合同与文件，再由本地安装的实例适配器切换；下载的产品不能自改特权安装器。

实例的 data_root、对象、配置、凭据独立持久化。切换失败恢复上个代码和配置，保持用户数据。失败版本不重复安装，支持暂停、pin 和显式重试。新增不兼容 schema 或 Foundation 合同需要适配升级，不自动越过。

Accompany 保存私人实例装配、入口认证和通知适配，固定消费本产品发布；其业务调用 /v1。公共 Foundation 作为 vendor 固定版本依赖，升级从原权威来源取得并验散列。

## 查询与筛选连续性

文件夹、邮箱和固定业务范围拥有页面容器；阅读状态、附件、关键词和排序只改变该容器内的查询。首次查询保留当前可见结果、滚动与可操作筛选，完整邮件库的查询返回后一次提交；不能将查询变化当作新页面清空并重放占位。缓存按查询隔离，分页游标也按查询隔离；未读/已读、附件组合与反选均保留服务端完整范围。

回归必须跨真实页面激活器、查询与可见提交三层，记录点击后的等待帧及最终结果。只验证弹层未重建不足以证明列表没有闪空。覆盖首次条件、组合、反选、空结果再清除、请求失败重试、分页后筛选、迟到响应及动画未结束时快速反向。可见提交时更新相应缓存身份，不能等动画结束才标记已提交；旧动画完成不得覆盖较新结果。来源变化继续隔离页面与选择范围。

## 标题动作与锚点

筛选/分类在未生效时打开条件面板；点选立即生效，面板内允许继续组合。生效后同一位置显示关闭图标与“清除”，一次清除当前快捷条件及非默认排序，保留关键词、邮箱和固定业务范围；再次打开重新选择。多选中的同一入口显示关闭图标与“取消”，退出并清空全部勾选。标题动作使用同一紧凑表面和固定宽度，不在文案后追加撑宽控件的数量；空结果保留禁用选择槽，手机命中高度独立于可见表面。

结果提交保留已打开面板和选项身份。锚点必须在全部标题增强器完成装配后的下一绘制帧读取；不能在相邻选择入口仍脱离文档时定位。回归同时量按钮组和面板的矩形，覆盖首次条件、组合、反选、零结果、全部清除、慢/失败、快速反向与下一次使用。退出弹层的既有收回动画不当作位置漂移。

### 手机阅读、返回与下一次点击

下拉所有者在 iOS 首个可取消 move 预留刷新流，但预留不能吃掉原行的轻触。原始主入口、全过程最大位移、抬手命中及取消状态共同决定：小于 8px 的轻触仅激活一次原入口；明确拖动、往返拖动、跨行、弹层、取消和多指不激活，兼容 click 仍被隔离。范围选择与刷新继续分别拥有自己的判向和提交。

手机返回立即释放 reader inert、按压与阅读行底色，独立多选标记不随阅读清理；缓存命中、后台失败都不依赖列表重绘来清色。列表校验失败保留当前正文及返回入口，不把未知成员状态变成遮挡阅读的空层；错误和重试由列表所有者呈现。桌面分栏保留当前阅读定位。浏览器 popstate 和列表恢复中的显式新打开优先，旧恢复不可覆盖它；等待原生后退事件时延后历史写入，事件到达后将新意图写为新条目。

回归覆盖轻触 1/3/7px 微动、明确拖动与回缩、异步原生后退、慢列表返回后立即读下一封、重复读同一已读邮件、失败保留缓存及再次打开；分别记录源触摸事件、真实源码浏览器和物理触摸证据。

### 返回后的原生滚动与连续操作

阅读仍保留原列表。返回相同账号、完整查询和足够已加载范围的就绪列表时，直接露出原节点和滚动宿主，不重复读列表和回写位置。跨范围、缺页、未就绪与重载仍按历史恢复；恢复开始后首次pointer/touch/wheel/keyboard输入接管位置，旧请求成功或失败都保存用户最新位置，不回拉。阅读层退出立即停止命中输入，退场动画独立继续。

下一动作按实际能力列出，不能只验再次点击：阅读返回后立即上/下滑、再读一封、左滑行操作、进入多选分别走完整路径。按退场第一帧、动画中、缓存命中/失效、慢读取、失败和减少动态效果记录命中、inert、实际原生滚动、scrollTop及迟到结果。源事件派发与直接设scrollTop只验证控制器；浏览器原生滚动和物理手指输入分开记证。


### 连续操作与运行负载

页面当前状态独立于浏览器历史持久化。滚动更新内存中的当前位置，按秒合并历史检查点；打开、切页、返回与离页显式保存最后位置。历史写入去重，浏览器拒绝写入时阅读和本地返回继续可用。未完成的原生后退只允许一个事务，重复返回更新最新目标，不再次后退；迟到事件以最终意图落地。视口仅高度变化不重置页面、选择或手势，同一表面清理幂等。

手机与粗指针使用原生滚动，桌面自定义轨道保持原滚动容器；移动端不安装滚动条浮层和拖动监听。单指行横向操作使用Pointer Events与声明的pan-y轴，纵向原生取消释放同一个行状态；双指选择继续由触摸范围所有者处理，不为等待方向取消微动后可能的纵向滚动。链接命中区保留点击，同时允许阅读层接管返回方向。

HTML正文保留脚本禁用的沙盒、正文选择及父层链接确认。正文高度不依赖iframe自身视口的百分比/min-height，ResizeObserver只在实际宽度或内容高度变化后重新拟合，避免高度自反馈。长表格、密集多行链接、CSS高度约束与正文读取失败/迟到都进入回归。

可复用隔离验收入口为维护技能mail-continuation-review.mjs，MAIL_FIXTURE_RICH=1启用长HTML。自动组合正文就绪、900次滚动状态更新、180次高度变化、35轮阅读/返回/立即再读、小位移左滑、按钮区右滑收回和纵向取消；记录历史调用、未处理异常、正文高度漂移、输入所有者和最终状态。它使用脚本DOM/Pointer/Touch事件与浏览器历史限额模型，作用是持续击中共享机制错误；不以脚本滚动值冒充原生手指或帧率。单元及页面接线回归进入产品npm test与同提交CI，浏览器夹具必须用同样场景击中旧源码后再验候选。

### 正文输入与返回完成

HTML正文是独立输入文档，父页监听不会跨iframe冒泡。正文、链接命中层、纯文本和阅读外框使用同一阅读指针所有者，声明pan-y/pinch-zoom；原生取消、第二指、切页、失焦、正文替换及销毁都释放捕获与待绘制位移。返回开始即释放列表命中和原生纵滑；视觉状态按实际几何从leaving到list，历史结算独立，不能等待动画或popstate才允许下一操作。旧输入、旧退出帧和浏览器自动滚动恢复不得覆盖新意图，只有一个滚动恢复所有者。

正文展示投影解析HTML并移除活动标签、外来命名空间、事件属性及自动聚焦；原件不改。父页生成首个固定CSP，script-src/connect-src/form-action/base-uri均为none。iframe仅为兼容WebKit父页回调允许allow-scripts，与原有allow-same-origin组合；邮件脚本仍由固定CSP和投影过滤双重禁止，不允许表单、弹窗或顶层导航。直接HTML响应继续带禁止脚本的sandbox头。

回归须从子文档正文起手，覆盖小幅起步、原生纵向取消、链接/选择/横向内容、自身替换、拖动中返回、首个上下滑、再次阅读及迟到历史。输入交还、实际退场完成及历史结算分别取证；只看viewing=false不足以验收返回。浏览器模型与原生输入分别标记。

展示投影按脚本禁用语义解析并展开noscript备用正文，再过滤活动内容；不能因允许父页回调而隐藏原先可阅读的备用文字或让其中的脚本进入展示DOM。

## 拖动、松手与刷新的帧预算

输入事件只更新意图，行位移在每帧应用最新值；松手提交该位置后接入既有过渡，取消、切页或另一行接管时作废旧回调。阅读和导航位移只写实际移动的层，使用不继承的已注册属性，不将逐帧变量放在应用根节点。正文跨文档坐标在起手时建立基准，屏幕坐标的差值用于跟手；无屏幕坐标的事件按已绘制位移换算，移动路径不反复查询文档矩形。

刷新位移同样归本地内容层和提示层；提示使用固定几何，拖动只更新本地位移，收尾直接动画 transform，并共享同一时间线。继承的根变量即使最后用于 transform，仍可能让整页重算，不能由 JS 处理器很短推定渲染很轻。缓存提交或内容重建转交当前位移；重抓读取当前呈现，旧收尾先取消。行悬停保存当前对象，不在每次触摸移动或滚动时扫描整表。

性能验收与几何验收分开：固定并核对整个过程的有效视口，先关闭其它逐帧探针，再分别记录事件、rAF 回调与样式/布局刷新的开销、帧间隔、几何读取和样式写入范围；采样器主动刷新的成本明确标记，不混入业务事件。松手坐标和未绘制输入、取消、快速反向与下一次输入另取实际位移轨迹。合成事件、桌面帧率与物理手机分别记载，不能把减少事件开销直接写成手机达到某个帧率。


### 阅读退场的资源与画面交接

返回首先交还列表输入并作废旧读取；正文暂停输入、观察器及测量，保留可见节点退场。实际离屏后清理旧正文，新的阅读可立即接管；旧清理仅处理旧资源，不能覆盖新阅读。过渡确认沿 transitionend 与一次有界后备检查，不以逐帧几何轮询维持空闲工作。

使用同源长 HTML 夹具连续完成 24 轮进入、拖动、返回、空闲和下一轮，分别检查退场节点身份/位移、资源计数、空闲回调及首末阶段开销。计时与几何检查分开，持续性能不能由第一轮顺畅推出。

返回后的首个列表输入是明确的交接边界：pointer/touch/wheel/keyboard 到达时，尚未完成的阅读退场立即结算，旧层移出渲染、旧正文释放，且不取消新输入。退场自然完成也移出渲染，不能只将固定滚动层藏在右侧；同一列表表面的重复同步不得重新挂出旧层。下一次阅读从离屏位置准备一次进入，退场中重入保留当前位置。

验收覆盖松手后首帧、动画中及完成后分别开始下一输入；一起观察输入前后节点、渲染盒、退场时序与列表原生位移。首输入模型和真实浏览器默认滚动分开留证；工具往返过长时可在夹具延缓退场以验证原生交接，必须标明延缓条件，不能写成物理手机原速验收。

## 原生历史过渡的交接

浏览器提供 `PopStateEvent.hasUAVisualTransition`，表明同文档历史返回已经由浏览器呈现过渡；目标为列表时，在该事件任务内结束应用退场、释放旧阅读盒与正文，不再等待下一帧或补第二次动画。应用按钮或内部拖动仍沿自身退场；未提供该标志的浏览器保留原处理，不用设备名称、边缘坐标或固定延时推断。旧结算不得隐藏已开始的新阅读。

回归在实际页面派发明确标记的原生过渡事件模型，比较同步返回点与后续帧；标志为true时目标列表在同一任务完成，为false时自身动画仍存在。诊断从导航所有者进入/完成处记录事件及标志，避免其他popstate监听阻断观测。设备记录中的帧间隙不能直接写成CPU长任务或已证实的浏览器缺陷。

依据：[HTML PopStateEvent 合同](https://html.spec.whatwg.org/dev/nav-history-apis.html#the-popstateevent-interface)。

## 返回与迟到恢复

导航控制器是返回操作的唯一所有者；已安装时不得因 `back()` 返回 false 再执行兼容历史逻辑。历史恢复等待数据期间，已露出的列表收到新输入即撤销旧阅读意图，迟到成功和失败均不得重开正文或覆盖新滚动。保持列表恢复和阅读恢复的取消语义独立。

显式 `?return_check=1` 提供本地 `mail-return-v1` 记录，包含装载控制器的 SHA-256、表面状态、输入边界和渲染盒，不包含邮件身份、文本或地址，不自动上传或持久化。退出后解除监听、观察器、采样和 iframe 绑定。无此参数时不创建任何诊断节点或监听。
## Mobile page and scroll ownership

The reader has a non-scrolling page (`#mail-reader-page`) and a separate native
scroll host (`#view`). The page owns translation, containment and visibility;
the scroll host owns vertical position. The mounted list page retains its heading outside `#mail-list-scroll`, the
one native viewport. The viewport is never made inert during reading. Same-page
query/refresh commits preserve that viewport node and update its rows in place.
Pagination, navigation persistence, filters and range autoscroll resolve this
same viewport; scroll observation uses capture on the outer page. Native
overscroll is disabled there because the custom refresher alone owns pull
displacement. A contact which began inside a scrolled list remains native when
it reaches the top; it does not acquire a second refresh owner mid-contact. Covered-list semantics use
`aria-hidden` and a focus guard, with pointer access gated by the active page.

This follows the separation used by Ionic's [page container](https://github.com/ionic-team/ionic-framework/blob/main/core/src/css/core.scss)
and [content scroll host](https://github.com/ionic-team/ionic-framework/blob/main/core/src/components/content/content.scss).
It does not introduce an Ionic runtime or change Mail's data/API ownership.

Return completion means the list can accept its next input. Browser-owned
transitions finish the page synchronously; ordinary returns retain their exit
animation. Body observers and input bindings pause on exit; destructive body
cleanup runs at idle and waits through an active list contact. A new reader or
disposal flushes the retired resource exactly once without replacing new content.

Regression covers return, first native vertical input, next open, cancellation,
browser history flags, late requests, and repeated long HTML readers. Event
models, browser native scrolling, and physical Safari results remain distinct.


### Interactive release continuity

Reader input and release share one progress owner. Pointer move is linear and
frame-coalesced; release consumes the latest input, including an unpainted final
move or final up coordinate. The page shell then uses native Web Animations from
that position, with bounded remaining-distance/signed-velocity timing. Cancellation
and reversal settle back from the current input. Re-grabbing a settling page keeps
its visible position. Only the page shell moves; the native scroll host stays put.
First list input or a browser-owned transition cancels the old animation, and a
late finish cannot change a newer page. Reduced motion uses the destination
without a visible travel. Browsers without WAAPI retain the CSS fallback.

The model follows Ionic's [swipe progress and release decision](https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/gesture/swipe-back.ts)
and [interactive animation lifecycle](https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/animation/animation.ts).
Mail retains its own browser edge, history and input ownership policy.

The maintenance fixture's fast motion suite covers same-task release before rAF,
HTML-body flick, frame-paced flick, immediate reversal, native cancellation,
re-grab and first list input. Record actual release geometry and compositor
keyframes/timing as well as normal-speed trajectories. The slow drag profiler and
24-round resource check remain separate. Synthetic events prove controller and
rendering continuity, not physical Safari FPS. Run these against the old package
first and bind results to the exact release manifest. Product unit tests exercise
the WAAPI path, final up coordinate, signed direction, bounded timing and stale
completion cancellation in the normal npm test/CI entry.

### Return task budget and list invalidation

Reader surface changes only reset input and clear an actually active selection.
A list already prepared for the same query and identity is reused as is. Row
construction and quick-action presentation belong to list/data changes, with
unchanged quick-action content retained. Account/query changes still invalidate
the prepared scope; real action changes update their existing controls.

The maintenance return-budget probe measures nested total/exclusive costs for
pointer down/move/up, native DOM properties, history, reader suspension and surface
listeners. It rejects any full row scan or HTML rebuild during a same-list return,
and compares synchronous release against the observed frame cadence, capped at
60Hz's frame budget. A 50ms long-task threshold cannot establish smooth motion.
The normal-speed trajectory and first native input remain separate checks. Run
against the previous package before the candidate, and exercise a real synthetic
star/unstar mutation afterward to verify data invalidation still works.

## Gmail 接入与双向同步

Gmail 使用 `imap.provider: "gmail"` 接入同一产品能力；全局同步启用时默认双向同步，只有明确设置账号级 `sync.enabled: false` 才限制为来源只读。SMTP 独立配置。凭据本身具有读写和发信能力，先进入实例拥有者既有加密档案，再进入受限运行秘密文件，不进产品仓、日志或测试。

### 来源与身份

完整 LIST 与发现配置决定范围；所有可读目录（含聚合目录、已发送与草稿）都由原件收集器留存每个 UID 的原件、散列与来源证明。`X-GM-MSGID` 是跨标签的稳定身份，`X-GM-LABELS` 与所选目录的隐含系统标签一起决定当前角色。缺少元数据时失败，不猜成收件箱。轻量状态扫描仅取 UID、FLAGS 和 Gmail 元数据，已知正文不反复下载。原件、正文及附件仍长期留存。

同一信的到达责任只建立一次；历史导入与后续标签变化不产生新信提醒。邮箱范围继续取旧转发归属与逐封来源的并集，列表和计数共用谓词。一个账号的已发送不能覆盖另一个账号的实际收件箱。Gmail 的本地展示和跨账号原件去重保持同一身份。

### 双向状态

Gmail 状态按账号及 Gmail 邮件身份聚合，每个本地修改保留共享的持久 revision/operation 责任。实际连接须在登录后重新查询 CAPABILITY；不能使用 imaplib 缓存的登录前能力判定 MOVE。已读和星标使用目标 UID 的 FLAGS；操作前核 UIDVALIDITY 和 Gmail 身份，写后读取确认。确认后的状态成为下一次比较基线，防止紧接着的源端反向操作被旧快照吞掉。更新中的新本地 revision 继续待办。

删除和恢复使用服务端 UID MOVE，目标来自实际目录角色，恢复保留原位置；不设置 Deleted，不调用 EXPUNGE，也不复制出多个标签副本。移动回执丢失后，按 Gmail 身份查实际位置继续确认；不依赖失效的旧 UID，也不重复发信。所有标签 UID 的证明保留，身份级回执在移动产生的新 UID 尚未收集时也能结算。首次启用保留已有本地阅读及编辑状态，并按真实角色接管旧只读工作区；已在 Trash 的草稿不再成为活动草稿。Trash 的优先级高于残留 Draft/Sent 标签，来源物理目录证明不等于活动工作区角色。

源端已读、星标、垃圾箱及恢复变化回到 Mail；另一邮箱仍存在的 Inbox 原件保留。失败保留责任与原件，重连后续接。未取得源端定位的转发原件保持待核对，不能将无归属的待办误报为每个账号失败，也不能清空待办冒充成功。

### 草稿与已发送

草稿使用共享工作区的版本、编辑租约、冲突分支及持久 APPEND 操作标识，支持两向创建、编辑和丢弃；源端缺失经再次核对后才移出活动草稿，并保留 tombstone。替换或丢弃 Gmail 草稿将明确原件移入 Gmail Trash，禁止套普通目录的备份 APPEND 和删除，以免复制或永久删除。已有只读草稿投影按 Gmail 身份原位接管，不创建第二份草稿。

SMTP 由 Gmail 自动保存已发送；回收时按账号、Message-ID 和解析原文身份关联原记录，Gmail 从不进入通用 Sent APPEND。回执未知可由唯一源端 Sent 原件结清同一记录；保留更新后的草稿，不盲重发。已发送列表和原件证明分别保留，不因目录标签副本重复展示。

### 验收

`product/test-gmail-sync.py` 与正常 CI 覆盖同一身份多标签、双方状态、快速反向、丢失移动回执、新 revision、跨账号归属、无定位待办隔离、登录后能力以及禁止 EXPUNGE/Sent APPEND；Node 产品回归验证收集器、状态责任和工作区接线。真实验收使用隔离数据库与显式写入 Guard，在写入层限制为既有获准验收信和自用合成草稿，先验证 Guard 进入工作区及状态两条实际路径，禁止其它原件写入。使用真实存储和 SQLite Row 重放“先从 Trash/聚合目录看到旧草稿、从来源只读升级”的迁移；原件存在不能证明 Draft 角色仍在，经过共享缺失确认后留 tombstone，禁止重发旧草稿。分别完成双方已读/星标、删除/恢复、草稿两向更新/丢弃、延迟确认及已发送去重，结束恢复验收信。外发探针仍须单独授权，既有探针不重发。

## Refresh re-entry, reading intent and attachments

A refresh is one operation across all contacts. At the list top its first
cancellable downward move remains reserved while a request is pending. Repeated
pulls keep that operation and its waiting position; they neither start another
request nor settle the existing feedback. Upward pans and an already scrolled
list retain native scrolling. Completion, failure, cancellation, navigation,
blur and the next contact are separate lifecycle branches.

The indicator belongs to the active list's stationary content clip, beside its
translated content, rather than a fixed element positioned using a cached
viewport coordinate. Cache restoration and list replacement transfer that same
indicator to the active clip. Header identity and native scroll ownership remain
unchanged. The header and first content node must both be measured during
pending re-entry; checking a single completed pull is insufficient.

The list selection acknowledges the latest click synchronously. Received and
Sent readers use the shared row selector before requesting detail, and retain
the target through a loading failure and retry. Read/unread remains confirmed
by its own data operation. A late detail response or failure cannot change a
newer target. Contacts and draft previews preserve their existing immediate
selection semantics.

Received, Sent and draft readers share one attachment renderer after the body.
File name, known size and availability belong together; download is the main
action and received-file deletion is a separate secondary action using the
existing confirmation. Long names wrap within the file row; unavailable original
metadata remains visible without a false download link. Compose upload controls
keep their editing role.

The maintenance fixture's `/feedback-review` runs controlled slow detail reads,
rapid target changes, failure/retry, twelve pending refresh contacts, fixed-header
and local-anchor geometry, and refresh failure/retry. First run against the old
product, then the exact candidate bundle. Source events establish controller
ownership; native scrolling and physical Safari input are separate evidence.
`npm test` covers the native first-move model, pending re-entry, cached clip
transfer, current-intent selection and the actual delivered icon set.

References: [Ionic refresher lifecycle](https://ionicframework.com/docs/api/refresher)
and [Gmail's attachment placement](https://support.google.com/mail/answer/30719).

### Body and attachment presentation

The shared body controller owns the initial layout transaction for Received,
Sent and draft preview HTML. Pending body geometry uses an inline placeholder;
attachments remain out of layout until the same task commits the fitted body.
Failure settles its error/retry surface and exposes independent file downloads;
retry starts a new pending transaction. Plain text does not wait for an iframe. Fast HTML reads keep the waiting
placeholder invisible; slow reads reveal it on the existing feedback clock.
Disposal prevents late frame work from changing another reader.

The maintenance fixture `/reader-paint-review` samples from intent through body
source, fitting, reveal and stable frames. Use `MAIL_FIXTURE_PAINT=1` with
JOURNEYS/CONTROLS/DENSE for short HTML plus files; omit PAINT for long HTML.
Cover cold and cached opens, body failure/retry, rapid switching, Sent and draft
preview at desktop/390/320 widths. A final screenshot or a text-only attachment
sample cannot prove this asynchronous layout handoff. Keep old-source failure
and exact candidate results, then inspect pending and settled screenshots.

### List boundary lifecycle

The maintenance fixture's `/scroll-review` compares a signed overscroll rendering
model against the previous product before the candidate. It covers scroll down,
return to the top in a native-owned contact, continued pull, fresh-contact refresh,
repeated pending pulls, failure/retry, short/empty directories, cache re-entry and
viewport identity through refresh. The header must be outside the scrolling
subtree, not merely sticky inside it. Browser-native scrolling records actual
trusted input and offsets separately from synthetic touches and the rendering
model. `MAIL_FIXTURE_JOURNEYS=1` is required for controlled read faults.

The page/content split follows Ionic's [content host and inner scroll element](https://github.com/ionic-team/ionic-framework/blob/main/core/src/components/content/content.scss).
Only Mail's layout ownership changes; the existing native scroll and refresh
controllers remain in use.

## 浏览器动效与性能 CI

工作流按同分支取消已被替代的候选，main 检查及串行开发渠道发布保留。npm 缓存只保存按锁文件区分的下载缓存，每次仍执行 `npm ci` 重建依赖；不缓存 `node_modules`，也不减少双引擎场景或放宽预算。

`npm run test:browser -- --project=chromium`（或 `webkit`）运行产品自身的合成工作区，无需私人装配、登录、真实邮件或发信权限。先执行 `npx playwright install --with-deps chromium webkit`；CI 依赖使用锁定版本。`test/browser/scenarios.mjs` 是唯一场景清单，维护技能从本产品加载同一夹具与测量器。

每次 PR、main 提交和手动候选检查运行 Chromium 与 WebKit。每个任务单 worker、无自动重试、总时限十二分钟。场景覆盖局部渲染/一帧预算、最终触点、快滑反向/取消/重抓、刷新回顶/等待/失败重试、慢阅读与迟到响应、正文和附件同次提交、首次返回输入、页面栈、连续使用和二十四轮资源清理；另验 320 深色、390 和桌面排版，以及可信浏览器 wheel 的首次滚动交接。

浏览器读取干净提交生成、散列验证过的发布包；证据绑定该提交与完整文件清单。缺失、超时、仍在运行、空断言或源码不一致均失败。原根节点位移缺陷的注入反例必须被真实测量器拒绝，防止门禁失效。`development` 同时依赖普通检查与两个浏览器任务，任一失败不发布开发渠道。

性能与逐帧轨迹场景关闭 trace，其他场景的操作/网络 trace 也关闭 DOM 快照和截图采样，记录处理器、rAF、强制样式/布局刷新各自耗时，p95 合计必须低于 16.7ms；同时硬性拒绝根节点运动写入、热路径整表扫描、返回列表重建和资源累计。其它场景失败保留操作/网络 trace 与失败末帧截图，所有结果/HTML 报告保存为私有 Actions artifact 十四天。共享 CI 的帧间隔记录用于定位，不能写成物理 iPhone 的 FPS；新设备/原生系统特有条件才补设备验收，不让日常源码回归反复依赖用户手测。

浏览器安装、单 worker 和 trace 方法沿 [Playwright CI](https://playwright.dev/docs/ci) 与 [Trace Viewer](https://playwright.dev/docs/trace-viewer)。不要给性能场景打开 trace/视频后再放宽预算。

完整 DOM 快照 trace 只用于另行诊断，不用于帧时、几何读取与连续性门禁。WebKit Inspector 的快照会同步读取几何并占用帧，采样器记录调用来源，不能把观察工具的副作用算成产品成本或调低断言。

连续性交接直接测量松手任务前后（允许最终尚未绘制输入的8px内增量），并保存动画关键帧、当前时刻、任务耗时及每个后续采样的真实时间。首个 rAF 可能因共享 runner 或浏览器历史处理而晚到，不能仅凭其位移假定经过16.7ms；后续单调性、隐藏后不重现与独立一帧成本门禁继续检查。

## 产品 CI 与复发缺陷

`test/ci-contracts.json` 维护 Mail 缺陷家族、用户任务、历史证据及实际用例绑定。发生三次及以上或具有复用价值的坑必须转为对应层的永久回归；一次即可复用的也纳入，不等待用户再遇到。共同组件由其产品所有者测试，Mail 对页面接线及完整任务负责。

`npm run check:ci` 核登记有效；`npm run test:ci` 运行普通产品测试并输出 JUnit；`python3 scripts/check-product-ci.py --python test-results/python.json` 运行协议与跟版回归。双浏览器沿 `test/browser` 单一实现执行。最后 coverage job 核本提交、所有实际用例、两个引擎及无跳过/重试；缺项、失败、空报告和来源不符均不发布。不能用有测试文件或某次旧成功代替本次执行证据。`scripts/test-ci-coverage.py` 以损坏、缺项和伪成功报告验证门禁拒绝。

功能/数据/权限/恢复采用契约测试，页面接线/布局连续性/输入采用浏览器测试，渲染和资源预算采用隔离性能场景。不能因一个层通过就省略另一层已暴露的风险。边界随机器清单维护：主观协调、物理 iOS 与真实服务商/设备投递分别留证；CI 没有把它们自动记为通过。Account/公共组件继续保留唯一归属及消费集成门禁，不复制目录与图标库存。
