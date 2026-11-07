# 2026-11-07 真实模型接入修复与验收准备

## 交付范围

用户选择“先完成接入修复与验收准备”。本轮保持 web/worker 的 USE_FAKE_MODEL=true，不录入或生成业务凭据，不发送外部模型请求，不部署，不迁移数据库。

## 已修复

1. 测试连接先按当前组织查供应商和状态；演示模式也不为外组织/停用供应商返回成功。
2. PLATFORM_KEY 不再强制要求未使用的 ENCRYPTION_KEY；USER_KEY 通过共享 parseEncryptionKey 仅接受恰好 64 位十六进制。Web 保存/轮换与 worker 使用同一解析规则，禁止截断超长值或部分解码。
3. 连接测试的档案查询包含组织，未知 adapter/数据库错误只返回固定提示；补额度、模型不存在、解密失败提示。
4. Worker 显式 modelProfileId 及所有 fallback 查询均限定组织、当前项目或组织默认档案，以及同组织 ACTIVE 供应商。找不到显式档案时沿用组织内 fallback。
5. 档案创建拒绝外组织/停用供应商和外组织项目；路由返回 404。档案和供应商 PATCH 在服务层逐字段白名单，额外 organizationId/providerId/authMode/encryptedApiKey/id/关系字段不会写入；修复已由真实事务与 HTTP 验收。
6. 新增 `pnpm model:preflight` 只读预检：模式、数据库配置一致性、供应商类型/状态、档案、平台密钥存在且一致、USER_KEY 主密钥一致且实际可解密。只输出原因码，不输出凭据、密文、数据库地址。
7. 项目预检先校验归属，包含项目覆盖和组织默认档案；Web 环境在隔离进程调用 Next 的 loadEnvConfig，使用其实际优先级及变量展开，避免与 worker 的 Node --env-file 语义混淆。
8. 接入手册改为先录入供应商→创建档案→预检→测试连接；明确根 .env 与 apps/web/.env.local 两处配置；设置页自动创建 USER_KEY，无不存在的 authMode 选择步骤。初次真实验收使用新建测试作品。

## 验证证据

- 回归先 RED 后 GREEN：PLATFORM_KEY 被主密钥误阻断、非法主密钥、演示越权成功、异常明文、解析越界、PATCH 额外字段注入、预算以外的项目继承预检与平台凭据不一致。
- `pnpm test`：988 passed + 1 skipped（db 21 / shared 60 / adapters 40 / worker 247 / web 620）。
- `pnpm typecheck`：5/5 workspace 通过。与 dev 路由类型生成并发时曾读到不完整缓存；待 dev 结束后复跑通过，不改源码断言或类型限制。
- `pnpm test:e2e`：3 passed + 1 skipped（1.1m，fake）。新增外组织供应商连接失败、档案创建 404、档案/供应商 PATCH 注入字段不生效断言，原生成/连更/审校/预算/设置链路保持通过。
- `scripts/verify-model-readiness.ts`：9 项真实 PostgreSQL 检查通过，含 PATCH 不改归属/认证、创建/解析跨组织边界、项目范围、停用供应商和演示连接归属。整体事务回滚，未留夹具。
- 本地回环 HTTP 契约：真实 SDK 请求本机临时服务 3 次，覆盖 PLATFORM_KEY 无主密钥 ping、USER_KEY AES-GCM 解密 ping、worker resolver→adapter→SDK；认证头/模型名/输出上限均匹配，外部供应商请求 0。它证明协议接线，不证明真实供应商可用。
- `pnpm model:preflight` 实跑 ready=false：WORKER_FAKE_MODE / WEB_FAKE_MODE / WORKER_API_KEY_MISSING / WEB_API_KEY_MISSING。组织无档案范围正确返回 NO_MODEL_PROFILE；只配组织默认档案的项目可以检出继承候选。
- Next 环境加载回归用临时文件验证 `$VARIABLE` 实际展开；同一文本按 Node parseEnv 保留字面值，且未更改父进程环境。

`pnpm build` 生产构建通过。最终提交扫描与远程回执保存在仓库外证据目录；通过后提交同步。

## 新命令

```powershell
pnpm model:preflight
pnpm model:preflight --organization-id=<组织UUID>
pnpm model:preflight --project-id=<项目UUID>
pnpm model:preflight --profile-id=<档案UUID> --json
```

退出码：0=至少一个本地候选就绪；2=配置不足/演示模式；1=参数、文件或数据库失败。ready 只说明本地配置，不验证网络、额度、模型存在或质量；精确验收应指定目标档案，避免其他候选混入。

## 仍待用户配置后验收

需要供应商 baseURL、模型名及本地配置的 API key。保持当前演示配置，待配置齐全再同步切换两进程、重跑预检、重启服务，并在验收作品执行小规模 ping / fast 单章 / balanced / 续写与诊断，记录任务、版本、tokens、耗时和错误。不得把本轮 loopback 或 fake 结果称为真实模型验收。

现有 ping 的 1 输出 token 与供应商最低输出限制是否兼容、SDK 默认重试和 HTTP 取消语义仍依赖实际供应商；配置验收不能代替这些检查。成本预警继续只使用已知用量，不凭空估价；未新增真实质量评分或同模型自评结论。

凭据配置文件原样保留，未写入 Git。e2e 按项目现有模式新增测试账号和测试项目；真实 DB 脚本夹具全部回滚。旧实验工作树原稿保持不变。

证据目录：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-model-readiness/`。
