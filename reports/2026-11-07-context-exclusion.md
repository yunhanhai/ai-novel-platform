# 2026-11-07 排除素材与关键词激活一致性

## 结果与原始问题

被本次排除的记忆现在不参与关键词激活；明确排除的角色/世界项不再出现在激活报告。失去关键词触发条件的有效排除项仍保留在恢复列表，同时强制和排除同一条时以排除为准，强制统计也不再包含它。

原实现先用全部recentMemories形成triggerText并激活worldItems，最后才过滤排除项。合成场景及实际worker提示词RED确认：排除唯一提及“暗井”的记忆后，暗井背景仍进入计划/草稿。excluded列表原取selectedCandidates，因此不活跃世界项即使在excludedAssetIds中，也无法显示恢复按钮；force列表也曾同时计入已排除条目。

## 修复与范围

修改仅在共享build-context-packet：激活前过滤排除的记忆及关键词来源；从有效资产全集生成excluded列表；forced列表剔除excluded。web预览与worker复用同一逻辑。来源章时序、有效性、稳定memory ID、20条查询及token预算沿用现有实现。

不做全文敏感词屏蔽：若同一词仍出现在允许的章纲/标题或其他允许记忆中，相关资产可以独立激活。恢复只是撤销本次排除，仍受自动选择及预算限制；若用户保留了原强制选项，恢复后该强制选项仍有效。

## 验证证据

- 先RED后GREEN：独占关键词仍激活世界项、排除source仍出现在报告、inactive排除项不可恢复、force/exclude统计冲突；已有worker handler测试捕获真实plan/draft中的间接背景。新增6项packet回归并强化handler断言，定向48通过。
- 独立只读审查4个文件55项通过，无阻断项；确认独立章纲触发、source排除、inactive恢复及冲突优先级。审查未改文件或读凭据。
- 真实PostgreSQL五项夹具全部回滚：新增B后排除A保持且独占激活世界项不入preview；inactive世界项仍可恢复且forced=0/报告未激活；恢复A后A/B和世界背景纳入；实际createHandlers生成两次合成请求plan/draft均无A及间接世界背景且job成功；A失效后选择不转移到B。外部请求0。
- 全量1088 passed+1 skipped（db26/shared67/adapters50/worker305/web640），typecheck5/5、生产build及diff check通过。
- 完整e2e3 passed+1 skipped，59.5秒，进程级fake：真实API创建记忆和独占关键词世界项；依次排除世界项、排除记忆；确认失活世界项仍可恢复；单独恢复世界项后提示词不含其背景；恢复记忆后背景重新出现。原核心闭环及窄屏检查继续通过。
- 浏览器首轮测试在世界项恢复响应回写前点击唯一“恢复”，遇到两个按钮的strict-mode失败；补等待恢复按钮数量变为1这一可观察状态后，完整重跑通过，无生产逻辑调整或扩大等待时间。
- 配置密钥排除扫描通过，私有env继续ignored；不提交凭据、模型正文或数据库内容。

## 边界与交付

本轮零外部模型调用，不改既有800字真实章/13条记忆、模型配置、schema或迁移，不部署。预算裁剪掉但没有被人工排除的素材仍沿用现有关键词规则；预览请求竞态、创建时间倒序20条的选择策略及模型语义质量不是本轮结论。

临时分支codex/context-exclusion基于925a526，完成后快进master并同步GitHub/Gitee；双远程master独立读取，核对两本地checkout及tree，仓库外保存最终哈希回执。证据目录`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-context-exclusion-46a3796a`含RED/GREEN、DB回执、独立审查记录、全量检查及Git回执，原实验工作树保留。
