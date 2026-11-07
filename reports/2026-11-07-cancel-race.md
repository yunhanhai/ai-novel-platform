# 2026-11-07 取消与任务认领竞态

## 结果与原始证据

取消接口现在只对数据库当前QUEUED/RUNNING任务执行条件取消，完成/失败抢先提交时返回409并保留终态、时间、错误和结果。重复取消返回200成功且不刷新原取消信息；组织范围来自session，缺失/跨组织仍404。队列认领核对读取时的任务及租约快照，避免把已取消任务重新置RUNNING，也避免两个worker同时认领同一快照。

route回归RED证实：先读RUNNING，另一执行SUCCEEDED后，旧取消仍无条件改为CANCELLED。claim回归RED证实：先读QUEUED，取消后无条件认领复活RUNNING。原始实际PostgreSQL两项全回滚同样复现，成功output保留但任务被误取消，取消任务被认领attempt1。

## 实现

- 新增cancelGenerationJob helper：组织/id及status in QUEUED/RUNNING一次updateMany，成功即返回CANCELLED；miss只读同组织当前任务，已CANCELLED幂等成功、其他状态invalid_status、无记录not_found。未清理output/progress/lease，以保留在途任务已有正文结果和观测信息。
- 路由复用helper，保留身份401与500错误脱敏，终态400改为409冲突；没有先读后无条件写窗口。重复取消不重写finishedAt、错误信息等。
- claimNextJob的update增加读取时status、attemptCount、lockKey、leaseExpiresAt、nextRunAt条件。竞争丢失P2025返回null，由poll下一tick继续；真实数据库异常继续抛出，不假称无任务。
- 没有引入新锁顺序或全队列锁；普通单job条件写能与现有worker最终保存行锁协作。取消入口变化不等于供应商请求可中断，也不改变各handler取消后的保存约定。

## 验证

1. 路由RED1失败5通过、claim RED1失败21通过，修复后DB文件28项与route7项通过。覆盖活动状态/范围条件、成功失败保留、重复取消、缺失跨组织、认领快照与脱敏错误。
2. 真实PostgreSQL11项全回滚：排队取消、运行取消、成功抢先、失败抢先、重复取消时间不变、外组织拒绝、claim期间取消、claim被另一worker接手、retry时间被更新、正常认领、过期租约正常接手。核对状态、output/progress及attempt，网络调用0。
3. 额外四项真实多连接并发：两个interactive transactions都读同一快照后同时认领，仅1胜/attempt1，败方P2025在交互事务内正常返回null；双取消均成功且时间稳定；一个事务读待认领后另一连接取消提交，旧claim丢弃；完成事务持行锁先成功，另一连接cancel等待后返回invalid_status，SUCCEEDED保留。同步barrier控制交错，没有靠随机sleep推断结果。新建合成fixture保留，未删除业务记录。
4. 完整e2e17 passed+1 skipped（2.4m，process级fake），新增真实HTTP（无route拦截）覆盖匿名401、异组织404、同任务并发双取消200、重复取消时间不变、worker实际失败后取消409且保留终态信息；其他16项浏览器链路全部通过。
5. HTTP首次夹具创建后被worker先处理，正确返回409却与测试期望取消成功冲突；改为DB创建nextRunAt延后一小时的合成QUEUED任务固定状态。第二次runner尚未加载DB环境变量，出现SASL连接错误；测试读取本地env后动态初始化DB，单项与完整重跑通过，未改产品或延长时限。完整失败日志保留。
6. 全量1163 passed+1 skipped（db40/shared67/adapters50/worker364/web642），typecheck5/5、生产build、diff check通过。独立只读无阻断，DB28/route7通过，建议的interactive transaction真实竞争已补上述4场景。
7. 配置密钥排除扫描通过，私有env保持ignored。无外部模型调用，无schema/迁移/依赖版本/部署/供应商配置改动，既有真实正文/记忆未修改。

## 限制

取消先提交后在途生成正文仍可能保存，保留取消状态；不同分析/候选handler可选择丢弃，这是既有约定。取消接口不负责终止已发出供应商请求，不承诺费用清零，也未全面验证全部13类handler的在途交付。

认领竞争输掉时本tick返回无任务，可能多等一个poll间隔；没有引入SKIP LOCKED或吞吐压力结论。两worker条件竞争已实跑，但不是长时间多worker负载验收。完成与取消以数据库提交及条件检查顺序为准，不保证用户点击时间优先。

页面停止失败提示、审计新增、跨标签正文版本锁、供应商HTTP exactly-once以及其他worker状态竞态未扩展。真实模型语义和渠道稳定性本轮未重新验收。

## 交付

codex/cancel-race基于24a391a，验证后快进master同步GitHub/Gitee；独立读取两远程master，与两本地checkout的commit/tree/clean核对，最终Git回执外存。原实验工作树保留。

证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-cancel-race-83449325`包含原始RED、11项回滚与4项真实多连接回执、HTTP夹具失败及最终完整e2e、unit/build/typecheck、独立审查、密钥排除与Git回执。
