# 取消任务与认领竞态计划

目标：取消只从当前QUEUED/RUNNING转为CANCELLED，不能覆盖并发完成/失败；重复取消幂等且不刷新终态信息；租户范围一致。取消后在途正文保存行为沿用既有约定，不宣称中断供应商。

已见route RED：findFirst取得RUNNING后另一执行已SUCCEEDED，旧update(id)仍改成CANCELLED。队列claim也先读再无条件update(id)，需验证取消后被重新认领的直接相关反向竞态。

设计：取消helper一次组织范围+active状态updateMany，count1返回成功；miss读取当前范围任务，CANCELLED视为成功、不重写时间/错误；其他终态409、缺失404。路由保留session身份/401及统一500。认领按读取的status/attempt/lock/lease/nextRun条件更新，竞争丢失P2025返回null下次tick，不复活取消或重复接手。

备选事务只包先读后写但无行锁仍有同类问题；显式行锁增加持锁开销，本轮条件更新足够。保留原output/progress/lease数据不在取消时清理，避免破坏在途保存与运行时观测。

1. route/claim RED加真实PostgreSQL回滚基线，证明成功被取消与取消被claim复活。
2. 最小helper/route/claim实现及GREEN，验证双取消、完成/失败竞争、租户、真正QUEUED/RUNNING、claim竞争。
3. 真实HTTP验收终态/重复/跨租户/未登录；完整unit/e2e fake/build/typecheck、独立只读及密钥排除。
4. 更新progress/localization/onboarding/report，提交快进master同步双远程commit/tree/clean，回执外存。其他客户端正文版本锁、供应商中断、用户停止错误提示另行处理，不扩大本轮。
