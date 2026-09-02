# zed-dsh 设计文档（docs/design.zh.md）

> DeepSeek Harness 的 Zed Agent —— ACP v1 服务器 + 分发（Registry/Custom Agent 为主，旧版 Zed 扩展为兼容附录）。
> 状态：设计定稿（本文件与 `plan.md` 一致）；工程骨架同期落地；M1–M4 为实施里程碑（见 §13）。
> 决策记录：`plan.md` §7（用户确认：Zed 官方现行标准优先、交互档功能基线、参考实现不 fork 不依赖）。

## 1. 背景与目标

DSH（DeepSeek Harness）是 Cordis 组合式 agent 运行时。Zed 通过 **Agent Client Protocol（ACP）v1**（JSON-RPC 2.0 over stdio）与外部 agent 进程通信，将其呈现为 Agent Panel 线程。本工程让用户在 Zed 中把 DSH agent 作为外部 agent 使用：建会话、流式输出、工具卡片、权限、模型/思考档位、会话历史与恢复，全部走标准 ACP。

- 不重写 DSH，不改上游（deepseek-ai/deepseek-harness）：bridge 在已发布 `@deepseek-ai/*` 包（agent spine、JSONL 会话持久化、approval seam、skills、sandbox 等）之上实现。
- 不 fork、不依赖第三方参考实现（`cnctem/dsh-acp`、`@anht3889/dsh-acp-zed`、`svkozak/pi-acp`）；三者只作为交互面映射、Zed quirks 与实现手法的知识基准（§14 附录 A/B/C）。
- 分发遵循 Zed 官方现行标准：ACP Registry（npx 先行、binary 后补）+ Custom Agent；extension.toml 仅兼容旧版 Zed（官方已弃用）。

## 2. 术语

| 词 | 含义 |
|---|---|
| ACP v1 | Agent Client Protocol，客户端(Zed)⇄agent 的 stdio JSON-RPC；官方 SDK `@agentclientprotocol/sdk` |
| Registry | ACP Registry（`agentclientprotocol/registry`），Zed ≥v0.221 "Install from Registry"；条目 = `agent.json`+`icon.svg` |
| Custom Agent | Zed settings `agent_servers.<name>{type:"custom",command,args,env}` |
| Agent Server Extension | Zed 旧扩展机制（`extension.toml` 的 `agent_servers`，官方已弃用，仅旧版 Zed） |
| automation-only | 上游 `@deepseek-ai/dsh-acp` 的公开契约（无编辑器交互面） |
| bridge / acp-zed | 本工程的 ACP 服务器插件（`server/src/bridge`），核心交付代码 |
| configOptions | `session/new`/`load` 返回的会话配置选项（Zed 渲染为下拉选择器） |

## 3. 需求与非目标

需求（交互档基线，参考实现对齐后的取舍）：

1. Zed 线程可用 DSH agent：新建/恢复/列出/删除会话，流式文本与思考、工具卡片与结构化 diff、上下文圆环、todo→plan。
2. 会话选项：模型、思考档位、写权限（一次性）——Zed 原生下拉。
3. 认证：`authenticate` + Terminal Auth（`login/--login`）与 env-first key，满足 Registry 入册。
4. MCP：挂载 Zed `context_servers` 转发的 `mcpServers`（stdio/HTTP）。
5. 斜杠技能：`available_commands_update` 通告并执行。
6. 识图：光栅图 prompt 经 `dsh-attachment` 持久化准入。
7. `ask_user_question` → ACP form elicitation（能力门控）。
8. 安全：bash 不离开 harness 沙箱；stdout 只承载协议帧；密钥不进组合文件。

