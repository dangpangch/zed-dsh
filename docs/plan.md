# 设计计划：DeepSeek Harness 的 Zed Agent（zed-dsh）

> 本计划遵循 **Zed 官方现行标准**：主路线 = ACP Registry 条目 + Custom Agent（settings）；Zed "Agent Server Extension"（extension.toml）已被官方标记弃用，仅作旧版 Zed 兼容附录保留（用户决策，2026-09）。
> 参考实现边界（方向 C）：`cnctem/dsh-acp`、`@anht3889/dsh-acp-zed`、`svkozak/pi-acp` 均**不 fork、不依赖**，只作为交互面映射、Zed quirks 与实现手法的知识基准写进设计与验收。
> 同步保存于 `/home/pang/ws/harness/zed-dsh/plan.md`。

## 1. 目标与成功标准

在空仓库 `/home/pang/ws/harness/zed-dsh` 内产出（本迭代）：

1. **`docs/design.zh.md`** — 完整架构设计文档（中文为主、协议/代码术语保留英文），覆盖：组件架构、ACP v1 ↔ DSH 行为映射、**官方现行分发路线（Registry/Custom Agent）**、旧版 Zed 兼容层、打包、安全边界、边界情形、里程碑。
2. **可开发的工程骨架** —— 目录与文件齐全、内容真实可用（清单见 §5），使后续里程碑只需"填实现"，不再做设计决策。

本迭代**不**包含：完整交互桥代码实现、真实 CI 发布、npm 安装验证、Zed 真机验收（列为后续里程碑 M1–M4，§9）。

成功标准：
- 主分发产物 **`registry/agent.json`** 严格符合 ACP Registry 官方 `agent.schema.json` 与 `FORMAT.md`（Zed 现行 "Install from Registry" 标准）；
- 兼容附录 **`extension/extension.toml`** 严格符合 Zed Agent Server Extension 规范（仅面向旧版 Zed）；
- 设计文档对每个已确认决策给出结论与理由，未决项全部显式列出并带默认值；
- 骨架内 JSON/YAML/TOML/TS/SVG 语法有效，目录结构可直接生长为完整实现。

## 2. 调查结论（事实基础，设计文档引用）

### 2.1 Zed 侧（官方现行标准）
- **ACP Registry（现行主路线）**：稳定化公告 2026-03；Zed ≥ v0.221 提供 "Install from Registry"（`zed::AcpRegistry` / Agent Settings → External Agents → Add Agent）。条目由 `agentclientprotocol/registry` 仓库维护（每 agent 一个目录：`agent.json` + `icon.svg`）。Registry 安装后在 settings 显示为 `agent_servers.<id> = {type: "registry"}`，版本由 Registry UI 管理更新。
  - 条目格式（`agent.schema.json`/`FORMAT.md`）：必填 `id`（小写连字符）/`name`/`version`(semver)/`description`/`distribution`；可选 `repository`/`website`/`authors`/`license`/`license_url`/`icon`(由构建自动设置)。
  - `distribution`（三选一或并存）：**`binary`** = 每平台 `{archive, sha256?, cmd, args?, env?}`，平台键 `darwin-{aarch64,x86_64}`/`linux-{aarch64,x86_64}`/`windows-{aarch64,x86_64}`，归档限 `.zip/.tar.gz/.tgz/.tar.bz2/.tbz2`/裸二进制（不支持 dmg/pkg/deb/rpm 等安装器）；**`npx`** = `{package: "@scope/pkg[@ver]", args?, env?}`；**`uvx`** = PyPI 等价物。
  - **入册要求**（`AUTHENTICATION.md`）：必须支持 **Agent Auth**（agent 自持 OAuth 流）或 **Terminal Auth**（附加 `--login` 类 args 的交互式设置流程），通过 ACP `authenticate`/`AUTH_REQUIRED` 声明 sign-in 方法。
