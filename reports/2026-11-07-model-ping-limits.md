# 2026-11-07 模型连接测试取消与重试边界

## 本轮完成

预检确认配置仍是 web/worker 演示模式且缺少平台 API key，延续用户“先修复接入与验收准备”的范围。没有配置密钥或执行外部模型请求。

原连接测试用 Promise.race 在 15 秒后返回，但没有给 SDK 取消信号；OpenAI/Anthropic 的默认重试也没有关闭。因此显示超时后底层请求仍可能继续、单次 ping 也可能有额外尝试。

本轮修复：

- ModelGenerateOptions 增加可选 signal / timeoutMs / maxRetries，两种适配器均传入实际 SDK 的第二参数，不放入模型消息或请求正文。
- 仅连接测试设置 maxRetries=0、timeoutMs=15000，并用 AbortController 在 15 秒期限取消底层请求；成功或异常均清理 timer。
- deadline 先拒绝固定 PING_TIMEOUT 再 abort，避免取消错误覆盖中文超时提示；SDK 传输超时先发生时也映射为同一提示。
- 普通生成不设置这些新增参数时，SDK 默认行为与现有 worker 重试分类保持原样。

## 验证

1. 适配器第二参数和 ping 取消回归先失败，再修复通过。
2. 真实 OpenAI SDK / Anthropic SDK 对本机临时 HTTP 服务运行 6 项测试：取消信号关闭请求、503 maxRetries=0 仅一次、100ms 传输超时且无追加请求。仅绑定 127.0.0.1；夹具使用固定占位 key。
3. 额外以实际 pingProvider → OpenAI adapter → SDK 请求本机无响应服务，等待真实 15 秒，返回“测试请求 15s 超时”，服务端观测连接关闭且只收到一次请求；无外部供应商请求。
4. 成功后不误触发 abort、timeout timer 清理与 SDK 超时竞态均有断言。Promise.race 持续消费操作的后续拒绝，不产生未处理拒绝。
5. pnpm test：1001 passed + 1 skipped（db 21 / shared 60 / model-adapters 48 / worker 247 / web 625）。
6. pnpm typecheck：5/5；pnpm build：通过。
7. pnpm test:e2e：3 passed + 1 skipped（56.3s，fake），模型设置与原业务流程通过。
8. 独立只读复核未发现阻止合并的问题；复核覆盖 SDK 参数、deadline 竞态和清理语义。git diff --check 通过。

## 边界

取消只控制本地 HTTP 请求，不能撤销已到达供应商的计算或保证停止计费。真实供应商最低 token 限制、网络/余额、生成质量仍未验证。应用没有重新尝试连接测试；普通生成的 SDK 与任务重试不在本轮更改范围。

不修改 .env / apps/web/.env.local、Schema、数据库迁移、真实渠道或旧实验原稿。e2e 仍按项目现有模式在本地库创建测试账号/项目。凭据、正文、依赖与生成产物均不提交。

剩余真实验收条件：用户在本地录入供应商 baseURL、模型名和 API key，使两进程配置一致；预检就绪后再由操作者执行小规模真实 ping / 单章验收。本轮没有用模拟或回环输出替代该结论。

证据目录：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-ping-limits/`。本轮代码、报告提交后集成 master 并同步 GitHub/Gitee；最终 commit/tree 回执保存在该目录。