非目标（Known Limitations，v1 显式不做）：会话 fork；`session/delete` 之外的额外目录（additionalDirectories）；音频/embedded-resource prompt；ACP fs/terminal 委托（execution 不移出 harness）；终端逐字符流式（bash 仅 tool/call→result 两事件，结果一次性渲染）；reasoning 之外的私密 DSH 呈现数据（plan 标题/模式/命令等走标准 update）；持久授权 grant；后台 job 工具（v1 不挂）；HMR（配置重启生效）。

## 4. 架构

### 4.1 进程视图

```
Zed (Agent Panel)
   │  ACP v1 JSON-RPC over stdio（stdout 只承载 ndjson 帧）
   ▼
dsh-acp-zed 进程（分发：registry binary 归档 / npx / node lib/bin.js）
   │  boot()：自 boot cordis 组合 = 随包 cordis.yml + 用户 overlay(~/.dsh/acp-zed/overlay.cordis.yml)
   ▼
组合行（宿主平面）：
  llm-deepseek（provider/model 行）│ llm-pi-ai（dormant，settings 热更注入自定义路由）
  sandbox-policy（DSH_PERMISSION_MODE ?? workspace-write）+ fs-sandbox + bash-sandbox + subprocess
  user-approval（approval seam）│ credentials/settings（~/.dsh/acp-zed/）│ skills│ MCP mount
组合行（agent 平面，每会话）：
  acp-zed bridge（AgentSideConnection ⇄ agent spine ⇄ JSONL 会话持久化 + session query）
```

- 进程生命周期：`bin.ts` 先处理非 serve 动词（见 §9）→ 解析 key 注入 env → `boot()` → serve；stdin EOF/断连 → quiescent dispose → exit 0。
- 每连接多会话：一个 AgentSideConnection 持有若干 session 记录，彼此隔离；teardown 只清理被关会话（含其子 agent），不动共享 Context。

### 4.2 状态目录（`$DSH_HOME/acp-zed/`，默认 `~/.dsh/acp-zed/`）

| 文件 | 作用 | 生效方式 |
|---|---|---|
| `settings.yaml` | provider 路由（`llm-pi-ai.providers`）等 | 热更（下一请求生效） |
| `credentials.yaml` | 自定义 provider 凭据（env 优先） | 即时 |
| `overlay.cordis.yml` | 用户补丁层（改组合/插插件） | 重启生效 |
| `sessions/` | JSONL 会话持久化 | — |
| `auth.env` | Terminal Auth 持久 key（mode 600） | 启动读取（env 优先） |
| `plugins/` | `plugin add` 私有 workspace | 重启生效 |

`$DSH_HOME` 默认由 `@deepseek-ai/dsh-home-paths` 解析（`~/.dsh`）；可用 env 重定位。

### 4.3 启动/退出顺序（stdout 纯净不变量）

1. argv 分派（help/list-models/login/logout/mcp/plugin 走 stderr+stdout 专用通道，exit）。
2. serve 分支：resolve key → seed `process.env`（先于组合 `!!js` 表达式解析）。
3. `boot()`：加载随包 `cordis.yml` + overlay 补丁；mount 校验失败则 fail-loud（stderr）exit≠0。
4. stdin EOF / SIGINT / SIGTERM：单次 dispose（cancel prompts → drain updates → dispose 子 agent → flush 持久化）→ exit 0。
5. stdout 被客户端提前销毁：静默吞写错误不崩溃（`ERR_STREAM_DESTROYED` 防护）。

## 5. 模块地图