- **Custom Agent（settings，dev/免注册）**：`agent_servers.<name> = {type: "custom", command, args, env}`，command 可为 `npx`/`node`/任意本机可执行；注册表 agent 也可有 `agent_servers.<id>` 覆盖。
- **Agent Server Extension（已弃用，兼容附录）**：`extension.toml` 声明 `[agent_servers.<id>]`（`name`/可选 `icon`/`env`）+ 每平台 `targets.{os}-{arch}`（`archive`/`cmd`/`args`/`env`/`sha256`）。Zed ≥v0.221 弃用；官方说明已有扩展 agent 自动迁移到 registry 等价物。
- Zed Agent Panel 对外部 agent 的体验点：会话配置选项（`configOptions`：模型/思考档位/权限）、**会话历史/load/导入自 v0.225.0 起支持**、`available_commands_update`（斜杠技能）、`session/request_permission`、`usage_update` 圆环、`plan` 卡片、`authenticate`、MCP `context_servers` 经 `mcpServers` 转发、`dev::OpenAcpLogs` 排查。

### 2.2 DSH 侧（上游 master，CLI v0.1.2-alpha.5）
- 官方 ACP 实现：`@deepseek-ai/dsh-acp`（automation-only 桥，`@agentclientprotocol/sdk@1.4.0`，ACP v1）+ `@deepseek-ai/dsh-acp-app`（`dsh --profile acp` stdio 组合；stdout 纯净 JSON-RPC、EOF 优雅退出）。npm alpha 已发布（`dsh-acp-app@0.1.2-alpha.2`）。
- 上游 automation-only 契约：`initialize/authenticate/session/new|list|resume|close/prompt|cancel|set_config_option/update/request_permission`；stdio/HTTP MCP 可挂载；文本+光栅图；一次性权限；**不支持** session/load、删除、fork、指令/模式/计划/终端、elicitation。上游设计史明确把"编辑器 UI 面"从 ACP 桥中移除（`.agents/notes` 归档）。

### 2.3 第三方参考实现 A：`@anht3889/dsh-acp-zed`（npm 0.5.0——仅参考，非依赖）
- *交互档* 独立 npm server，自 boot cordis 组合 + 官方 ACP SDK `AgentSideConnection`；会话选项/恢复+回放/技能斜杠命令/MCP(OAuth)/认证(env+terminal-login)/plugin 管理/overlay/settings 热更；v1 限制（无持久授权、无 reasoning 流式、无后台 job）。全部组合来自已发布 `@deepseek-ai/*` 包。

### 2.4 第三方参考实现 B：`cnctem/dsh-acp`（github，MIT——已对比评估，仅参考，不采用）
- 形态：dsh profile bundle 插件（`dsh plugin --profile acp add …`），`dsh --profile acp` 运行，Zed 走 Custom Agent；是 ACP **运行时**而非分发产物（无 registry/extension/自包含归档），强依赖宿主机 dsh CLI+Node+pnpm。基线 = 官方 stable `dsh@0.1.1-rc.2`，交互面齐全（thought/token 流式、工具卡片+行号、diff、`session/list·load·delete`、`configOptions` 权限×3/模型/思考、bash 终端、`usage_update`、todo→`plan`、识图、斜杠指令、elicitation 表单），并记录大量 **Zed 客户端 quirks**（`configOptions` 存在时 Zed 忽略 `models/modes`；plan 用稳定扁平通道；`available_commands_update` 延后于 session 响应；`mcpServers` 接受但忽略）。缺口：ACP SDK 硬 pin `0.25.1`（1.0 前、UNSTABLE API）、无 authenticate/sign-in、无 MCP 工具面、单文件纯 JS、单一维护者、无 release/tag。

