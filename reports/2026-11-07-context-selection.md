# 2026-11-07 上下文记忆选择稳定性与恢复

## 结果

上下文记忆标识改用真实ProjectMemory.id，web预览和worker共同生成memory:<id>。用户排除一条记忆后，新条目插入、查询顺序变化或原条目失效不会将该选择转移到另一条。页面新增“已排除”分组及“恢复”按钮，可恢复自动选择。

本轮零外部模型调用，复用现有数据库事务回滚夹具和进程级fake浏览器；不改变既有真实章/13条记忆、供应商配置、章节时序筛选、20条查询及token预算，不做迁移或部署。

## 原始问题与原因

共享memoryAsset原用数组下标mem-0、mem-1作为ID，而web与worker分别在预览和执行时按createdAt倒序查询。预览中排除mem-0后新增一条accepted记忆，执行时mem-0已是另一条，原排除目标重回提示词。最初上下文设计明确要求持久资源具有稳定ID，但映射时没有传递memory.id。

页面虽然收到preview.excluded，原组件却只展示included/available/trimmed；点击排除后目标从已纳入中消失，找不到撤销按钮。真实浏览器RED在点击排除并确认提示词移除后，断言“已排除”分组不可见，复现这一缺口。

## 修改

- shared MemoryInfo要求id，web/worker映射传入实际数据库ID。生成memory:<id>，避免与其他资产ID或旧位置编号混淆；两条同文但不同来源记忆保持独立选择。
- 不为旧mem-N标识猜测对象。旧页面需刷新后重新选择；已排队的旧位置选择不再匹配，其他资产选项保持原规则。这一兼容边界避免将旧选择错移到新对象，未回写历史job。
- UI以既有excluded数据绘制恢复分组，复用排除状态开关，无新增持久化或服务端写操作。恢复是撤销本次排除，仍受现有预算和安全过滤。

## 验证

1. RED实跑：三项共享packet行为回归和一项真实worker handler提示词检查失败；原因分别是稳定memory:<id>无法命中旧mem-N、重排/同文对象混淆、plan/draft仍出现排除内容。修复后42项worker上下文/handler和2项web预览测试通过。
2. 单测覆盖插入、重排、原记录移除、同文不同ID、忽略旧位置ID。web预览断言真memoryID，worker捕获实际plan/draft，目标内容不出现、新条目出现。
3. 真实PostgreSQL四项事务回滚：排除A后新增B，预览A仍排除而B纳入；清除选项后A/B均纳入；实际createHandlers→worker计划/草稿捕获两请求均只含B，job成功；A变superseded后B仍保留，排除不转移。模型为合成响应，外部请求0。
4. 浏览器先运行RED确认恢复入口缺失，再补UI，完整e2e3 passed+1 skipped（1.1m，process-scoped fake）：通过真实API创建/采纳A、实际点击排除、插入并采纳B、刷新确认A排除/B纳入、点击恢复A重新出现。原注册/设置/生成/续写/批量警告/来源失效/版本/移动端闭环通过。
5. 全量1082 passed+1 skipped（db26/shared67/adapters50/worker299/web640），typecheck5/5、生产build及diff check通过。
6. 主智能体复核真实ID从数据库→两端映射→共享packet→options匹配链路、UI恢复动作、生成上下文指纹和已有过滤；本轮未委派独立审查，不将自审描述为第三方证明。
7. 凭据排除检查通过，已配置模型密钥不在Git跟踪/非忽略文件，私有env保持ignored。报告不含正文、API key或密文。

## 限制与下一步

本次选择仍是单次任务配置，刷新整个页面或切换章节按既有规则重置。新抽取生成新的记忆ID，属于新对象，需要重新审核/排除；稳定ID不把旧判断自动套到新摘要。预览与任务执行之间数据库内容仍可能改变，本轮不建立快照或阻止编辑。

记忆仍按createdAt倒序最多20条；附近章节摘要被较晚重抽取的旧章挤占、排除素材对关键词激活的间接作用、跨请求竞态与长章语义质量未作为本轮验收结论。来源章节顺序/失效规则沿用上一轮，真实质量仍须作者对照核对。

## 交付

临时分支codex/context-selection从master 0c875ad建立；完成后快进master并同步GitHub/Gitee，双远程master的最终哈希独立读取，与两本地checkout及tree核对。证据位于`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-context-selection-d22463b1`，保存DB回执、浏览器RED/GREEN、单测/typecheck/build、凭据排除与最终Git回执。原实验工作树保持原样。
