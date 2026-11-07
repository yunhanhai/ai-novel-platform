# 2026-11-07 改写润色 worker 候选完整性

## 结果与原始证据

改写、润色后端现在先核对范围任务的RUNNING与attempt，最终锁定来源正文和任务后保存候选与步骤。旧轮次、取消或其他执行已完成时不采用迟到候选；来源正文变化直接失败，避免对新稿提供过期候选。候选仍只返回页面，正文、版本和记忆不会自动改写。

原始真实PostgreSQL RED复现：attempt1响应覆盖attempt2的output并标成功；正文已变仍成功；另一执行已成功的output被迟到候选覆盖；启动前CANCELLED仍调用模型。四项均0steps/0usage。合成模型返回，事务整体回滚，外部调用0。

## 实现

- 范围组织/项目/jobType的当前任务预检，不在RUNNING或attempt不符直接退出，连模型解析都不执行。先核对章节存在、所属范围与选文，再解析模型；目标章优先于input章，保留没有目标时的旧input兼容。
- 新建选文改写/选文润色RUNNING步骤；模型返回记录实际耗时、tokens和用量，包含空白及后来被丢弃的响应。复用现有best-effort计量，不将计量故障反转为重复模型请求；供应商抛错未返回计量时不虚构tokens。
- 来源章→范围任务行锁，核对当前RUNNING/attempt与完整来源正文；step及候选output同事务成功，保留mode/selectedText/newText，增加chapterId/sourceSha256。取消、已结束、新轮次响应将本step记SKIPPED，不改现有job结果。
- 空白文本同事务step/job FAILED EMPTY_OUTPUT，不自动重试。来源冲突使用CHAPTER_SOURCE_CHANGED，保留原文并立即失败不retry。其他401配置/503临时等异常保持原poll分类。
- catch检查本次同组织/job/step的成功、失败或跳过终态凭证，保护事务已提交但确认丢失。不存在凭证或读取不可用时，清理仅更新本次RUNNING step并抛原异常，不降级已成功步骤。poll对REWRITE/POLISH错误终态加RUNNING+attempt条件。
- 时间线增加“选文改写”“选文润色”中文标签，浏览器完整fake闭环核对实际step已完成；页面来源快照保护沿用上一批。

## 验证

1. 单测RED为9失败10通过，涵盖启动取消/结束/旧轮次、在途状态变化、来源变化及用量缺失；实现后定向3文件39项通过，保留原提示、指令、范围/目标解析、空文本、清理保留原认证异常与计量失败不损坏结果等回归。poll覆盖DESLOP/REWRITE/POLISH条件。
2. 实际PostgreSQL14项全回滚：合法润色/改写、启动取消/旧轮次0解析0调用、在途旧轮次/取消/另执行成功保留、正文变化0retry、空白FAILED但1usage、成功确认丢失、空白失败确认丢失、结果写故障savepoint回滚step/output后正常重排、401不retry、503正常retry。每项核对无AI内容版本/记忆产生，正文保持原样（来源冲突保留人为新稿）。均实际handler/poller/DB，外部调用0。
3. 独立只读审查3文件35项通过无阻断，建议补充空白ack及存储回滚，已纳入实际DB；之后新增poll双类型及用量回归，最终定向39通过。数据库验收脚本初版缺闭合大括号，修正脚本后完整运行，未修改产品来规避断言。
4. 全量1154 passed+1 skipped（db33/shared67/adapters50/worker364/web640），typecheck5/5、生产build、diff check通过。完整e2e16 passed+1 skipped（2.0m，process级fake），含上一批9项页面/保存竞态、原smoke润色候选采纳及新步骤状态断言。
5. 密钥排除检查通过，私有env仍ignored，无依赖版本/lock/schema/迁移/部署。既有真实章/记忆与供应商配置未修改，无新外部模型调用。

## 限制

启动预检不是实时终止供应商请求：检查后发生取消时已启动响应仍可能返回并产生用量，最终丢弃候选。逐字来源核对不能检测ABA，也不保护设定/章纲在请求期间的变化；保存之后作者改文仍由页面快照核对。

计量为best-effort，故障时警告，不能承诺完整账单；供应商错误未返回tokens不虚构消耗。结果写故障或凭证持续不可读取时沿原错误重试，不保证HTTP exactly-once，多worker压力未验收。没有新增跨重试历史候选复用、供应商取消、取消API迟到写防护或跨标签正文版本锁。

本轮证明状态、来源与保存契约，未重新调用真实模型，不能证明候选语义、风格与信息量等同要求已经满足。

## 交付

codex/rewrite-worker-guards基于dfccc29，验证后快进master同步GitHub/Gitee，独立ls-remote核对两远程与两本地commit/tree/clean，最终回执外存。原实验工作树保留。

证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-rewrite-worker-57e218d7`包含原始DB RED、单测RED/GREEN、14项DB回执、完整验证、独立审查、密钥排除及Git回执。