### 2.5 第三方参考实现 C：`svkozak/pi-acp`（github，MIT，657★——已对比评估，仅参考）
- 定位：**pi coding agent（`earendil-works/pi`）的 ACP 适配器**——自带 ACP stdio 服务端，内部 spawn `pi --mode rpc` 子进程并做 ACP ⇄ pi RPC 翻译（`src/acp/translate/*`），不是 agent 本体。对 DSH **不适用其 spawn-CLI-RPC 内核**（DSH 是进程内 cordis 组合、无 RPC 模式 CLI），但其**外层实现手法值得吸收**：
  1. **Registry npx 分发即可上架**（`agent.json` 仅 `distribution.npx: pi-acp@0.0.33`），Zed settings 体验 = `agent_servers."pi-acp".type:"registry"`；无需先备 GitHub Release 二进制；
  2. **Terminal Auth**：`pi-acp --terminal-login` spawn 交互登录并透传退出码，客户端经 `authMethods` 自动唤起——与我们的 `login/--login` 动词同构；
  3. **stdout-destroyed 防护**：客户端提前关 stdout（`ERR_STREAM_DESTROYED`）静默吞错不崩溃，并有同名专项测试；
  4. **Zed 会话历史锚定 v0.225.0+**（session/load 映射到宿主会话文件）；
  5. **startup-info 会话首块**：启动时把 pi 版本/上下文/skills/prompts 摘要注入会话，`quietStartup` 可关；
  6. 文件式 prompts（`~/.pi/prompts`、`<cwd>/.pi/prompts`）+ 内置斜杠命令（/compact /export /session /name /queue /steering /follow-up…）；
  7. **diff/位置约定**：编辑前快照 + `oldText` 唯一匹配推断 1-based 行号 + `oldText`/`newText` 结构化 diff；
  8. 测试方法论：每个 ACP 行为一个测试文件（unit：auth-methods-terminal-auth-meta / session-config-options / session-list-load / slash-commands / thinking-modes / stdout-destroyed…）+ component 级真实进程 spawn；
  9. 缺项（不采纳其"缺"）：无 thought 流式、MCP 不接线（推荐旁路 adapter）、无 fs/terminal 委托。

### 2.6 架构结论
- 不重写 DSH、不 fork 上游：新建独立 npm 包（server）+ **registry 条目 + custom-agent 配置** + 打包流水线；bridge 在已发布 DSH 包的公共服务上实现交互面（基线取舍见 §10）。
- 主分发 = **Registry 的 `binary` 分发（自包含归档，每平台）**，与旧版 Zed extension 兼容层**共用同一归档产物**；**上架顺序 npx 先行**（npm 包发布即可提交 Registry，Zed 端 `type:"registry"`），binary 在 M3 就绪后补齐。
- **不采纳**：pi-acp 的 spawn-CLI-RPC 适配模式（DSH 无 rpc 模式 CLI、进程内组合开销小且事件单一）；"MCP 不接线"策略（我们保留挂载）；cnctem 的 SDK 0.25.1 硬 pin（用官方 1.x SDK）。

## 3. 总体架构

```
Zed (Agent Panel)  ──ACP v1 stdio JSON-RPC──►  dsh-acp-zed 进程（registry binary 归档 / npx / node）
                                                  │ boot(自 boot cordis 组合: cordis.yml + 用户 overlay)
                                                  ▼
        [llm-deepseek | llm-pi-ai(热更路由)] [sandbox-policy + fs-sandbox + bash-sandbox]
        [user-approval(权限)] [skills] [MCP catalog / Zed mcpServers 转发]
        [bridge: AgentSideConnection ⇄ agent spine ⇄ JSONL 会话持久化 + sqlite query]
```

