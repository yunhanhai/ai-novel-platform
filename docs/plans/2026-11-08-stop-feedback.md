# 停止任务反馈与轮询隔离计划

目标：取消响应必须检查HTTP与有效确认，失败可见可重试；冲突立即刷新服务端真实状态，不能伪造取消成功；旧取消/轮询/创建响应及finally不得影响新任务或卸载后的页面。

当前证据：page.handleStopJob只await fetch，无response检查、错误吞掉，stopping共用boolean。useJobPolling仅清timer，未防在途GET与新任务/终态乱序。

设计：停止状态移入useJobPolling，与当前job/请求代际同处管理。每次start建立新scope、清旧timer并取消旧读/停止请求；请求返回逐次核对scope及job。取消只有2xx+success+同id+CANCELLED确认才更新该任务，随后立即读取全量状态保留在途结果；409即时GET真实状态，失败仍显示不能确认的中文提示；401/404/5xx/网络/非法JSON都不改成已取消。停止消息在任务卡片aria alert，重试与新任务清理。取消成功淘汰旧poll，当前终态不被迟到RUNNING倒退。

备选：page只加alert能补报错，但仍存在stopping与轮询竞态；只发取消后等待1500ms会继续误导。选共享hook生命周期，保留现有页面动作/正文行为，不引入全局状态库。

1. 真实浏览器+合成job请求RED：503无反馈、409不立即刷新、有效取消不更新卡片；增加401/网络/非法JSON、重试、旧GET与取消/新任务乱序及旧stop finally。
2. hook/page/AI卡片最小实现GREEN；所有状态变化以服务端确认，测试模拟只验证UI不充当DB证据。
3. 独立复核、完整unit/e2e fake/build/typecheck，沿用上一批真实取消API验收；外部模型0。
4. progress/localization/onboarding/report，提交快进master同步双远程commit/tree/clean，回执外存。
