# 修订事实依据与独立记忆抽取验收

目标：修订保留原始上下文，独立/批量记忆抽取不能把无效输出当成成功，完成一次有边界真实抽取。

- 保留现有自动accepted章节摘要与proposed其他记忆维护语义，不冒充作者审稿。
- 修订提示词带原始上下文、风格/方法论限制，明确不得凭审校意见创造新背景。
- 复用同一抽取解析器校验独立任务与chapter pipeline；JSON选项通过现有profile能力门控。
- 无效抽取在任何memory维护/写入之前失败，保留原记忆；同一条响应内去重，不把superseded/rejected项当有效重复。核对并发章节是否变化，事务内防止旧正文摘要覆盖新正文。
- 独立抽取step记RUNNING→SUCCEEDED/FAILED并保留快照/真实耗时；不改变batch已生成正文和取消语义。
- RED/GREEN、真实DB回滚夹具、单次定向真实EXTRACT_MEMORY（SDK retries0、attempt1、180s、8192项目验收档案），不重复完整小说生成。
- 单测/typecheck/build/e2e与独立审查，更新进度/计划/报告，按既有授权集成同步双远程。凭据与正文保留仓库外。
