# 2026-11-07 真实诊断、档案参数与正文约束复验

## 本轮结论

真实Step章节诊断已完成，51.282秒返回完整字段的JSON并落库，未降级。续写耗时由固定0修复为实际测量，本轮真实调用记录54904ms。网页模型档案可设置推理强度和JSON模式；生成面板可填写字数范围、必含片段，结果卡显示实际检查结论。

接入链路通过不等于小说质量通过。快速生成567字，低于700–900字，已明确标为未达标；另一次均衡生成在草稿请求120秒取消，未创建正文版本。对快速稿另行显式续写259字后共826字，通过字数与指定片段检查，仍有推断过强等质量问题。本轮停止追加渠道调用，不把反复尝试挑选的结果当稳定成功率。

## 原始证据与最小对照

沿用用户已配置的同一OpenAI兼容渠道和Step模型、本地PostgreSQL、专用验收项目。未访问其他组织队列，未覆盖前两轮正文。新增第3/4章分别留存快速约束稿、均衡失败记录。

1. 原诊断同提示词增加reasoning_effort=low：95.586秒、HTTP200、无最终正文；finish_reason=stop也不能代替内容验收。
2. 明确styleDrift评分方向、限制建议长度，并添加response_format=json_object：43.882秒、HTTP200、622字符可解析JSON。这次同时改变提示词与输出模式，不能单独归因为low或JSON模式。
3. 再经实际resolver→adapter→handler→poller执行诊断：51.282秒、760字符完整JSON、SUCCEEDED且无diagnosticDegraded。
4. SDK真实本机HTTP回环核对请求payload确实有reasoning_effort/response_format，旧请求没有这两个可选参数。

以上请求均不读取模型隐藏推理作为产品结果。仅正式message.content进入诊断解析和质量判断。

## 修复内容

- ModelProfile既有temperature/topP/maxOutputTokens此前未进入runtime请求。现在应用合法档案值，调用方显式参数覆盖默认值，输出上限取档案和步骤较小值；原取消、超时、重试选项保留。
- ModelProfile.settings只读取reasoningEffort=low/medium/high及jsonMode布尔开关，不透传任意JSON到SDK。设置页新建/编辑可保存两字段，编辑保留已有settings其他数据；POST/PATCH验证类型、拒绝数组假冒枚举。
- 只有档案开启jsonMode且任务声明结构化输出时才带response_format；plan/review/extract_memory及诊断声明JSON，draft/revise/continue保持纯文本。旧档案默认不开启，Anthropic适配器保持原协议。
- 诊断提示词明确readerScore/hookStrength/pacingScore越高越好，styleDrift=0无漂移、100完全偏离，越低越好；不能把梗概未落地事件当正文事实。`{}`、缺字段、错误类型标为diagnosticDegraded，保留现有兼容的分数截断；不从空对象制造“完整评分”。
- 诊断调用前保存步骤快照；异常时步骤FAILED/finishedAt，原错误上抛保留poll重试分类。真实均衡失败又暴露生成步骤遗留PENDING，补同类收尾并以真实DB回滚夹具验证；历史失败步骤不篡改。
- 续写实测generate前后耗时写usageEvent，原正文前缀和版本语义不变。
- 新增可选qualityConstraints：minChars/maxChars为1–20000整数且有序，requiredFacts最多10条、每条1–100字符。UI→请求→API校验→plan/draft/review/revise贯通，计数复用computeWordCount。
- 生成结束保存qualitySummary：实际字数、长度是否通过、缺失精确片段；未达标仍保留有价值的正文和AI版本，卡片明确显示未达到要求。均衡模式将确定性的字数/片段问题加入已有revise步骤，最多一次、受原预算限制；快速模式保持不修订，不增加隐式重试。

## 真实任务回执

