# 批量续写断点与状态计划

原始DB RED：请求2轮，首轮保存后任务已SUCCEEDED；第二轮503经poller自动重试，最终落3个版本（4次合成调用），正文重复追加。

设计：正文、AI版本、批量checkpoint在同一commitFinalize事务提交，含version1/目标章/请求轮数/已完成轮数/追加数/抽取数/告警。中间轮保持RUNNING，完成全部轮及辅助处理后才SUCCEEDED；重试从checkpoint继续。持久化前锁章及job，核对expected已完成数，防同轮重复提交；保留CANCELLED，当前已在途轮可保存后停。

抽取在每轮正文后执行，预先持久“尚未确认抽取”告警，成功/失败后按checkpoint轮次条件更新；进程中断时不重写正文、不假称抽取完成。无checkpoint但同job已存在AI版本的旧任务明确失败保留正文，禁止猜轮次重放。未知/损坏checkpoint同样失败不写正文。

独立RED/GREEN验证首轮RUNNING、第二轮503重试仅剩余1轮、全部正文完成后最终状态写失败不重写、取消当前轮保留、故障事务回滚；真实DB回滚实际handler/poller/版本/用量回执。共享finalize非批量行为沿用。

最后全量unit/typecheck/build/e2e、独立审查，更新progress/localization/manual/report，提交快进master同步双远程hash。不调用外部模型，不改既有真实正文/配置，无schema迁移部署。

完成：1107单测+1skip、typecheck5/5、build、e2e7pass+1skip；原始DB RED/GREEN与9项边界全回滚，独立76项通过。报告`reports/2026-11-07-batch-retry.md`。
