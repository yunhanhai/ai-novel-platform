# 2026-11-07 GitHub / Gitee 发布核验

## 结论

当前主分支的业务代码已完整同步到 GitHub 和 Gitee，两个远程新克隆的 404 个受控文件均与本地 Git 文件树一致。独立性能分支不是当前主分支的简单增量：从 2026-05-21 的共同祖先分出，主分支独有 65 个提交，性能分支独有 43 个提交；另有 17 个修改文件及 8 个未跟踪文件。

性能分支存在已实测的匿名 API 数据访问问题，本次没有将它合并或推送。其全部提交历史及未提交源码已在项目目录外备份，并完成恢复验证。因此，“主分支已同步”成立；“所有本地成果均已在线保存”不成立；“本轮发现的本地源码成果已有可恢复备份”成立。

## 原始状态与仓库身份

| 对象 | 实时结果 |
| --- | --- |
| GitHub | https://github.com/yunhanhai/ai-novel-platform；owner=yunhanhai；公开；default_branch=master |
| GitHub 凭据权限 | 仓库接口返回 admin / maintain / push=true；没有更改可见性或权限 |
| Gitee | https://gitee.com/yunhanhai/ai-novel-platform；owner=yunhanhai；私有；default_branch=master |
| Gitee 身份 | 使用用户本轮授权的令牌读取 /user，login=yunhanhai；令牌只在认证进程中使用 |
| 审计前主分支 | `9e683e10de4d764e433074f856f6a7733f8680e4` |
| 主分支文件树 | `601b3f8313e3f727488211de8c124f336e0f1ce5` |
| 性能分支 | `feature/generation-performance-architecture`，HEAD=`8b94d142c8c50b1becc1d0fb54bceaa0ebd7f778` |
| 共同祖先 | `32a923c2c0031dfe09633750a1875d6e8809e216`（2026-05-21） |
| 线上分支 / 标签 | 两端均仅有 master，无标签；性能分支未发布 |
| 既有 CI | GitHub Actions total_count=0；两条分支均未发现受控的 .github / .gitee 流水线配置 |

注册工作树共两个：项目根目录的 master，以及 `.worktrees/generation-performance-architecture`。初始 master 无暂存或未提交修改。另发现 `.claude/worktrees/` 下两个不再注册为 Git 工作树的旧目录；它们只有 10 个非依赖、非生成文件，已另行备份。其中下载脚本、README、workspace 配置与 master 一致，package.json 缺少后来新增的 eval:mine，另一份锁文件也是旧快照，未当成待集成功能。

## 阻止性能分支发布的证据

**P1：旧分支未采用当前主分支的会话身份与 API 网关。**

- `.worktrees/generation-performance-architecture/apps/web/src/server/context.ts:9` 的 getOrganizationId 直接读取 DEFAULT_ORGANIZATION_ID。
- 同工作树 `apps/web/src/app/api/projects/route.ts:26` 用该默认组织查询并返回项目；分支没有当前 master 的 `apps/web/src/proxy.ts`。
- 当前 master 的 `apps/web/src/server/context.ts:23` 从会话取身份，`apps/web/src/proxy.ts:13` 拒绝缺少 cookie 的 API 请求。

实跑启动独立本地端口，仅发出无 cookie 的 GET，请求体与项目正文不写入报告：

| 版本 | 请求 | HTTP | 观察 |
| --- | --- | --- | --- |
| 性能分支已提交版本 8b94d14 的独立干净克隆 | GET /api/projects | 200 | success=true，返回默认组织 44 个项目 |
| 性能工作树（含未提交预算功能） | GET /api/projects | 200 | success=true，返回默认组织 44 个项目 |
| 性能工作树（含未提交预算功能） | GET /api/performance-budgets | 200 | success=true，返回列表 |
| 当前 master | GET /api/projects | 401 | success=false |
| 当前 master | GET /api/performance-budgets | 401 | 由 API 网关拒绝；该结果不表示主分支有预算路由 |

请求使用现有本地 PostgreSQL。所有探测服务均以 windowsHide 启动，记录进程 PID，并在 finally 中关闭，仅使用 3101/3102/3103。没有匿名写入、迁移、部署或真实模型请求。

未提交的预算功能还依赖旧版同步 getOrganizationId。未来接纳该功能需基于当前 master 迁移代码，处理 65/43 个分叉提交的重复实现与冲突，并补匿名拒绝、跨组织隔离和真实数据库约束验证。当前门禁结论是“暂不发布”，而不是“测试未通过”。本轮未修改这些原稿。

## 验证与边界

