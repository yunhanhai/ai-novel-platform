# 创建任务凭证与确认丢失恢复

目标：同一尚未确认的逻辑提交重复传输只产生一条任务，确认后再次主动操作仍创建新任务。已完成/失败/取消重放保留原状态和完整结果，不重新排队，不自动发出额外供应商请求。

原始真实PostgreSQL RED：同一requestId重复createJob产生两条不同任务，事务整体回滚，外部调用0。当前UI失败重试无请求身份，POST仅返回id/type/status，已完成恢复会丢output。

设计：可选requestId为UUIDv4；DB以带域前缀的JSON数组(org,user,requestId) SHA256生成UUIDv8，用既有id主键唯一约束避免迁移。带key创建用createMany skipDuplicates后按确定id+org+user读取，核对project/type/profile/target及规范化JSON input（对象排序、数组保序），不同409；无key沿用原单次create兼容。选择ON CONFLICT DO NOTHING式createMany，避免P2002使已有交互事务失效。POST返回完整output/progress/errors/times供终态恢复，目标project补组织与未删检查。

客户端同body未确认提交复用requestId；确定400/401/403/404/409或成功后清key，网络/5xx/非法确认保留。当前在途创建同步拒绝重复动作；新scope隔离已存在。确认成功的下一次操作新key；不自动重试、不本地持久化正文。返回终态完整候选，源快照仍核对，不恢复成新候选。

1. DB/API/client RED：同key一条、参数409、规范化JSON、范围/用户、兼容无key；浏览器确认丢失同key、成功后新key、终态恢复完整结果。
2. 最小实现GREEN，实际DB全回滚+真实并发+实际HTTP重放/冲突/租户，重放不重新执行。
3. 独立审查与完整unit/e2e fake/build/typecheck/secret排除，原始正文/模型配置不动。
4. 更新progress/localization/onboarding/report，提交快进master同步GitHub/Gitee并核对commit/tree/clean，回执外存。

边界：页面刷新丢内存key、改稿后完全相同body重试仍找回原任务、请求去重不等于供应商HTTP exactly-once、无历史任务清理保证。不引入额外数据库迁移或全局去重。

独立审查扩展：确认丢失后改选区外正文仍同body复用旧候选，完成effect需核对worker sourceSha256/chapterId；发起前计算本地快照SHA256并在异步后再次核对请求身份/正文。浏览器stale-source RED/GREEN，保留无hash历史候选兼容。