```
server/                            # npm 包 dsh-acp-zed（bin: dsh-acp-zed）
  cordis.yml                       # 默认组合（§4.1）；打包进 files
  src/bin.ts                       # CLI 入口：动词分派 + key seed + boot + EOF 生命周期   [M1 打通]
  src/config.ts                    # 路径解析（dshHomePath）+ config/overlay 装载          [M1]
  src/auth.ts                      # login/logout（Terminal Auth 持久 key, mode 600）      [M1]
  src/mcp-store.ts                 # mcp 动词：stdio/http(OAuth) 目录读写接口               [M2/M4 可选]
  src/plugins.ts                   # plugin add/list/remove（managed overlay 块）           [M2/M4 可选]
  src/bridge/index.ts              # 插件入口：连接装配、每会话记录、teardown               [M2]
  src/bridge/content.ts            # prompt 验收与投影（文本/image/resource_link）          [M2]
  src/bridge/updates.ts            # 语义更新序列化（message/thought/tool/usage/plan）      [M2]
  src/bridge/codec.ts              # turn 结束 → stopReason 全映射（纯函数）               [M2]
  src/bridge/session-store.ts      # 会话注册/load 回放/resume/list/close                  [M2]
  tests/                           # vitest：命名对齐 §12.2 基准                            [M2]

packaging/
  build-archive.mjs                # 自包含归档（node 运行时改名 + lib 平铺）；--manifest 离线生成  [M3 下载/组装；manifest 已可用]
  archive-manifest.json            # 平台 → {url, sha256}（构建注入 registry/extension）      [生成物]

registry/  extension/              # 分发产物，见 §7
```

`src/*` 本迭代为可读骨架：签名/不变量/`TODO(M#)` 锚点（指向本文档章节），不保证可运行；M1–M2 按里程碑填实。

## 6. 协议契约（ACP v1 ↔ DSH）

来源标注：U=上游 dsh-acp README；A=`@anht3889/dsh-acp-zed`；B=`cnctem/dsh-acp`（含 quirks）；C=`svkozak/pi-acp`。详细逐帧矩阵见 `protocol-map.md`。

### 6.1 方法矩阵（本设计实现）

| 方法 | 行为 | 备注/来源 |
|---|---|---|
| `initialize` | 协商版本；如实声明能力：session list/load/resume/close、configOptions、MCP stdio/http、图片（仅当附件存储+精确 image 路由）、elicitation（form） | U |
| `authenticate` | env 有 key → ok；否则 `AUTH_REQUIRED` 报缺并声明 sign-in 方法：Terminal Auth（`--login`） | U/A/C |
| `session/new` | 校验绝对 `cwd`；挂载 `mcpServers`（stdio/HTTP）；创建持久 agent；返回 configOptions + 会话信息 | U |
| `session/list` | 持久会话分页（新→旧）；可选 cwd 过滤 | U/A/B |
| `session/load` | 校验持久 header → 释放同 id 在线会话 → resume → 回放转录（不重放旧 update）→ 返回 configOptions | A/B |
| `session/resume` | 同 load 语义（连接级） | U/A |
| `session/delete` | 释放在线 + 删除持久产物（seam 无 API 时 locate+rm，尽力而为、幂等） | B |
| `session/close` | quiescent：停新工作→cancel 准入/agent→drain 有序 update→dispose 子 agent→flush→只释放本会话 | U |
| `session/prompt` | 每会话单飞行；文本+光栅图（`{type:"image",mimeType,data}`，持久化准入、被拒批次不落盘）；route 快照 pin 本回合 | U |
| `session/cancel` / `$/cancel_request` | 取消在飞 prompt（准入/agent）；无 prompt 时取消自主工作；未知 id no-op | U |
| `session/set_config_option` | `model`/`reasoning_effort`/`permission`（一次性档位）→ 返回完整新状态 | U/A/B |
| `session/update` | 提交式语义更新，按会话串行（见 §6.2） | U |
| `session/request_permission` | bridge 持有 agent 的一次性审批（allow_once/reject_once）；foreign/call-less 委托；失败 fail-closed | U |
| elicitation `elicitation/create` | `ask_user_question` 表单（见 §6.4）；client 无 capability → 工具自解释失败不挂起 | A/B |

不实现：`session/load` 之外无 replay 接口差异；fork；audio/embeddedContext（image 之外）；additionalDirectories；命令/模式/计划/终端/客户端 fs 的 ACP 面（见 §3）。

