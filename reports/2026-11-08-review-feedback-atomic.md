# 审校采纳反馈的精确与并发保护

日期：2026-11-08。基线 `ade2ce9`，分支 `codex/review-feedback-atomic`。

## 问题与结果

实际 PostgreSQL 使用原反馈 route 复现：两个请求都返回 200，整份 output 先读后写导致最终只留一条 applied；两项建议引用相同时，请求第二种改法仍标记第一项。原接口无任务完成类型/来源凭据校验。

现在页面在编辑器同步采纳成功后发送捕获的任务、chapterId、sourceSha256、suggestionIndex、quote、replacement。服务先认证会话并验证 JSON，事务中按组织锁任务，核对 REVIEW/SUCCEEDED/CHAPTER 目标及报告来源；精确序号/原文/改法/verified 全部一致才更新。只给对应建议添加 applied=true、appliedAt、appliedById，保留其他输出与任务字段。重复请求不写入，保留首次用户和时间；旧 applied=true 无元数据仍保持未知，不伪造历史。

浏览器验收另发现：审校成功后无谓刷新正文，立即采纳会与迟到旧正文 GET 竞争，触发假冲突。增加独立 RED 验证成功时的多余读取，再排除 REVIEW 的成功刷新；审校本就不写正文，采纳后仍沿正常 dirty/CAS 保存。

## 验证

原始证据位于 Git 外：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-08-review-feedback-e4aad568`。

- `db-baseline-red.json`：实际原 route、两条并发200仅保留一条、同引用第二建议错标第一；事务夹具全部回滚。
- `feedback-route-red.log`：原接口 11 项失败；服务 helper/API 修复后 46 项通过。
- `browser-red.log`：页面缺少精确凭据失败；`browser-green.log` 修复后通过。首次整合 `browser-feedback-green.log` 11 通过、1 失败，反馈本身已200，立即采纳保存提示失败；`review-refresh-red.log` 确认多余正文读取，排除 REVIEW 刷新后 `browser-feedback-green2.log` 12 项通过。未放宽时限或删除断言。
- `independent-feedback-db-receipt.json`：独立实际 PostgreSQL 27 项，包含同引用多建议/字段全保留、重复无更新/首次用户时间、旧标记未知元数据、大小写哈希、组织和任务状态/目标/来源/建议凭据、异常 output、写后故障回滚、双连接不同建议全保留、同建议共享首次元数据，以及先持锁提交后第二连接读到最新反馈。
- 单事务合成夹具回滚；多连接合成项目 `70aa2d9c-bb2f-4358-9a47-e108626be4a8` 保留，不删除。真实参考章与来源记忆未变，模型调用0。
- 浏览器及真实 HTTP 覆盖无凭据400、无身份401、跨组织404、错来源/改法409、缺序号404、并发/重复反馈，以及从页面采纳同引用的第二种改法，真正写反馈且正文正常保存。
- 独立界面受控验证9项通过，另有1项明确标注静态接线检查；服务/API独立46项通过，无阻断。完整单测 **1282 passed + 1 skipped**（42/74/50/392/724），完整e2e **91 passed + 1 skipped**（fake，6.6分钟，新增3项真实反馈验收及既有采纳凭据断言）。生产构建、五包typecheck、凭据排除与diff检查通过，原始日志外存。

## 范围与限制

反馈是作者采纳到编辑器的动作信号，不是服务器保存证明，也不是对模型语义的背书。页面请求仍为尽力发送，没有跨刷新持久队列；丢确认后相同凭据可安全重试，但页面不承诺自动找回。记录按建议共享首次动作，不统计每位作者的全部点击。

新反馈 API 要求完整凭据，旧 quote-only 请求400；历史无来源报告需重新审校。哈希只验证报告来源，不核对当前数据库章稿；作者可能已经编辑或保存新稿，这不会撤销已经发生的采纳动作。未增加 schema、迁移、部署，未修改 provider 或真实作品/记忆；e2e 进程级 fake 后恢复，未调用外部模型。

本轮仅排除 REVIEW 的多余成功刷新，其他任务成功刷新、通用离线反馈和采纳后撤销统计不扩展。

## 集成

验证通过后精确提交，主 checkout master 快进并同步 GitHub/Gitee；两 remote 独立 commit 与两 checkout tree/clean 外存 `final-git-receipt.json`，旧性能实验保留。