| 受测对象 | 实跑结果 |
| --- | --- |
| 从 GitHub 新克隆的主分支代码 | pnpm install --frozen-lockfile；pnpm db:generate；pnpm test：819 passed + 1 skipped；pnpm typecheck：5/5 通过 |
| 性能分支 8b94d14 独立干净克隆 | 安装依赖、生成 Prisma Client；595 测试通过（23+27+36+122+387）；typecheck 5/5 通过 |
| 性能工作树当前磁盘版本 | 613 测试通过（23+27+36+122+405）；typecheck 5/5 通过；git diff --check 通过 |
| GitHub / Gitee 新克隆 | commit、tree 一致；逐文件 hash-object 核对 404/404，无差异；git fsck --full 通过 |
| 主分支浏览器 e2e | 复用本对话上一轮同代码的 2 passed + 1 skipped（53.9s）结果；本轮仅新增文档，不重复执行 |
| 本地备份恢复 | 从 bundle 克隆性能分支，覆盖备份的 25 个文件，SHA256 全部匹配，Git status 与原工作树逐项一致 |

单元测试使用模拟委托的部分仍按单元测试理解；通过不代表真实模型、真实用户隔离或全部数据库路径已验收。性能分支的 e2e 本轮未运行，因为已通过直接请求确认发布阻断，且本轮不修改或部署该功能。没有新增 CI。

安装独立克隆依赖时，首次 offline 安装因缓存缺失失败，随后按冻结锁文件完成安装；没有修改锁文件。Gitleaks 在 Windows 跨盘 baseline 路径报错后，将审查基线放在对应扫描目标同盘，复跑成功。后段 GitHub Git HTTPS 经已有 Git HTTP 代理发生 TLS 握手异常，API 仍可访问；用单命令 `git -c http.proxy= ls-remote` 绕过该代理后成功读取远程引用。后续本轮 GitHub 同步沿用该单命令参数，未修改全局配置或关闭 TLS 校验。

## 凭据与正文检查

- 下载 Gitleaks v8.30.1 的 Windows 发布包，并核对同一 release 的 SHA256 清单，未安装全局软件。
- 扫描全部可达历史：143 个非空 Git diff 提交，约 2.59 MB。初始 3 条 generic-api-key 告警逐条读取对应历史 blob，确认一个是 auth.test.ts 的固定测试 SESSION_SECRET，另外两个是 .env.example 与设计文档中相邻的空 API key 示例。
- 25 个未提交文件的源码副本（239603 字节）有 1 条相同空示例误报。仅将本次已逐项确认的具体发现作为 baseline，复扫没有新增发现；未在项目中加入宽泛豁免规则。
- 10 个旧代理目录文件另扫，无告警。
- 对 2837 个可达 Git 对象检查本轮提供的已知令牌，未发现该令牌。没有将令牌写入项目、远程 URL 或报告。
- `.env`、`apps/web/.env.local`、依赖、生成产物及 `.eval-out/` 用户正文数据继续排除。小说示例和固定测试夹具仍保留原状；本轮未上传实际评测数据集。

扫描和人工核对支持“本次规则与对象范围内未发现真实凭据”，不能证明任意编码形式的秘密绝对不存在。评测正文与数据库属于本地数据，不包含在本轮源码备份中。

## 本地备份与恢复

持久备份目录：`D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-40d881a9/`，位于仓库外。

- `all-branches.bundle`：所有分支及完整历史；git bundle verify 通过。SHA256=`F96F27328DCAB0A032199D075502ECB8463266B887A18928E283BF3717A5366E`。
- `performance-working-files/`：17 个修改文件和 8 个新文件的原始字节副本。
- `working-files-manifest.json`：逐文件路径、状态、大小、SHA256；清单 SHA256=`A6305E2EFA1EA730822B5A51DC825AB6A9786D7DAA3A16C2AE5EDBC357899729`。
- `restore-verification.json`：从 bundle 恢复的提交、文件数及与原 status 比较结果。
- `orphan-source-files/` 与清单：10 个旧代理目录源码文件。
- `evidence/`：测试日志、匿名 GET 结果（无正文）、远程克隆核对回执、完全遮盖密钥的扫描报告及核验脚本。

可在一个不存在的新目录恢复，避免覆盖工作目录：

```powershell
git clone --branch feature/generation-performance-architecture 'D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-40d881a9/all-branches.bundle' '<新的恢复目录>'
Get-ChildItem -LiteralPath 'D:/develop/AI/xiaoshuo/base_win-release-backups/2026-11-07-40d881a9/performance-working-files' -Force | Copy-Item -Destination '<新的恢复目录>' -Recurse
```

本轮恢复验证采用清单逐文件复制并校验 SHA256，没有覆盖原工作树。

## 本轮交付

主工作区只新增本核验报告并更新两份项目进度文档，提交后同步两个远程。最终提交哈希及新增文档的克隆核对回执保存在上述仓库外证据目录，避免在提交内部嵌入自身哈希。

剩余工作明确为：性能分支 43 个独有提交与 25 个未提交文件尚未在线保存，先修正会话身份并基于当前主分支重新验证后才能决定发布；本轮已完成本地可恢复保存，不以此冒充在线备份。