### 6.2 update / 渲染约定

| dsh 事件 | ACP update | 约定 |
|---|---|---|
| assistant 增量（text） | `agent_message_chunk` | 逐字流式 |
| assistant 增量（reasoning） | thought 更新 | 思考流式 |
| assistant/message | 兜底提交文本 | 仅无增量时回退，避免重复 |
| tool/call·result | `tool_call` / `tool_call_update` | kind、文件位置（相对路径按会话 cwd 解析）、原始入参 |
| write/edit/str_replace | diff 卡片 | 编辑前快照；`oldText`/`old_str` **唯一**匹配推断 1-based 行号（歧义不带）；`oldText`/`newText` 结构化 diff（有 hunk meta 优先） |
| bash/pwsh | terminal 内容 | 仅展示元数据（cwd/命令/输出/退出码），执行仍在 harness（§10） |
| todo/write | `plan` 更新 | 稳定扁平 `entries` 全量替换；`priority` 固定 medium；turn/start 清空（仅当曾发过 plan）；load 回放时折叠为一条 |
| token 计量 | `usage_update` | used/size；assistant/message、tool/result、turn/end 后推送；load 播种；set_config_option(model) 后刷新；未知不发 |

**Zed quirks（硬约束，来自 B/C）**：`configOptions` 存在时 Zed 忽略 `models/modes`，所有用户可见选择器必须进 `configOptions`；plan 用稳定扁平通道而非 UNSTABLE `plan_update`；`available_commands_update` 用 `setTimeout(0)` 延后到 `session/new`/`load` 响应之后（Zed 忽略未知 sessionId 通知）；Zed 会话历史/导入自 **v0.225.0** 支持；客户端提前关闭 stdout 不能导致进程崩溃。

### 6.3 configOptions（Zed 下拉）

| id | category | 来源 | 语义 |
|---|---|---|---|
| `permission` | permission | `ctx.permissionPresets`/`sandboxPolicy`（read-only / workspace-write / danger-full-access） | 一次性档位；switching 无持久 grant |
| `model` | model | `ctx.llm.listProviders/listModels` | `installModelSelection` 运行时切换 |
| `thought_level` | thought_level | 模型 reasoning efforts；无元数据回退规范级表；未声明 defaultEffort 时补 `provider-default`（请求守卫剥离，不发任何 effort） | 默认永不回退 `off` |

load/切换期间 option 变更：在飞 turn 保持旧 route，下一 turn 生效。

### 6.4 elicitation（ask_user_question）

| dsh 问题形态 | form 属性 |
|---|---|
| 选项单选 | `{type:'string', oneOf:[{const,title}]}`；选中 label → `selected` |
| multi_select | `{type:'array', items:{type:'string',enum}}`；labels → `selected` |
| 自由文本 | `{type:'string'}`；文本 → `custom` |
| 选项题+自定义 | 附加可选 `{id}__other` 字段；单选时 custom 取代 selected；多选并存 |

- 客户端 `clientCapabilities.elicitation.form` 才启用；`elicitation/create` method-not-found → 工具报 `ELICITATION_UNSUPPORTED` 自解释错误，不挂起回合。
- `tool/call`(ask_user_question) 时 callId 入 FIFO 队列，elicitation 请求携带 `toolCallId`；`tool/result` 清理未消费 callId。decline/cancel → `ASK_CANCELLED`，abort → `ASK_ABORTED`。

### 6.5 识图（image prompt）

`promptCapabilities.image: true`（audio/embeddedContext=false）。准入：`EncodedImageAttachment`（canonical base64）→ `admitEncodedImages`（`dsh-attachment`：限额/类型/顺序/规范化）→ 持久引用 `sha256:…`。拒绝按 `ImageAdmissionErrorCode` 路由 → `invalidParams`，被拒批次不落对象；存储故障 = 内部错误。按原块顺序重建用户消息（text/resource_link 保持文本，image 成 `ImageBlock`）。`/` 指令路径由命令平面自己准入，桥不重复（防双份落盘）。load 回放中图片消息 → `[image: <name/type>, WxH px]` 文本占位。

