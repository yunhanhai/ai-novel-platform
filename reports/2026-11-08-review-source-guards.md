# 审校报告可信度与正文来源保护

日期：2026-11-08。基线 `0bb8e7d`，分支 `codex/review-source-guards`。

## 问题与结果

浏览器 RED 两项确认：正文在引用外修改后仍可采纳旧报告；重复引用仍能点击并以 indexOf 替换第一处。worker 原先截断正文前 12000 字，无效模型散文也能被归为通过，报告没有全文哈希，任务完成没有来源/执行轮次/终态保护。

现在 worker 对完整正文审校，上限 20000 Unicode 字符，超限在模型调用前明确失败。严格验证 summary/passed/suggestions 及建议字段，非法 JSON 不生成通过结论；逐字且唯一引用才 verified，重复或不存在的引用保留参考。报告保存 chapterId、sourceSha256、sourceChars。预检范围/RUNNING/attempt，最终锁章后锁 review 任务，核对全文与终态；step 和报告/无效报告拒绝同事务完成。取消、结束或旧轮次丢弃响应，来源变化不自动重试；有效、无效和丢弃响应均记录实际可得用量。提交确认丢失读取最终 step 凭证，错误清理仅触及 RUNNING。

页面异步核对报告全文哈希，章节/正文/任务或组件生命周期变化淘汰旧结果。采纳前组件和父页面同步二次核对全文与唯一引用，只写编辑器并沿现有 CAS 保存；采纳一项后其余建议需重审。发起前 flush 期间改文不提交。历史无来源报告提示重审，不能套用。

## 验证

外部证据：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-08-review-source-cfa15bbb`。

- `browser-red.log` 两项失败；`browser-green2.log` 九项通过：选区外改文、重复引用、跨章相同正文、唯一引用采纳/保存/标签重挂、在途编辑、等待保存改文，以及错误章节/哈希/缺来源。
- `review-worker-red.log` 原实现 30 项失败；修复后 35 项通过，邻近 handler/poll 79 项通过。保留有效 code fence、显式 passed=false 空建议、不存在引用参考、模型失败分类等行为检查。
- `review-worker-db-receipt.json` 实际 PostgreSQL 17 项全事务回滚：合法/重复引用/非法/非法确认丢失/旧截断后的章尾/超限/启动前取消或旧轮次/响应后旧轮次/来源改文/取消/结束/成功确认丢失/存储原子回滚/401/503/目标冲突。用量和重试均逐项核对，真实参考章节与更新时间未变。
- `review-worker-ordering-receipt.json` 两种真实双连接竞争：保存先持章锁，报告来源失败且不重试；取消先持任务锁，报告 SKIPPED 保留 CANCELLED。合成项目 `373928fd-f86e-45b7-a88b-6865fd2abb93` 保留，不删除。
- 独立审查 65 项邻近测试与实际组件受控 6 项通过：旧正文哈希、旧任务哈希、卸载、重复引用直接 handler、唯一采纳来源/反馈绑定、错误章节。审查末尾限流后有限重试取得结论，无阻断；未重复运行已有验证。回执 `independent-review-audit.txt` 和 `independent-review-ui-receipt.json`。
- 完整单测 **1241 passed + 1 skipped**（42/74/50/392/683）；完整 e2e **88 passed + 1 skipped**（fake，6.1 分钟，新增9项）。生产 build、五包 typecheck、凭据排除与 diff 检查通过，日志均外存。

初次浏览器 runner 使用不存在的 test.each 导致收集失败，改为 Playwright 参数循环；首轮 UI 实现局部变量 index 与 map 参数同名导致编译失败，改名后五包类型检查和九项浏览器通过。失败日志保留，没有改时限或放宽断言。smoke 对 fake 散文改为明确期待审校失败，合法建议展示另由合成报告验证。

## 边界

外部模型调用 0；数据库用进程内合成模型响应，浏览器合法报告用受控 HTTP 夹具，不能当真实供应商语义质量证明。未修改真实作品、记忆、模型配置或 schema，没有迁移或部署，e2e 进程级 fake 覆盖后恢复。

单次上限拒绝而不自动分段；引用长度遵循可核对原则，不用模糊搜索猜位置。哈希 ABA、不可变任务目标、在途供应商不能终止、usage best effort 和无外部 HTTP exactly-once 仍是边界。采纳反馈表示编辑动作，不证明服务器已经保存；并发反馈聚合治理不在本轮扩展。

## 集成

验证后精确提交，主 checkout master 快进并同步 GitHub/Gitee，独立核对远端 commit 与两 checkout tree/clean。最终回执外存 `final-git-receipt.json`，旧性能实验保留。
