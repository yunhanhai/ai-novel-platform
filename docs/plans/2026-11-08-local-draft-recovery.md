# 本地未保存稿恢复计划

目标：断网/保存失败/意外刷新后提供未保存文字恢复，不自动覆盖远端新稿。按组织+用户+章节隔离，无模型调用、后端schema或外部上传。

现状：setContent只写React/ref，1500ms防抖/keepalive是唯一持久机会，离页时离线会丢；无localStorage/IDB正文恢复。新机制只添加本机浏览器副本，已保存远端仍是正式正文。

设计：layout组织context注入session userId，hook按org/user/chapter存draft version/content/baseHash/writer/time；每页面writer随机UUID独立key，编辑时同步写localStorage，不等防抖。读取远端后只提示最近不同稿，用户恢复到编辑器或明确丢弃；恢复本地不自动PATCH，沿原base和冲突保护，由显式保存/保留本地完成。存储故障可见但远端保存继续。只在保存同text确认或明确丢弃后清理自己writer/恢复源且raw值未变，避免另一页面新版被旧确认删除。无期限自动淘汰，报告容量/共享设备边界。

备选sessionStorage不能跨关闭恢复；IndexedDB异步编辑同步保障更复杂；localStorage小范围同步副本最小，配写失败提示。本轮不引入全稿历史管理、加密密码、自动合并或草稿跨设备。

1. 先浏览器保存失败刷新RED，storage helper测试隔离/坏数据/不误删/异常。
2. 最小实现provider scope/store/hook/editor恢复按钮及本地错误提示，远端基线继续保护。
3. 浏览器恢复前不自动写、恢复后远端变化冲突、保存清副本/另一页不清、新用户隔离/存储拒绝；独立复审+完整unit/e2e fake/build/typecheck/密钥排除。
4. docs progress/localization/onboarding/report，精确提交快进master同步GitHub/Gitee与hash/tree/clean回执外存。

设计核对修正：localStorage比较后删除不是跨标签原子操作，foreign writer仅用随机revision的immutable handled标记；本writer才能删除匹配raw。独立审查增加dirty恢复拒绝与恢复后修订成功处理原revision，已浏览器RED/GREEN。
