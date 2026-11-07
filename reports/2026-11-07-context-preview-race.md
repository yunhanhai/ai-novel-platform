# 2026-11-07 上下文预览请求顺序与章节隔离

## 结果

上下文预览在预算、排除/强制选项、章节或刷新变化时取消前一次请求；旧请求即使迟到完成，也不能写入成功、错误或loading。切章时临时选择和预览按章节隔离，预算档位继续保留；AI提交选项同时核对来源章节，避免把前一章选择用于新章。

本轮不改服务端上下文选择、worker、数据库结构或模型配置，外部模型调用0。不改既有真实正文及13条记忆，不迁移或部署。

## 原始证据与根因

原ContextComposer.loadPreview没有取消、序号或有效性检查，每次fetch完成都直接setPreview/setError/setLoading。预算切换、章节变化、自动预览和手动刷新可重叠。浏览器控制真实API响应的交付顺序后，修改前RED稳定复现：

1. 精简旧响应在丰富新响应之后释放，预算显示从7000倒退2400。
2. 甲章响应在乙章预览后释放，当前乙章页面重新显示甲章提示词。
3. 旧请求错误在新请求仍等待时释放，旧catch显示错误且finally提前结束新请求loading。

原切章effect先重置本地数组、另一个effect再取预览；同一render闭包仍可能含前一章选项，AI面板也未将选项与来源章绑定。修复按章隔离这一状态边界，避免靠请求返回时序补救。

## 实现

- 复用performance-panel已有的effect scoped AbortController模式，依赖chapter/options/refreshKey；cleanup取消，JSON解析后检查signal.aborted，catch和finally也只允许有效请求写状态。
- 手动刷新仅增加refreshKey，进入同一生命周期；新请求清空旧预览/错误并显示“正在读取本次上下文”，失败后仍可刷新。
- ContextComposer外层保留预算preset，内层按chapterId设React key，排除/强制数组、预览、错误和loading不跨章复用。无章节时不请求。
- AiPanel存储{chapterId,options}，提交前校验来源；回调使用useCallback保持稳定。没有新增依赖、持久偏好或缓存。

## 验证

- 浏览器RED先运行原实现，两项捕获成功/切章覆盖；另单独运行旧error/finally场景确认加载状态提前结束。修复后3项定向GREEN通过，再补取消信号、提交选项和当前错误刷新证据。
- 新增4项真实浏览器用例：旧成功不能覆盖最新预算；旧错误/finally不能影响新请求loading；切章/卸载后旧响应无效且B生成请求选项为空排除/强制；当前错误可见、手动刷新可恢复。
- 测试夹具通过真实注册/项目/章节/记忆API创建独立合成数据，调用真实context-preview获取正文，再故意暂存并忽略abort释放响应。由此同时断言signal确已abort，以及即使传输层不取消也不接受过期结果。新请求signal保持未取消。生成提交检查在浏览器截获后立即返回合成400，不创建任务或调用模型。
- 完整e2e7 passed+1 skipped（1.3m，进程级USE_FAKE_MODEL=true），包含原smoke/settings/观测闭环。新增用例以请求到达、可见预算/提示词、取消信号和两个动画帧等待处理完成，没有用固定sleep假定网络顺序。
- 全量1088 passed+1 skipped（db26/shared67/adapters50/worker305/web640），typecheck5/5、生产build、diff check通过。本轮行为回归重点在真实浏览器，未新增与实现一一对应的模拟hook单测。
- 独立只读审查无阻断项，3个相关文件13项定向测试通过；指出补取消信号证据，已在完整浏览器中加入并通过。审查未修改文件、读取凭据或发起模型调用。
- 凭据排除扫描通过；私有env保持ignored，进程fake覆盖结束后恢复，不提交凭据或用户正文。

## 边界

取消属于客户端请求生命周期，不能保证已经开始的服务端数据库读取立即停止。Next dev在实际取消时可能记录aborted/ECONNRESET；本轮浏览器没有显示这些取消为用户错误，不能将开发日志当模型失败。

本轮不建立预览快照：模型执行前资产内容仍可能改变，预览预算也不替代worker按质量模式的预算裁剪。临时选择仍不跨整页刷新保存，切章会清空排除/强制；同一AI面板内预算保持，离开整个AI面板后沿用既有默认重置规则。无新增真实模型语义或渠道可靠性结论。

## 交付

临时分支codex/context-preview-race基于bd757b1，完成后快进master并同步GitHub/Gitee；独立读取双远程master，与两本地checkout及tree核对，回执保存在仓库外。证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-context-preview-race-051f30fa`含浏览器RED/GREEN/完整日志、全量检查、独立审查记录及最终Git回执。原实验工作树与既有真实验收数据保持。