### 6.6 斜杠技能与内置命令

- `session/new`/`load` 后经 `ctx.commands.list(agent)` 枚举 dsh 指令 → `available_commands_update`（`{name, description, input?}`），`setTimeout(0)` 延后。
- prompt 以 `/` 开头：命中 → 命令平面执行（不进模型历史），结果以 `agent_message_chunk` 回显，回合以 end_turn 结束；携带图片的命令收到原始上传。未命中/非法 → 回落普通模型输入。带消息命令由 handler 自行 `agent.steer()`，桥等待收敛。
- 技能：沿用 harness 技能栈（`skill` 工具 + `.dsh/skills`、`.agents/skills` 根），斜杠菜单与可用命令合并。

### 6.7 MCP

- `session/new` 的 `mcpServers`（stdio/streamable-HTTP）经 `@deepseek-ai/dsh-mcp-client` 挂载；共享实例按 server 名去重（`mcp__<server>__<tool>`）。拒绝 deprecated `sse`。不可达软失败（会话照常，stderr 具名）。配置变更需重启（bridge 持首次 mount 配置，第二线程配置分歧 → 报错指向重启）。
- OAuth HTTP 服务器（M4 可选项）：Zed 自身转发 external agent 时剥离 oauth（其源实现），由 bridge 用共享目录（`$DSH_HOME/mcp` 的 servers+secrets）解析/刷新 token；静态 header 服务器放 Zed `context_servers`。

## 7. 分发与安装（Zed 官方现行标准为主）

| 路线 | 载体 | 版本锚点 | 状态 |
|---|---|---|---|
| ① ACP Registry | `registry/agent.json`（npx 先行；M3 补 `distribution.binary` 全 6 平台）+ `icon.svg` → PR `agentclientprotocol/registry` | Zed ≥v0.221 | M4 |
| ② Custom Agent | `npx -y dsh-acp-zed` / `node lib/bin.js`（dev） | 任意 | M1 可用 |
| ③ 旧版扩展（兼容附录） | `extension/extension.toml`（归档与 ① binary 共用） | ≤v0.22x | M3+ |

- Registry 条目要求（`AUTHENTICATION.md`）：支持 Agent Auth 或 Terminal Auth → 本设计实现 **Terminal Auth**（`login`/`--login`），`authenticate` 经 `AUTH_REQUIRED` 通告。
- 入册后 Zed settings 显示 `agent_servers.deepseek-harness = {type:"registry"}`，版本由 Registry UI 管理；用户可经 `agent_servers.<id>` 覆盖 env。
- 安装手册与排障：`zed-setup.zh.md`。

## 8. 打包设计

**自包含目录归档（主）**：每平台目录 = 官方 node 运行时（改名 `dsh-acp-zed(.exe)`，避免宿主 node 依赖）+ `lib/`（tsdown 产物）+ `cordis.yml` + `package.json`。`cmd` 直接指向改名后的 node 可执行、`args=["lib/bin.js"]`——绕开 Node SEA 对 cordis 动态 import/原生模块的限制。归档格式 tar.gz/.zip（Registry binary 平台键 6 个；extension 仅当平台有 target）。

- 注：若 bridge 组合含原生可选依赖（如 pty 类 prebuilds），归档在**对应 OS 原生矩阵**上构建并锁定 prebuild（CI 见 §13 M3）。
- `cmd` 相对归档根；`sha256` 由流水线计算注入 `registry/agent.json`/`extension.toml`（Registry schema 要求 64 hex）。
- **薄封装（备，dev/Custom Agent）**：宿主机 node `^22.19||>=24`，`npx -y dsh-acp-zed` 或全局 bin。
- Node SEA：未来优化项（体积），依赖验证（动态 import/原生模块）后再定；不做 v1 承诺。