- **进程入口** `src/bin.ts`：先处理非 serve 动词（`login/logout/plugin/mcp/--list-models/--help`，serve 时 stdout **只承载 JSON-RPC**），随后解析 API key（env 优先 → `~/.dsh/acp-zed/auth.env` mode 600）注入 `process.env`，再 `boot()` cordis 组合；stdin EOF → 优雅 dispose → exit 0；`--help` 写 stderr exit 0。
- **认证（Registry 入册要求）**：实现 **Terminal Auth**（`login` 动词，供注册表/客户端以 `--login` 附加参数触发，spawn 交互式登录并透传退出码）与 env-first 的 key 解析；`authenticate` 缺 key 时经 `AUTH_REQUIRED` 声明 sign-in 方法（对齐 pi-acp/cnctem 参考形态）。
- **组合** `cordis.yml`：默认 persona、provider/model 行、workspace 限定沙箱（默认 `workspace-write`，`DSH_PERMISSION_MODE` 可覆盖）、bash/fs/todo 工具集、bridge 插件。
- **bridge**：官方 ACP SDK 服务端；每连接多会话；方法矩阵见 §6。
- **状态目录**：`$DSH_HOME/acp-zed/`（默认 `~/.dsh/acp-zed/`）：`settings.yaml`（provider 路由，热更）、`credentials.yaml`、`overlay.cordis.yml`（重启生效）、`sessions/`、`auth.env`、`plugins/`。

## 4. 命名与发布身份（本迭代默认值，发布前可改）

| 项 | 默认值 |
|---|---|
| 仓库名 / 工程 | `zed-dsh` |
| Registry agent id / 显示名 | `deepseek-harness` / `DeepSeek Harness`（id 须小写连字符，符合 schema） |
| npm server 包 | `dsh-acp-zed`（占位 scope；bin = `dsh-acp-zed`） |
| 归档名（Registry binary + extension 共用） | `dsh-acp-zed-{os}-{arch}.{tar.gz,zip}`；GitHub Releases 承载 |
| 兼容层扩展（旧版 Zed） | `extension/`：agent_servers key `deepseek-harness` |

## 5. 工程骨架清单（本迭代产出文件 + 内容规格）

```
zed-dsh/
├─ .gitignore                     # node_modules/dist/archives/*.tgz etc.
├─ README.md / README.zh.md       # 双语：简介 + 安装路径速览（Registry 为主/Custom Agent/旧版扩展）+ 指向 docs
├─ docs/design.zh.md              # ★ 完整设计文档（§6 内容全部写入）
├─ docs/protocol-map.md           # ACP v1 ↔ DSH 行为矩阵 / capabilities / 与上游 automation-only 差异表
├─ docs/zed-setup.zh.md           # Registry / Custom Agent / 旧版扩展三路线安装手册 + 排障（PATH、auth、OpenAcpLogs）
├─ docs/acceptance.md             # 手工验收清单（Zed UI + ACP logs）+ SDK 冒烟步骤；
│                                 #   测试清单命名对齐 pi-acp/cnctem 粒度（config-options/auth-methods-terminal/
│                                 #   session-list-load/thinking-modes/stdout-destroyed/slash-commands/elicitation…）
├─ registry/                      # ★ 主分发产物（提交到 agentclientprotocol/registry 的内容）
│  ├─ agent.json                  #   按 agent.schema.json/FORMAT.md：id=deepseek-harness；
│  │                             #   v1=distribution.npx（上架先行）；M3 后升级补 distribution.binary
│  │                             #   全平台(6 键) {archive, sha256, cmd:"dsh-acp-zed(.exe)", args:["lib/bin.js"]}
│  └─ icon.svg                    # 16×16 单色图标（registry 要求 icon.svg 同目录）
├─ extension/                     # 兼容附录（旧版 Zed，官方已弃用）
│  ├─ extension.toml              #   agent_servers.deepseek-harness + 每平台 targets；cmd="dsh-acp-zed(.exe)" args=["lib/bin.js"]
│  ├─ icon/dsh.svg
│  └─ README.md                   # 说明：仅旧版 Zed（≤v0.22x）；新 Zed 请用 Registry/Custom Agent
├─ server/
│  ├─ package.json                # type:module; engines node ^22.19||>=24; bin{dsh-acp-zed}
│  ├─ tsconfig.json / tsdown.config.ts
│  ├─ cordis.yml                  # 默认组合（参照参考实现结构，逐条注明依赖来源与版本 pin）
│  ├─ src/
│  │  ├─ bin.ts                   # CLI 分派（含 --login 终端认证动词）+ boot + stdin EOF 生命周期
│  │  ├─ config.ts                # 路径解析（dshHomePath）、settings/overlay 装载接口
│  │  ├─ auth.ts / mcp-store.ts / plugins.ts   # 动词模块接口 + TODO 锚点
│  │  └─ bridge/
│  │     ├─ index.ts              # 插件入口：AgentSideConnection 装配、每会话记录、teardown
│  │     ├─ content.ts            # 提示词/图片验收与投影
│  │     ├─ updates.ts            # 提交式语义更新序列化（assistant/thought/tool/usage/plan）
│  │     ├─ codec.ts              # turn 结束 → ACP stopReason 全映射
│  │     └─ session-store.ts      # 会话注册/load-回放/resume/list/close 骨架
│  └─ tests/                      # vitest：ndjson 帧纯净、codec 映射、会话生命周期（fake-llm harness 预留）
├─ packaging/
│  ├─ build-archive.mjs           # 下载官方 node 运行时(矩阵版本) → 组装自包含目录（node 重命名为
│  │                             #   dsh-acp-zed(.exe)，lib/ + cordis.yml 平铺）；产出 tar.gz/zip + sha256
│  ├─ archive-manifest.json       # 平台 → {url, sha256}（注入 registry/agent.json 与 extension.toml）
│  └─ smoke-acp.mjs               # spawn 归档内 cmd，跑 initialize/（mock 会话）验证帧纯净与退出码
├─ examples/zed-custom-agent.json # settings.json 片段：custom agent(npx) + env + 绝对路径 npx 的 PATH 提示
└─ .github/workflows/release.yml  # 矩阵(release 构建各平台归档) → GitHub Release + registry/extension 注入 + manifest 校验
```

