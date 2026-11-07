# 长章节测量与局部差异计算

目标：先测量实际输入，保留即时本地恢复；修复实际长稿小修改被误计整章替换、误触发MANUAL快照的问题。

浏览器基线：20k/100k合成章每档60次逐字输入，dev事件同步处理p95约6.4/7.8ms，localStorage set p95约0.2/0.4ms；无证据需削弱同步备份。原始DB RED20k只改1字却added/removed各20000，11分钟前已有AI基线时额外MANUAL快照。

设计：diff先扫描共同前后缀，按Unicode边界保留原样，只对实际变化中段分词和LCS；4000单元上限仍限制变化区域，太长变化保守粗替换中段，不把未改前后文计入增删。内部差异分词保留空白和Unicode字符，结果可重建两侧原文，公开tokenize旧契约兼容。快照阈值/时间/上限不变。

备选提高4000阈值会扩大二次方计算；缩短正文只算局部但不验证共同段会漏改；采用精准相等前后缀剥离，无新增依赖/schema/模型调用。分散大改仍可粗化，不承诺全局最小diff。

1. shared RED长稿单字/纯插删/空白/Unicode重建/大变化有共同边界；actual DB小修snapshot RED。
2. 最小实现GREEN，独立review与CPU前后相同输入基准；actual DB小修无新version、大改仍snapshot/throttle。
3. browser长稿即时刷新恢复测量+完整unit/e2e fake/build/typecheck/密钥排除；不把dev同步事件时间当端到端性能。
4. docs progress/localization/onboarding/report，提交快进master并推送双远程核对commit/tree/clean回执。
