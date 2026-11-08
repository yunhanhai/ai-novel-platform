# 四类章节诊断的可信度与来源保护

日期：2026-11-08。基线 `329583b`；分支 `codex/diagnostic-source-guards`。

## 结果

原诊断 handler 只发前8000字，散文/缺字段/越界分数仍可成功并补零或钳制。页面直接展示诊断摘要，没有当前章全文校验。浏览器 RED 证实改文或切到相同正文的另一章仍显示原评分。

现在四类诊断完整读取最多20000 Unicode字符正文，超限调用前明确失败；严格 JSON、四项0至100整数、风险枚举与建议/连续性问题字段，不把无效模型响应当评分。报告带 chapterId/sourceSha256/sourceChars/diagnosticType，并保留质量模式、性能摘要和作品梗概/风格/章节大纲提示上下文。

worker 预检范围/类型/RUNNING/attempt，锁章后锁对应类型任务，核对全文、状态与轮次；报告或无效输出拒绝与最终 step 同事务。取消、结束、旧轮次丢弃，正文变更不自动重试；实际可得用量包含无效和丢弃响应。最终 step 凭证恢复提交确认丢失，清理仅 RUNNING，保留原模型/存储错误分类。

页面异步核对全文hash，正文/章节/任务/输出变化或卸载后淘汰旧核对；非成功、缺来源、类型不符或旧降级摘要不展示评分。诊断准备先flush，等待保存改文不提交；只读诊断完成不再刷新正文。任务性能保持为历史记录，评分明确为审阅参考。

## 验证证据

原始证据在 Git 外：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-08-diagnostic-source-f0f53b4f`。

- `browser-red.log` 两项原行为失败；初次 `browser-locator-error.log` 是div无region角色的定位器错误，改用实际aria-label后复现成功。
- `browser-green.log` 九项通过，覆盖改文/切章/来源缺失或不符/非成功不展示、合法参考评分与性能、无多余正文GET、等待保存改文及标签重挂。合法报告为受控HTTP夹具，非真实模型。
- `diagnostic-worker-red.log` 原实现39失败5通过；新增枚举数组的二项RED后显式拒绝非字符串枚举，最终46定向与108邻近通过。
- `diagnostic-worker-db-receipt.json` 实际PostgreSQL21项全事务回滚，涵盖四类合法结果、非法/越界/数组枚举、原截断后章尾、20000Unicode边界、取消/旧attempt预检、响应后终态/来源、成功与拒绝确认丢失、原子写失败、401不重试/503重试、目标冲突。
- `diagnostic-worker-ordering-receipt.json` 实际不同连接2项：正文写者先持章锁使报告来源失败；取消先持任务锁后报告SKIPPED且保留CANCELLED。合成项目 `d64250fc-d09d-4a2b-a821-fb16c5211951` 保留，不删除。真实参考章内容与更新时间未变。
- 独立审查95项worker测试与实际DiagnosticReport受控10项行为验证通过，另1项静态接线检查。覆盖迟到旧哈希/旧任务/同任务变output/卸载/四类型/非法分数来源状态，无阻断。独立未重跑实现者DB脚本，分开记录在审查报告。
- 首轮typecheck暴露accepted空值判断，显式核对accepted后五包通过；首轮全单测发现旧usage夹具用DESLOP任务调用诊断且无效payload，改为正确类型/合法报告并核对事务内成功；未放宽产品校验。最终单测 **1316 passed + 1 skipped**（42/74/50/426/724），完整e2e **100 passed + 1 skipped**（fake，7.8分钟，新增9项），生产构建、五包最终typecheck、凭据排除与diff检查通过，原始日志外存。

## 边界

外部模型调用0，数据库使用进程内合成响应，fake e2e不能证明语义评分质量。评分不是实际读者行为测量；连续性判断仅基于本次输入上下文。正文hash不检测ABA，标题/梗概/风格/大纲为调用时快照，本轮未对这些字段建立版本锁。

超限拒绝而不自动分段。取消不终止供应商在途请求，usage尽力记录，无外部HTTP exactly-once。旧无来源诊断需重跑，任务历史性能仍可见。保留生成任务深度模式诊断排队，不扩展其他报告类型或性能统计口径。

未改真实作品/记忆/模型配置/schema，无迁移部署；e2e进程级fake覆盖后恢复。验证完成精确提交并快进master，双远程独立commit及两checkout tree/clean回执外存 `final-git-receipt.json`，旧性能实验保留。