每个"骨架"文件遵循原则：**可独立验证的语法与结构真实**；需要后续实现才成立的部分用 `// TODO(M1): …` 与设计文档章节号双向锚定。

## 6. 设计文档必须包含的决策内容（写入 docs/design.zh.md）

1. **ACP v1 方法矩阵**（取自上游 dsh-acp README + 参考实现 A/B/C，标来源）：`initialize`（能力如实声明：session/list+load+resume+close、config options、图片仅当附件存储+精确路由支持、MCP stdio/http）、`authenticate`（env-first + Terminal Auth `--login`；`AUTH_REQUIRED` 声明 sign-in 方法）、`session/new`（绝对 cwd 校验、mcpServers 挂载、配置选项返回）、`session/list`、`session/load`（回放、不重放旧 update）、`session/resume`、`session/close`（quiescent teardown）、`session/prompt`（单飞行、文本+光栅图、route 快照 pin）、`session/cancel`/`$/cancel_request`、`session/update`（提交式语义更新，顺序串行）、`session/set_config_option`（model/reasoning_effort/permission）、`session/request_permission`（一次性 allow/reject）、elicitation 表单（`ask_user_question`，能力门控+自解释回退）；明确不实现项与理由。
2. **与上游 automation-only 的差异表**：本设计新增/复用的交互面 = load+回放、`available_commands_update` 技能/斜杠指令、每会话 `configOptions` 原生渲染、`usage_update` 圆环、todo→`plan`、thought 流式、会话列表/删除；（可选）startup-info 会话首块（DSH 版本/模型/技能摘要 + `quietStartup` 开关，对齐 pi-acp）；明确哪些是"在已发布公共服务上重建、非改上游"。
3. **更新/渲染约定**（吸收参考实现 B/C 的 Zed quirks 作硬约束）：reasoning(thought) 流式、通用 tool lifecycle、diff/terminal 卡片 —— "不把执行移出 harness"原则；terminal 类仅展示元数据（能力门控 `_meta` 或文本回退）；diff/位置统一约定 = 编辑前快照 + `oldText`/`old_str` **唯一匹配**推断 1-based 行号（歧义不带行号）+ `oldText`/`newText` 结构化 diff（无 hunk meta 时快照前后比对）；`configOptions` 存在时 Zed 忽略 `models/modes`；plan 用稳定扁平 `entries` 通道；`available_commands_update` 延后于 session 响应；Known Limitations 显式列出。
4. **打包设计**：主路线=**自包含目录归档**（官方 node 运行时改名 + lib 平铺，`cmd` 直接指向该可执行，规避 SEA 对 cordis 动态 import/原生模块的限制）——**同一归档同时服务 Registry `binary` 分发与旧版 Zed extension**；备路线=**薄封装**（Custom Agent/开发：宿主机 node `^22.19||>=24`，`npx -y <pkg>` 或全局 `dsh-acp-zed`）。Node SEA 作为未来优化项（M3+，标记依赖验证）。
5. **发布路线（按官方现行标准排序，npx 先行）**：① **ACP Registry**（npm 包发布后即以 `distribution.npx` 提交 `agentclientprotocol/registry`，Zed settings 显示 `type:"registry"`；M3 binary 就绪后条目升级补 `distribution.binary`；Terminal Auth 入册）→ ② **Custom Agent**（dev/免注册：`npx`/node 直跑）→ ③ **extension.toml 兼容附录**（仅旧版 Zed ≤v0.22x；明确弃用风险与迁移说明）。Zed 版本锚点：Registry 安装 ≥v0.221，会话历史/load/导入验收 ≥v0.225。
6. **配置与认证**：env-first → auth.env(600) → 无 key 时 `authenticate` 报缺并展示 sign-in 方法（Terminal Auth `--login`）；`--login` 采用 spawn 交互式登录并透传退出码（对齐 pi-acp）；`DSH_HOME` 重定位；provider 热更 settings 文档 + overlay 重启生效（无 HMR）。
7. **安全边界**：stdout 纯净（serve 期无任何非协议输出；`--help`/诊断全走 stderr）；stdout 提前销毁（客户端断连）时静默吞写错误、不崩溃（`ERR_STREAM_DESTROYED` 防护 + 专项测试）；bash 仍在 harness 沙箱内执行、ACP 不委托 shell；一次性权限无持久授权；密钥不进组合文件；归档 sha256；无 stdout logger。
8. **边界情形与失败模式**：GUI 启动的 Zed 看不到 nvm PATH（绝对路径提示/从终端启动）；缺 key（`auth-required-when-no-models` 语义：报缺并展示 sign-in，不静默降级）；stdin EOF/断连 quiescent 清理；resume 时 cwd 校验失败；MCP 不可达软失败并命名于 stderr；Windows 引号/路径；并发会话隔离；`$/cancel_request`。
9. **测试与验收策略**：单元（codec/帧纯净/content 验收）、组合级 SDK 冒烟（真实 spawn → initialize → session/new → 帧纯净 → 退出码）、keyed e2e 自跳过、packaging smoke、`registry/agent.json` 过 `agent.schema.json` 校验、Zed 真机手工清单（Registry 安装 + Custom Agent + 会话历史 v0.225+ + `dev::OpenAcpLogs`）；**测试粒度对齐参考实现**——每个 ACP 行为一个测试文件（config-options / auth-methods-terminal / session-list-load / thinking-modes / stdout-destroyed / slash-commands / elicitation / delete / restore…），component 级真实进程 spawn。
10. **里程碑与风险**（§9）+ 开放项清单（§10）。