| 任务 | job ID | 结果 | 数据库/内容证据 |
|---|---|---|---|
| 诊断原895字章节 | `171877e7-863b-4a1a-ad60-8856340129e9` | SUCCEEDED，51.282s | 诊断step成功；输入1020/输出1919；完整JSON，未降级；原正文与版本未变 |
| 快速生成带约束 | `cdf2fd0a-3769-4888-a5be-dd5ad3cd9c40` | SUCCEEDED，质量未达标，170.854s | 567字；AI版本1；输入1645/输出7531；三个指定片段均存在，但长度失败 |
| 均衡生成带约束 | `54068561-bb92-45ec-a6ac-27f151102c8f` | FAILED，165.631s | 规划45.288s成功，草稿120s取消；0正文/版本/usage事件；失败前规划用量保存在独立回执 |
| 显式续写快速稿 | `77d3c824-7615-4524-a3cf-7792601b2049` | SUCCEEDED，55.058s | 追加259字，共826字；原文逐字保留，AI版本2；输入582/输出2547；usage耗时54904ms |

四任务均attemptCount=1；共6次任务内模型请求，无SDK/任务重试。另有上述两次直接探测，总计本轮8次外部chat请求。三条成功usage合计输入3247/输出11997 tokens，不包含探测及失败请求可能产生的供应商计量。成本价格未知，继续保留null。

Step诊断给原895字样本readerScore87/hook88/pacing84/styleDrift12，能指出监控证据不充分等问题；但分数是同渠道模型意见，并非独立质量真值。真实快速稿已出现“死亡时间”和保安争夺冲突，寄件人来自明天也明确；续写把时间与当前日期具体化，但“只能是明天的自己”“终于确定谋杀”等结论仍早于充足证据，需作者审改。精确片段检查也无法排除否定/误用，只作可复现提示。

## 验证与实际边界

- 回归先RED后GREEN：诊断完整性/错误步骤、评分方向、档案参数、续写计时、正文约束传递/落库及一次修订触发、API新设置校验。
- 单测最终1029 passed + 1 skipped：db21/shared67/model-adapters50/worker260/web631。最终代码全量重跑通过，worker完整260项与全工作区typecheck复核通过。
- typecheck5/5；生产构建通过。
- 真实SDK本机HTTP回环7项通过，包含取消/超时/503不重试及JSON/推理强度payload，不使用外部模型。
- 真实PostgreSQL故障夹具：注入timeout，真实handler/poller写job FAILED、step FAILED/finishedAt、0版本，整个夹具事务回滚；不冒称真实外部超时复验。
- 浏览器完整回归3 passed + 1 skipped，演示模式、进程级覆盖，不改四份私有real配置。验证新设置保存与回显、无效字数界限阻断、两行片段输入、生成结果提示及既有业务。首轮仅smoke定位到Next自身alert而失败，改精确筛选后smoke通过，再完整回归通过。
- 最终真实DB只读核对：新诊断未降级，快速稿qualitySummary=false；续写前缀/两个版本/current一致；均衡失败0新版本；826字按同规则重检通过。
- 组织model:preflight ready=true/issues=[]；无schema/迁移。真实常驻服务需重启读取本地real模式；e2e服务均已结束。

本轮没有证明均衡生成可用、渠道长期稳定、GLM完整任务或独立供应商评审可靠。原失败作业及旧步骤状态保持历史证据，不通过改数据库把它们变绿。普通生产请求的默认超时/重试不在本轮改动，120秒是验收runner的限制；应用预算仍不是供应商累计计费硬上限。

## 可复查材料与下一步

证据目录：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-napi-followup-8cdaa36e`，包含提示词/正式响应、任务/版本/用量回执、失败收尾DB夹具、日志和SHA256清单。正文与私有档案快照保存在仓库外，不提交凭据或用户正文。GitHub/Gitee同步的是代码和脱敏报告，不是部署或密钥。

下一步针对渠道响应波动与均衡草稿超时建立少量可重复样本，必要时在已验证供应商能力范围内调整请求配置；正文通过作者修订形成真实对照样本，再做独立评审。不要把单次续写补足长度等同整章一次生成已达标。
## 集成与同步

本轮从干净master=d4df764创建codex/diagnostic-quality；仅提交本任务源码、回归测试和脱敏文档，验证后快进集成master并同步GitHub/Gitee。最终commit/tree、两个远程master哈希及工作区状态回执保存在同一仓库外证据目录。原实验工作树和本地私有环境配置保持原样。
