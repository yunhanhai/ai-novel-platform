# 2026-11-07 模型连接测试取消与重试边界

目标：继续完成不依赖真实供应商凭据的接入准备。只修复有代码证据的连接测试超时未取消及SDK隐藏重试；保持两端演示模式、已有生成重试策略及默认SDK行为，不增加真实请求或改动凭据。

方案：ModelGenerateOptions 增加可选请求 signal/timeoutMs/maxRetries，OpenAI和Anthropic按各SDK第二参数透传，缺省时保持原行为。仅 ping 设置maxRetries=0、15秒deadline，并由AbortController取消底层请求；超时仍返回固定中文提示，不泄露异常。

1. 补SDK请求参数透传和ping超时取消回归，观察RED。
2. 实现最小改动，验证正常返回清理timer、超时abort且无未处理拒绝、单次ping禁止SDK重试。
3. 对本机HTTP回环运行实际OpenAI/Anthropic SDK取消与503单次请求验证；不使用真实key、不访问供应商。
4. 定向测试后全量unit/typecheck、必要e2e与生产构建；独立只读复核。
5. 更新接入手册/进度/本地化计划及报告，提交集成master并推送两端，核对remote SHA。

真实接入仍需要用户本地供应商配置。不得将本机回环/模拟测试作为真实供应商或输出质量验收。