## 7. 已确认的范围决策（来自用户选择）

- 交付 = 设计文档 + 工程骨架（本迭代）；完整实现分里程碑。
- **分发遵循 Zed 官方现行标准（用户决策 2026-09）**：主路线 = ACP Registry 条目 + Custom Agent；`extension.toml` Agent Server Extension 降级为**旧版 Zed 兼容附录**（官方已弃用），不再是"一等交付物"。
- 自包含归档为主（Registry binary 与 extension 共用），薄封装（依赖宿主机 node）兜底用于 dev 与 Custom Agent；**Registry 上架 npx 先行、binary M3 补齐**（pi-acp 对比结论，2026-09）。
- 功能基线 = **Zed 体验优先的交互档**（对齐参考实现取舍，含其 Known Limitations 的显式继承）。
- 参考实现边界（方向 C）：`cnctem/dsh-acp`、`@anht3889/dsh-acp-zed`、`svkozak/pi-acp` 均**不 fork、不依赖**，只作为交互面映射、Zed quirks 与实现手法的知识基准写进设计文档；架构维持自建（§3/§5/§6 不变）。

## 8. 验证与验收（本迭代）

1. 所有产出文件语法有效：`registry/agent.json` 过 `agent.schema.json`（JSON Schema 校验）、`extension.toml`（TOML）、`cordis.yml`/JSON 样例（YAML/JSON）、TS 骨架（若依赖可安装则 `tsc --noEmit`，否则标注延迟）、SVG 可解析。
2. 归档构建脚本在**离线可验证的子集**上可运行（manifest 生成、目录组装逻辑、registry/extension 注入），真实下载留 M1。
3. `docs/acceptance.md` 中 Zed 真机验收步骤可由用户照做（Registry 安装与 Custom Agent 两路径、会话历史 v0.225+，作为 M1 完成标准）。
4. 设计文档 §6 十项内容齐全、每条决策带理由或显式默认。

