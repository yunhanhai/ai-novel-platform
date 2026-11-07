# 诊断与生成验收修复计划

> **For Codex:** 执行现有接入验收方案，采用先失败后修复、有限真实复验。用户“请继续”沿用上一轮质量/诊断修复与同步授权。

**Goal:** 完成可解析真实诊断，修复失败步骤/续写计时，令章节任务携带可验证的长度与事实约束。

**Architecture:** 复用ModelProfile.settings保存可选推理强度与JSON能力开关。只有请求声明JSON且档案开关启用时透传response_format；正文生成保持纯文本。生成约束显式传入plan/draft/review/revise并在落版本时报告确定性达标情况，不自动追加模型调用。

**Alternatives:** 只延长超时无法解决空正文；全局强制JSON会影响正文和不支持的渠道；采用档案选择启用+任务声明，兼容旧档案。真实low-only探测HTTP200/正文为空，JSON模式探测43.882秒返回有效JSON，仅视为单样本证据。

## Task 1: 诊断诚实性与耗时

- 测试diagnostic {}、残缺字段应diagnosticDegraded=true；异常后step FAILED/finishedAt；提示词明确漂移分0最好、100最差，区分梗概与正文证据。
- 模型调用之前创建步骤并保存快照，异常清理仅该步骤并原样上抛，保护原有poll重试分类。
- 续写从实际generate前后计算latencyMs；测试注入Date.now递增，不用脆弱睡眠。

## Task 2: 模型档案参数

- types/OpenAI adapter增加reasoningEffort与responseFormat；SDK回环验证实际payload，旧请求不带额外字段。
- runtime读取档案temperature/topP/maxOutputTokens/settings，仅白名单推理强度与jsonMode；保留调用方取消/重试，max输出按档案及步骤取较小值。
- 设置表单与POST/PATCH允许设置推理强度、JSON模式开关，旧字段保留。JSON请求标记仅用于结构化步骤；诊断显式请求JSON。

## Task 3: 生成质量约束

- generation job input可选qualityConstraints={minChars,maxChars,requiredFacts:string[]}，有限合法输入，无约束时不改变历史行为。
- 约束传入模型全过程；字数按computeWordCount，事实通过精确片段检查，只是确定性提示，不是语义正确证明。
- 最终qualitySummary含字数/缺失片段/passed，未达标保留正文并明确警告，不偷偷多次重试或伪造通过。

## Task 4: 验证及交付

- 定向RED/GREEN；全量单测、typecheck、build；适当回环/真实数据库检查。
- 专用测试项目新建空章，Step小规模真实诊断、生成、续写；单次120秒/SDK retries0/任务attempts1，有限请求；若外部失败保留失败结果。
- 更新报告、current-progress、本地化plan；凭据/正文保留仓库外，检查后提交、快进master、推送两端并核对远程hash。
