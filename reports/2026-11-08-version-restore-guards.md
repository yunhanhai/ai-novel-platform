# 版本回滚正文保护验收

日期：2026-11-08。基线：`a7ebd90`。分支：`codex/version-restore-guards`。

## 问题与结果

实际 PostgreSQL RED 确认：作者选择历史版本后，其他页面保存了新稿，原回滚仍会用历史正文覆盖新稿。原实现虽然快照了新稿，但未阻止已经过期的回滚意图。浏览器 RED 另证实回滚确认前未保存编辑器稿、保存失败时没有阻止回滚。

现在回滚 POST 要求 `chapterId` 和 `baseContentHash`。版本组织和章节范围核对后，章节行锁内核对当前正文；过期异稿返回 409，不写正文、版本或记忆。当前已等于目标则只读取返回，不改时间、不新增快照、不失效新记忆。成功变化时仍在同一事务保留当前非空正文快照并失效来源记忆。

页面在选择回滚时先 flush，成功且来源未变化才展示确认。确认提交前再次检查与 flush；等待期间改文撤销旧操作。回滚已提交后继续写稿，正常 reload 会保留 dirty 稿并提示冲突。列表与对比有请求代际，回滚有组件/章节范围守卫；切章时 key 重挂，旧响应不刷新新章。

## 验证证据

原始脚本与回执在 Git 外：
`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-08-version-restore-5e89d195`。

- `db-baseline-red.json`：真实 DB 过期覆盖复现，夹具全部回滚。
- `server-red.log`：新增 3 项原服务失败；`route-red.log`：新增 5 项原 API 失败。修改后服务/API 19 项通过。
- `browser-red.log`：未先存稿、保存失败无阻断 2 项失败。首轮 GREEN 中 5 项通过，另外 2 项是验收脚本问题：错误提示选择器误命中确认文案、列表请求拦截器未释放。收窄错误提示并等待真实写库、切回前释放拦截器后，`browser-green2.log` 9 项通过；未改产品逻辑或等待上限来规避。
- `independent-db-receipt.json` 12 项与 `independent-db-ordering-receipt.json` 2 项实际 PostgreSQL 验证：冲突零写入、当前稿快照/来源记忆、同目标时间与新记忆稳定、章节/组织/软删范围、已有快照、空白策略、错误哈希、快照后注入失败原子回滚、双连接异目标一胜/同目标单快照，以及保存/回滚分别先持锁两种顺序。
- 事务夹具回滚，多连接合成项目 `d0dc54ad-cee5-46f2-8a61-ab10b01307e8` 保留，不删除业务数据。独立核对既有真实章节内容与更新时间未变。
- `independent-ui-receipt.json`：实际 VersionsPanel 转译受控 hooks/fetch 5 项通过，覆盖同章列表/对比乱序、改文确认失效、卸载后的回滚和准备阶段双击/卸载；两份独立审查无阻断。
- 最终单元测试 **1201 passed + 1 skipped**（db42/shared74/adapters50/worker364/web671）；完整 e2e **69 passed + 1 skipped**（fake，5.5 分钟），新增 10 项回滚浏览器/真实 HTTP 验收；`build-final.log` 构建成功，`typecheck-final.log` 五包通过。凭据排除检查通过，`.env`/web 本地 env 被忽略，`git diff --check` 通过。

## 限制

本轮外部模型调用 0；浏览器以进程级 `USE_FAKE_MODEL=true` 验收并恢复环境，不能当真实模型语义验收。未修改模型配置、数据库 schema、真实作品或来源记忆，没有迁移或部署。

正文哈希不检测 ABA；同目标无副作用是状态幂等，未增加持久操作凭证或 HTTP exactly-once 保证。网络丢确认时可以在原确认中重试；若刷新或远端再次改文，需核对后重新确认。已发出的回滚不会因切章/切页而取消，页面仅隔离迟到响应。

保留原策略：纯空白当前稿不单独快照，目标版本按现有追加接口不可变；历史版本列表仍最多 50 条，回滚快照不套用普通自动保存的 10%/10 分钟节流。未扩展自动合并、全局版本保留治理、跨设备本地恢复。

## 集成

完整验证通过后精确提交本轮文件，主 checkout `master` 快进并同步 GitHub/Gitee；最终 commit/tree/clean 及双远程独立读取记录保存在 `final-git-receipt.json`。旧性能实验工作区保留。
