# 2026-11-07 来源正文变更后的记忆失效与采纳修复

## 结论

正文实际修改、恢复、AI续写或删除后，来源章节的旧proposed/accepted记忆现在会在同一事务变为superseded，后续上下文不再读取它们。相同正文重复保存保留记忆。重新抽取后，新摘要可重新进入下一章预览。

浏览器验收额外发现并修复采纳接口向不存在的acceptedAt字段写值导致500；旧标签页试图采纳已失效记忆现在返回409，不能通过先改proposed再accepted绕过。

本轮外部模型调用0次，未改写既有真实验收章或冒充作者核准摘要。验证使用实际应用代码、PostgreSQL回滚夹具和进程级fake浏览器。

## 原始问题

独立只读复核及合成响应确认：manual保存、DESLOP、版本恢复、worker共用finalize没有失效来源记忆；正文把“角色已死”改为“角色活着”后，旧摘要仍accepted。软删除章节也未处理记忆，web预览/worker查询仅按租户/项目/status，仍会注入已删除来源摘要。

采纳原实现无条件update，旧UI里的superseded条目可以重新accepted。真实浏览器还观察到acceptedAt不在ProjectMemory schema，引发Prisma校验错误，旧单测却只断言这一错误字段被写入。

## 修改范围

- 共享DB模块chapter-memory：参数化查询锁住租户范围章节行，返回当前正文及projectId；只将相同org/project/sourceChapterId下active proposed/accepted变superseded，不删历史、不中伤无来源人工记忆。
- manual保存、DESLOP和restore先锁章节，比较实际新旧正文，在原事务内写正文/快照并失效记忆。MANUAL快照原有10%/10分钟/100条策略不变；restore改用锁后的最新正文创建防丢快照，避免事务前旧读覆盖并发编辑。
- worker共用finalize包含生成/续写/批量保存入口：锁章、内容变化时失效旧记忆，再保存同次合法extracted，新旧记忆与正文/版本同事务提交。
- softDeleteChapter同事务软删除+来源记忆失效。web预览和worker上下文额外限制sourceChapter未删除且org/project匹配；sourceChapterId=null的项目记忆继续有效，可防御旧版本留下的deleted来源accepted条目。
- 采纳及转回proposed时，使用来源章相同行锁、重新读取状态并条件更新。仅active proposed/accepted允许保持active，superseded/rejected不能重新激活。不存在/已删除/越界来源拒绝，冲突409并提示刷新/重新抽取。非active驳回/失效操作仍可保留历史。
- 移除ProjectMemory不存在的acceptedAt写入，沿用updatedAt。记忆面板说明改为“摘要自动纳入，其他条目审核后采纳；正文改动后旧记忆失效”，不再把自动摘要描述为已人工确认。

不新增schema/迁移，不做历史记忆批量回写。已经在旧版本被改写但来源未删除的遗留摘要无法从现有字段可靠追溯，本轮不假称已清洗；需要操作者重新抽取确认。

## 验证证据

1. 修改前RED确认：实际编辑未更新记忆、上下文缺来源过滤、worker未失效旧记忆；修复后GREEN。另RED复现superseded/rejected→proposed→accepted绕过，再限制状态转移。
2. 真实PostgreSQL九项夹具全事务回滚：同文保存保留；manual、DESLOP、restore、soft-delete、AI续写失效旧accepted/proposed；AI同次新记忆保存；摘要→编辑→重抽取→下一章预览依次“旧存在→旧消失→新存在”；遗留deleted来源摘要被排除。
3. 真实并发连接检查：来源行锁期间，另一连接正文update在300ms lock_timeout下失败，原正文未变。第一版验证脚本只匹配英文异常导致断言失败，补读取实际中文/结构化55P03后确认预期锁超时；没有改生产逻辑掩盖失败。
4. 真实savepoint故障注入：记忆失效写入失败时，正文、版本回滚，旧accepted摘要保留；整体夹具再回滚。
5. 真实DB采纳检查：proposed正常accepted，正文改写后superseded，再次proposed/accepted均冲突，无来源人工项目记忆可采纳，全部回滚。
6. 浏览器完整3 passed + 1 skipped（1.1m，fake）：实际创建来源记忆并采纳成功，同正文PATCH后仍accepted，编辑器实际更改后superseded，旧请求重新采纳409。首轮暴露acceptedAt500，修复后完整通过。
7. 全量1072 passed + 1 skipped（db25/shared67/adapters50/worker290/web640），typecheck5/5、生产build通过。
8. 最终独立只读复核8个测试文件83项通过，未发现阻止合并的问题；核对事务、行锁、状态绕过和来源过滤。未读取凭据或调用外部模型。

## 使用与边界

修改来源正文后，旧摘要从上下文消失是预期行为，应再次抽取或新增审核后的记忆。失效条目仍可在全部记忆中追溯，不能直接复活为事实。标题/状态/分卷等不改变正文的操作未触发本次内容失效；本轮不处理全书设定修改后的语义依赖传播。

上下文只保证在查询时不使用被本轮标为失效或来源删除的条目；已经发到外部模型的运行中请求不能撤回或重新生成。自动accepted摘要的语义正确性、原AI背景、渠道稳定性和长章覆盖仍需后续作者审核，不能靠status证明。

## 交付与证据

证据目录：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-memory-freshness-937a6657`，保存DB回执、锁/回滚验证、浏览器失败及通过日志、单测/typecheck/build记录和最终Git回执。本轮没有外部chat请求，不提交凭据、用户正文或私有数据库数据。

临时分支codex/memory-freshness从master f83b9ee建立，完成后快进集成master并按既有授权同步GitHub/Gitee；最终commit/tree与双远程哈希独立核对保存在上述目录。原实验工作树和真实模型配置保留，无生产部署。