**打包脚本**：`packaging/build-archive.mjs`：`--manifest`（离线，生成 `archive-manifest.json`，已可用）；`--platform <os-arch> --node <ver>`（M3：下载 node dist、装依赖、组装、产出归档+sha）。CI `release.yml` 矩阵调用并上传 GitHub Release；随后注入 registry/extension 清单。

## 9. CLI（`dsh-acp-zed`）与认证

```
usage: dsh-acp-zed [--config path] [--list-models] [--help] [login|logout|mcp …|plugin …]
默认：serve ACP（stdout 只承载 JSON-RPC 帧；诊断/帮助走 stderr）
  login / logout          Terminal Auth：auth.env(mode 600) 读写（--login 别名，供客户端唤起）
  mcp add http|stdio …    MCP 目录管理（M4 可选，含 OAuth 浏览器舞步）
  plugin add|list|remove  用户插件（managed overlay 块 + 私有 workspace）
  --list-models           打印 provider/model 目录到 stderr 后退出（自检）
```

key 解析顺序：`DEEPSEEK_API_KEY` env → `$DSH_HOME/acp-zed/auth.env`。无 key：authenticate 报缺并展示 Terminal Auth（不静默降级、不把"无模型/无 key"伪装成别的错）。`--login` 以交互进程方式 spawn 登录并透传退出码（对齐 C）。密钥永不打日志/不进组合文件/不进协议帧。

## 10. 安全边界

- stdout 纯净：serve 期无任何非协议输出；`--help`/诊断全走 stderr；无 stdout logger；进程级不 monkey-patch。
- bash/文件执行不离开 harness：ACP 不提供 `terminal/*`/`fs/*` 执行委托；工具仍在 sandbox-policy（默认 workspace-write；`DSH_PERMISSION_MODE` 部署覆盖）内执行，越权走 approval seam → `session/request_permission`（一次性）。
- 一次性权限无持久 grant；prompt 准入图片校验失败 → invalidParams；stdout 提前销毁防护（§4.3）。
- key 文件 mode 600；归档 sha256；组合/overlay 是可信补丁层（文档声明边界）。

## 11. 边界情形与失败模式

| 场景 | 行为 |
|---|---|
| GUI 启动 Zed 看不到 nvm PATH | 文档提示：`which npx` 绝对路径作 command，或从终端启动 `zed .` |
| 缺 key / 配置缺失 | `authenticate`/新会话报缺并展示 sign-in；`--list-models` 0/非 0 自检具名原因 |
| stdin EOF / 断连 | quiescent dispose；挂起的 prompt 记 cancelled；不 orphant 未发布 handle |
| resume/load 时 cwd 失效 | 校验失败 → 具名错误，不挂起 |
| MCP 不可达 / 变更 | 软失败会话照常 + stderr 具名；配置分歧要求重启 |
| 客户端提前关 stdout | 静默吞 `ERR_STREAM_DESTROYED`，exit 0 |
| Windows | 引号/路径（`file:///C:/` URL 形式）、`.exe` cmd |
| 并发会话 / cancel | 每会话隔离；`$/cancel_request` 只影响目标 prompt |
| 未知 session id / 多余帧 | no-op / 忽略 |

## 12. 测试与验收

### 12.1 分层

1. 单元：codec（stopReason 全映射）、ndjson 帧纯净、content 验收/图片准入拒绝映射、update 顺序。
2. 组合级 SDK 冒烟：真实 spawn（`smoke-acp`）→ initialize → session/new → 帧纯净断言 → EOF exit 0；含 skip-notification 等待。
3. keyed e2e：真模型请求，无 key 自跳过。
4. packaging 冒烟：归档内 cmd 可 spawn 完成握手。
5. 静态：`registry/agent.json` 过 `agent.schema.json`。
6. Zed 真机手工：Registry 安装 + Custom Agent + 会话历史(v0.225+) + `dev::OpenAcpLogs`（`acceptance.md` 步骤，用户执行，M1 完成标准）。