## 9. 后续里程碑（设计文档内固化，不在本迭代执行）

- **M1 薄封装打通**：server 包可 `npm install` + 本地 `dsh-acp-zed --help/--list-models/--login`；Custom Agent 路径在真实 Zed（≥v0.221；会话历史验收锚 v0.225+）跑通首个会话（用户执行验收）；验证 ACP SDK 版本握手与认证方法。
- **M2 交互桥实现**：bridge 代码按 §5 模块填实（load/回放、技能命令、权限、认证、配置选项、elicitation、usage/plan 更新）；vitest + SDK 冒烟通过（测试命名对齐 §6.9 基准）。
- **M3 自包含归档 + CI**：`packaging/build-archive.mjs` 全矩阵跑通，GitHub Release 产出 + `registry/agent.json`（升级补 `distribution.binary`）/`extension.toml` 注入 URL/sha256 并过 schema 校验；本地 dev-install 验证。
- **M4 发布**：npm 发布（scope 定稿）→ `registry/agent.json`+`icon.svg` 以 `distribution.npx` 先行提交 `agentclientprotocol/registry`（PR，含 Terminal Auth 证明）→ binary 就绪后升级条目；extension 兼容层按需提交 Zed registry（标注旧版）；文档翻译收尾。

## 10. 显式假设与开放项（带默认值）

- npm scope/发布身份：默认 `dsh-acp-zed`，发布前定稿（§4）。
- 文档语言：主文档中文（`docs/design.zh.md`），README 双语；如需纯英文可翻转。
- 依赖基线：以参考实现 A（cordis 4.x / ACP SDK 1.4.0 / dsh-* alpha 同批）或 B（dsh rc.2 stable 全链路）择一的可行基线，M1 安装时锁定实际解析版本并记录；两基线差异在 M1 用真实 Zed 握手实测裁决。
- Registry 分发形态：**npx 先行**（npm 包发布即得，Zed `type:"registry"`）；`distribution.binary`（全 6 平台自包含归档）在 M3 就绪后补齐并随版本升级（对齐 pi-acp 上架实践）。
- startup-info 会话首块（§6.2 可选项）默认**关闭**，由 `quietStartup` 类开关控制，纳入 M2 范围判断。
- 上游 DSH CLI 是否包含 `acp` profile 不影响本设计（自 boot 组合）。
- Zed 版本目标：当前 stable（≥v0.221 Registry/Custom Agent；≥v0.225 会话历史）；extension 兼容层仅面向旧版 Zed。

---
计划批准后，本迭代将按 §5 清单在本仓库创建全部文件并写入完整设计文档。
