# 2026-11-07 批量续写断点与重试

## 结果与原始证据

批量续写的正文、AI版本、轮次进度与用量现在同事务保存。任务在全部轮次结束前保持RUNNING，自动/手动重试从持久断点继续，已经保存的轮次不再从头追加。末轮已保存而最终确认失败时只补终态，不再次调用或解析模型配置。

修改前用真实PostgreSQL及实际handler→poller复现：请求2轮，首轮保存就已SUCCEEDED；第二轮合成503触发自动重试，最终生成3个版本、4次合成模型调用。修复后相同场景首轮RUNNING，最终2个版本、3次调用（包含失败请求），无重复已保存轮次。所有夹具整体回滚，外部模型请求0。

## 实现

- 版本化batch checkpoint保存在现有job.output，包含目标章、请求/已完成轮数、追加字符、记忆抽取计数与warnings；严格校验数值范围、章号目标和结构。恢复同时核对同job AI版本数，不把无记录或损坏记录猜成从零开始。
- 共用commitFinalize仅在传batchCheckpoint时启用批量路径：锁章节及范围job，校验预期已完成轮次与attempt；正文/版本/旧记忆失效/usage/checkpoint同事务提交。中间保持RUNNING，进度最多99，最终状态由batch条件更新为SUCCEEDED100。普通整章/单章finalize路径沿用。
- 取消期间在途正文允许保存一轮，保留CANCELLED及取消原因，不继续下一轮；末轮终态更新也条件限定RUNNING。poll重新排队限定RUNNING和原attempt，迟到worker的终态附expectedAttemptCount，状态helper保护CANCELLED，条件失配读取当前结果而不复活旧执行。
- 每轮抽取前先随正文保存“尚未确认抽取”告警；成功或失败后，按锁后的轮次/attempt/状态更新结果。中断重试不会为了记忆再追加正文，未确认条目保留提示单独抽取。抽取失败沿用保留正文策略，不隐藏已保存产物。
- 批量续写usage.latencyMs改为实际本轮耗时，与已修复的独立续写口径一致；重试前已提交轮的版本与usage不重复落库。
- 历史批量任务若同job已有正文版本但没有合法断点，明确FAILED/BATCH_CHECKPOINT_INVALID，提示核对版本再新建剩余任务；不修改历史正文，也不盲目恢复旧轮次。

## 验证

1. RED先验证首轮事务job.status错误为SUCCEEDED，并用实际DB/poller得到2轮→3版本。修复后GREEN证明2版本/3合成调用，首轮RUNNING。
2. 单测覆盖轮次断点、剩余轮次重试、末轮终态写失败后不解析模型、不重写正文、legacy无断点拒绝；9项checkpoint结构/范围检查；DB helper取消及旧attempt条件更新RED/GREEN。配置类错误仍立即失败，瞬时错误仍由原backoff分类重试。
3. 真实DB9项额外夹具：末轮状态确认模拟丢失后只补终态；取消在途成功后保留1版本且不续写；取消后503不会重排/FAILED覆盖；legacy版本无断点零调用停止；正文轮事务结果返回模拟丢失后重试不重放；抽取结果写入中断后pending可见且正文不重写；同轮重复保存被拒绝；旧attempt失败/requeue/commit不影响新attempt；checkpoint写失败savepoint回滚正文/版本，进度不变。均在实际PostgreSQL外层事务中运行并最终回滚，模拟确认丢失不冒充真实网络故障。
4. 初次真实SQL夹具发现Prisma枚举映射与原始SQL不同，job_type实际为batch_continue、status为小写，已按schema映射修正并重新通过；未修改schema规避错误。随后类型检查暴露可空状态helper返回类型，改findUniqueOrThrow保持原调用契约。新增attempt参数后6项严格集成断言需补该参数，完整重跑通过。
5. 全量1107 passed+1 skipped（db32/shared67/adapters50/worker318/web640），typecheck5/5、生产build、diff check通过。最后仅补终态路径提前到模型解析前后，相关5文件64项及真实DB9项重跑通过，生产build重新验证。
6. 完整e2e7 passed+1 skipped（1.3m，进程级fake）通过，包含两轮batch正文、两条抽取失败提示、版本/失效/设置/上下文竞态；该浏览器不注入供应商故障，重试正确性证据来自实际DB/poller故障夹具。
7. 独立只读复核5文件76项通过，无阻断，diff check通过；确认原子checkpoint、剩余轮次、终态补写、取消及attempt隔离。未读取凭据或调用外部模型。
8. 配置密钥排除扫描通过，私有env继续ignored。既有真实800字章/13记忆及供应商配置未变；无schema/迁移/部署。

## 边界

本轮保证已保存批量轮次不因同job重试再次追加，不保证供应商HTTP请求exactly-once。并发租约仍可能让两个worker先发出相同轮次请求，提交时只允许匹配轮次/attempt；未完成多worker压力或租约续期改造。轮次间允许读取最新正文，在途模型请求期间的人工编辑冲突沿用原规则，不宣称已解决全部正文并发覆盖。

抽取结果未确认时需单独重新抽取；状态PENDING不等于模型没有执行或没有费用。检查使用版本总数，用户清理历史导致断点/版本不一致会安全停止，需要核对后新建剩余任务。旧SUCCEEDED批量任务不会自动重写历史状态或内容。

非批量的单章续写仍有正文提交后的额外结果写入路径，本轮没有扩展其恢复协议。任务进度字段沿用既有“章数”命名，实际为当前章追加轮次；未新增产品流程。

## 交付

临时分支codex/batch-retry基于b7852b8，完成后快进master同步GitHub/Gitee；最终双远程master独立读取，与两本地checkout及tree核对，回执外存。证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-batch-retry-94f12999`含原始RED、真实DB回执、全量及定向检查、浏览器、独立审查和最终Git记录。原实验工作树保持原样。