### 12.2 测试命名基准（对齐 A/B/C 粒度）

每个 ACP 行为一个测试文件：`config-options` / `auth-methods-terminal` / `session-list-load` / `session-delete` / `thinking-modes` / `stdout-destroyed` / `slash-commands` / `elicitation` / `image-offload` / `usage-update` / `plan-update` / `mcp-mount` / `multi-session` / `cancel-races` / `teardown-quiescence`。

## 13. 里程碑

| # | 内容 | 完成标准 |
|---|---|---|
| M1 | server 包可安装运行：`--help/--list-models/--login`；Custom Agent 在真实 Zed(≥v0.221) 跑通首会话；SDK 握手实测（1.4.0 vs 参考实现 pin） | 用户按 `acceptance.md` M1 清单验收 |
| M2 | bridge 按 §5/§6 填实（content/updates/codec/session-store + 权限/认证/elicitation/configOptions） | vitest + SDK 冒烟绿；测试命名对齐 §12.2 |
| M3 | 自包含归档全矩阵 + CI Release + registry/extension 注入（binary）；schema 校验 | `build-archive --platform` 全平台产物 + 冒烟 |
| M4 | npm 发布（scope 定稿）→ Registry npx 先行 PR（含 Terminal Auth 证明）→ binary 升级；旧版扩展按需；文档收尾 | PR 合入 registry |

## 14. 风险与开放项

| 项 | 默认/缓解 |
|---|---|
| 依赖基线：rc.2 stable（B 链路） vs master alpha（A/U 链路，SDK 1.4.0） | M1 安装实测锁定；两套 bridge 接口名差异（agent spine/session query 等）在 M1 核对后定版 |
| 上游公共服务接口在已发布版本中是否齐备（load 回放/usage 投影/skills 枚举等） | 参考 A/B 同版 pin 为可行性下限；缺口改"桥自维护最小投影"并记录 |
| npm scope/发布身份 | `dsh-acp-zed`（占位），发布前定稿 |
| startup-info 会话首块（版本/模型/技能摘要） | 默认关闭（`quietStartup` 类开关），M2 范围判断 |
| Registry binary 平台（linux-aarch64 无自托管 runner） | M3 评估 qemu/自托管；npx 先行不受影响 |
| Zed 版本漂移（configOptions/plan/会话历史协议面） | 真机验收（§12.1.6）随 M1 执行并回填 quirks |

## 附录 A：Zed quirks 清单（设计已吸收）
configOptions 优先于 models/modes；plan 稳定扁平通道；`available_commands_update` 时序；mcpServers 转发（Zed 剥离 oauth）；会话历史 v0.225+；stdout 提前销毁防护；GUI PATH 问题。

## 附录 B：与上游 automation-only 的差异（本设计新增面）
session/load 回放、delete、elicitation（ask_user_question）、thought 流式、usage_update、plan(todo)、configOptions（permission 档）、slash 技能命令、MCP 挂载、authenticate sign-in 方法、startup-info（可选）。执行委托与权限语义不变（工具仍在 harness 内）。

## 附录 C：参考链接
- Zed Agent Server Extensions / External Agents / Agent Settings（zed.dev/docs）
- ACP：agentclientprotocol.com；SDK `@agentclientprotocol/sdk`；Registry `agentclientprotocol/registry`（agent.schema.json/FORMAT.md/AUTHENTICATION.md）
- DSH：`@deepseek-ai/dsh-acp`、`@deepseek-ai/dsh-acp-app`（deepseek-ai/deepseek-harness）
- 参考实现（仅作知识基准）：`cnctem/dsh-acp`；`@anht3889/dsh-acp-zed`；`svkozak/pi-acp`
