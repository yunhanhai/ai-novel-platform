# 编辑器正文保存冲突保护

目标：旧页面/请求不得静默覆盖较新正文；普通保存与visibility keepalive都携带已确认正文基线。冲突保留本地稿、停止自动覆写并由作者明确处理。保存失败不得继续创建依赖正文的任务或切走丢稿。

真实DB RED：甲乙共同旧稿，甲保存新稿后乙旧baseline写入覆盖成功；当前helper锁章却不比较来源，公共PATCH无baseline。

设计：GET及成功PATCH返回contentHash SHA256。公共content PATCH必须baseContentHash；helper锁章后校验，hash不匹配且新稿与数据库不相同则409（相同文本幂等无副作用）。来源不符时不写版本/失效记忆。响应使用本次事务实际保存正文/hash，不拿随后查询到的别次稿作为保存凭证。metadata-only PATCH保持原行为。

客户端保留每章已确认baseline，队列发请求时读取最新已确认hash；409留dirty/本地text、显示冲突，继续编辑不自动重试。放弃本地只在最新GET成功后采用远端；保留本地明确读取远端baseline后重新保存，并再次面对并发冲突。keepalive不再未经确认清dirty，也带baseline，乱序最多有一方成功；失败保留状态。读请求序号防旧GET覆盖本地或新章。flush成功后仍核对最新稿，所有任务动作/切章/新章先检查flush。

备选仅保留单页面队列不能挡跨标签；updatedAt会被metadata更新制造无关冲突；用正文hash复用现有apply-deslop约定，无schema迁移。相同内容重放保留幂等，ABA不检测。

1. helper/API RED与浏览器双页真实HTTP/keepalive/确认丢失/冲突处理回归。
2. 最小实现GREEN，保留手动版本阈值与记忆失效链；补原fixture必需baseline。
3. 真实DB回滚+双连接并发、独立审查、完整unit/e2e fake/build/typecheck/密钥排除。
4. 更新progress/localization/onboarding/report，提交快进master并同步双远程回执。

审查修正：keepalive必须绕过挂起普通队列立即发出，所有请求仍带base，队列追踪二者并以CAS冲突解决；旧409若当前已确认同稿且非dirty可忽略。新章创建返回后以ref最新稿再次flush并核来源章。远端冲突发生后迟到旧保存ack不得推进baseline或清dirty，flush先判conflict；已用原hook红绿与真实浏览器第9场景验证。
