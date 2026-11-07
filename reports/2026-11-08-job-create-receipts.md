# 2026-11-08 创建任务凭证与确认恢复

## 结果与原始证据

页面创建任务发生网络失败、5xx或非法确认后，再次提交相同参数会复用尚未确认的请求凭证，服务端返回原任务，避免重复排队。成功确认后的下一次主动操作生成新凭证。已完成、失败或取消任务重放保留原状态、进度、结果、错误提示及时间，不重排或再次执行模型。

真实PostgreSQL原始RED：同一requestId重复createJob得到两个不同id、两行任务；事务整体回滚，外部模型调用0。浏览器RED证实未携带任何请求凭证；终态恢复此前也只接id/type/status，候选output不能完整交付。

## 实现

- createJob接收可选UUIDv4 requestId，以域前缀和组织、用户、凭证的JSON数组SHA256派生UUIDv8主键。利用现有主键唯一约束，createMany skipDuplicates后按id/组织/用户读取，不需要schema迁移。使用ON CONFLICT DO NOTHING避免唯一冲突使调用方交互事务失效。
- 重放比较project/type/profile/target和规范化input；对象键排序、数组顺序保留，相同参数返回原任务，不同参数JobRequestConflict→409。读不到对应范围凭证时明确无法确认，不吞成成功。无key沿用原create行为，UUID大小写统一。
- API校验凭证，项目级目标增加当前组织/未删除校验，章节范围沿用；返回output/progress/errorMessage/startedAt/finishedAt，使终态凭证恢复无需虚构新任务状态或丢失候选。
- useJobPolling以body指纹保留当前未确认凭证；成功或明确400/401/403/404/409后清理，网络/5xx/无效确认保留。同步createRef防止一个hook在途创建重入，未自动发送额外重试；错误提示说明同参数可找回任务。
- 独立审查发现确认丢失后修改选区外正文，再找回原候选时页面会误绑定新正文快照。发起前计算完整本地正文SHA256，异步后重核请求/正文；候选完成时核对worker已有sourceSha256及chapterId（存在时），不符则拒绝采纳。保留无hash历史候选兼容，已有本地全文快照检查仍生效。

## 验证

1. DB回归RED2失败28通过，实现后GREEN；真实PostgreSQL10组全回滚：相同key/对象键序一行，input数组/type/target三种变化冲突，SUCCEEDED/FAILED/CANCELLED完整结果重放且handler0模型调用，UUID大小写同id、无key兼容不同任务、同组织不同用户/不同组织隔离、缺失凭证失败关闭。
2. 两项真实多连接并发：同key同时创建仅一行/同id；同key不同参数同时创建仅1成功、1冲突。新建合成任务最终取消，项目/记录保留，未删除原内容。外部模型调用0。
3. 新增5项浏览器：网络/503/非法JSON后的同key重试恢复完整终态候选，成功确认后主动操作新key；确认丢失改选区外正文恢复旧候选必须拒绝；真实HTTP同key并发与终态重放一行、参数409、跨组织章节/项目404及非法key400。HTTP空章节在模型解析前失败，未调用供应商。
4. stale-source浏览器RED先因选区硬编码多选1字符导致参数变化，改为原句.length精准选择后业务RED证实无来源拒绝；source哈希修复后5项全部GREEN。最早网络失败断言先期待中文但原提示为Failed to fetch，改为观察错误可见后取得缺key的有效RED。夹具问题未当成产品成功证据。
5. 最终完整e2e35 passed+1 skipped（3.4m，process级fake）；全量1169 passed+1 skipped（db42/shared67/adapters50/worker364/web646），typecheck5/5、生产build、diff check通过。初次web typecheck发现同步createRef守卫后多余abort被TS推断never，去掉不可达操作后最终全通过。
6. 独立设计核对确认worker未改持久input；初审复现stale候选问题，最终只读复审无阻断，实际effect核对异源拒绝、同源可用、异章拒绝，58项定向测试和diff通过。
7. 密钥排除扫描通过，私有env仍ignored。无外部模型调用，无依赖/schema/迁移/部署/供应商配置改动，既有真实正文和记忆未修改。

## 边界

凭证在当前页面内存中，仅保留最近一份未确认body；刷新/离开页面或切换到不同参数会失去该凭证，未引入跨页面历史恢复或浏览器持久化正文。确认前修改正文但请求参数仍相同，会找回原任务，候选source哈希不符时必须重新发起，不重新运行旧任务。

无key旧客户端不具备去重保证。主动新操作、不同key或不同用户仍可创建独立任务；本轮不全局合并内容相同任务。删除任务后凭证不再存在，未建立独立保留周期。规范化默认参数跨版本变化可能产生409，避免隐式重置旧任务。

这保证同凭证创建唯一任务，不保证供应商HTTP exactly-once或任务执行重试零费用。已完成候选还需作者审阅语义、信息量和文风；真实模型质量与渠道稳定性本轮未重新验收。

## 交付

codex/job-create-receipts基于a345a4f，验证后快进master同步GitHub/Gitee；独立ls-remote核对两远程master与两本地checkout的commit/tree/clean，最终回执外存。原实验工作树保留。

证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-08-job-create-d13c4f53`包含原始DB/浏览器RED、10组回滚与2并发回执、来源哈希红绿、实际HTTP与完整e2e/unit/build/typecheck、独立审查、密钥排除与Git回执。
