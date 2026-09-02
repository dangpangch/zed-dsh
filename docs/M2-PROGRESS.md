# M2-PROGRESS.md — dsh-acp-zed 交互桥（ACP bridge）实施进度

> 独立实现者工作日志（M2 里程碑，design.zh.md §5/§6/§13，acceptance.md §4）。
> 磁盘为唯一事实来源；本文件在读完必读文档后的第一个动作创建，每完成一个可验证小步追加。

## 1. 结论与关键决策（读码后定版）

- **协议面**：wire 协议 = ACP v1（`PROTOCOL_VERSION = 1`，sdk@0.25.1 与 1.4.0 的 SessionUpdate 联合类型逐名一致）。
  本项目编译/运行目标 = 顶层 `@agentclientprotocol/sdk@1.4.0`（dsh-acp rc.2 包内部另有嵌套 0.25.1，仅其自用，勿混）。
  SDK 1.4.0 的 `AgentSideConnection`（`dist/acp.d.ts` L757，构造 `(toAgent, stream)`）仍是可用 API，
  参照 rc.2 官方 automation 桥（`node_modules/@deepseek-ai/dsh-acp/lib/index.js`）与 `@anht3889/dsh-acp-zed@0.5.0`（同 sdk 1.4.0）的调用形态。
  wire update 名以 sdk 1.4.0 `schema/types.gen.d.ts` `SessionUpdate` 联合为准：
  `agent_message_chunk` / `agent_thought_chunk` / `tool_call` / `tool_call_update` / `plan` /
  `available_commands_update` / `config_option_update` / `session_info_update` / `usage_update`（无旧名 agent_message/thought/status_update）。
- **组合面（rd.2 dsh 服务，与上游同构）**：`ctx.agents.create({sessionId, meta:{cwd}, agentOptions:{provider,model}, setup}) → AgentHandle{agent, dispose}`；
  `ctx.on('session/event', (session, event))`（event.type ∈ turn/start·end、step/start·end、user/message、assistant/chunk·message、tool/call·result、todo/write、request/header·context 等，见 dsh-session types.d.ts）；
  `ctx.on('agent/inbox/claimed', {agent,message,turn})`；`ctx.on('agent/error', …)`；`ctx.sessions.flush(session)`；
  事件订阅句柄都在 host plane（dsh-base bundle），官方 dsh-acp 只 `inject:['agents']` 即可跑 —— 我们同理（llm 等经 `ctx.get`/apply 时捕获）。
- **自引用插件行**：`boot()` 设 `ctx.baseUrl = dirname(boot.yml)`（server/ 包根）；loader 对 `name` 以 `.` 开头者按 `new URL(name, baseUrl)` import（cordis-plugin-loader lib/index.js L263）。
  故适配器行 = `- insert: [{id: acp-zed, name: './lib/src/bridge/index.js', config: {provider, model}}]`（对照 zedref 的 `./lib/src/app.js` 挂法；tsdown entry `src/bridge/index` → `lib/src/bridge/index.js`）。
- **session/new 的 mcpServers**：ACP v1 响应（new/load/resume/list）**无** mcpServers 字段（schema grep 证实，仅请求侧有）；
  “必须回 []”落实为校验：非空 `mcpServers`/`additionalDirectories` → `invalidParams`（参照 rc.2 automation validateSessionParams），空数组放行。
- **能力如实声明**：sessionCapabilities{close, list(仅 P2 实现后), resume?}；loadSession 布尔（P2）；promptCapabilities{text 恒真, image 依 attachment+image 路由准入, audio:false, embeddedContext:false}；elicitation 视 client capability（P2）。
- **usage 数据源**（P2）：dsh-session-projection 已由 dsh-base 挂载（`ctx.sessionProjections`？——实现时按需查 `@deepseek-ai/dsh-session-projection` 的 service 名与 `.snapshot().values.contextPressure`）。
- **P0/P1 硬性离线验证**：smoke 不发 prompt（无 key 环境），仅 initialize + session/new（sessionId + configOptions 需能在无 key 时构造：listModels 离线可用（M1 --list-models 已证），resolveModelInfo 失败须静默降级为规范 effort 表，绝不让 session/new 报错）。

## 2. 分阶段计划与预计改动文件

| 阶段 | 内容 | 预计改动 |
|---|---|---|
| P0 | bridge 核心闭环：initialize/capabilities、session/new（cwd+空 mcpServers）、prompt（文本准入→followup→事件流→turn 结算）、cancel、session/close、quiescent teardown/EOF；codec/content/updates/session-store 支撑 | `src/bridge/index.ts`、`content.ts`、`updates.ts`、`session-store.ts`（codec.ts/config-options.ts 已实，仅接线）；`cordis.patch.yml` 换行；`tests/codec-stop-reasons.test.ts`、`tests/session-store.test.ts` 等 |
| 验证1 | `tsc -p .` + `tsdown` + DSH_HOME 隔离 smoke + vitest | — |
| P1 | configOptions：`model` + `thought_level` 两个 select（listProviders/listModels 目录、resolveModelInfo.reasoning、规范回退表、provider-default 首项显示、默认永不 off）；`set_config_option` 校验+改 selectionRef（installModelSelection，下一 turn 生效）；session/new 响应带 configOptions | `src/bridge/config-options.ts`（补 wire 组装）、index.ts 接线、`tests/config-options.test.ts`、`tests/thinking-modes.test.ts` |
| 验证2 | 同上四组命令 | — |
| P2（P0+P1 全绿后尽力） | session/list·load·delete（persistence stat/list + resume + 折叠回放）、usage_update、todo→plan、thought/message 增量流、tool 卡片/diff、available_commands_update+slash、request_permission、elicitation、识图 | 相应模块 + `tests/` 对齐 acceptance §4 命名 |
| 收尾 | M2-PROGRESS 更新、最终汇报 | 本文件 |

验证命令（每次阶段）：
```
cd /home/pang/ws/harness/zed-dsh/server
./node_modules/.bin/tsc -p .
./node_modules/.bin/tsdown
DSH_HOME=$(mktemp -d); printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}' '{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp","mcpServers":[]}}' | timeout 90 node lib/bin.js
./node_modules/.bin/vitest run
```

## 3. 日志

（见下文追加）

## 3.1 P0/P1 实施完成记录（第 1 大步验证绿）

已实现（P0+P1 主体，见 §2 文件清单）：
- `bridge/session-store.ts`：SessionStore 注册表 + PromptInflight（单飞行槽，含 promise/结算簿记）+ makeRecord + drainRecord/requestStop 原语。
- `bridge/updates.ts`：wire 构建器（agent_message_chunk/agent_thought_chunk/plan/usage_update/available_commands_update）+ 历史 todo 折叠 foldTodoPlan（回放只发一条）。
- `bridge/content.ts`：scanPrompt 校验（text/resource_link/图片准入，audio/resource 拒绝）、persistImages（dsh-attachment saveImages，错误映射 invalid/internal）、contentForPrompt 有序重建（含空 prompt 拒绝）。
- `bridge/codec.ts`：对齐 sdk 1.4.0 现行 v1 `StopReason` 联合（end_turn/max_tokens/max_turn_requests/refusal/cancelled——无旧 'error'/'stop_requested'）；settledStopReason（error→null 走 reject；max-tokens→end_turn）。
- `bridge/config-options.ts`：P1 已接线（原纯函数保留，无改动）。
- `bridge/index.ts`：完整插件 apply —— initialize/capabilities（close:{}，loadSession:false，image 依 attachment+model 准入）、session/new（cwd 校验+空 mcpServers 校验+agents.create+installModelSelection+configOptions）、prompt（单飞行、guardCurrentEffort、admission→followup→assistant/message→turn/end 结算经 codec）、cancel、closeSession、setSessionConfigOption（model/thought_level 校验，provider-default 剥离，下一 turn 生效）、EOF 排空（activeRequests 追踪 + quiesce 等待在飞 handler）、每会话 quiescent teardown。
- `cordis.patch.yml`：M1 官方 automation 行已替换为 `id: acp-zed, name: './lib/src/bridge/index.js'`（加载器按 ctx.baseUrl=server/ 解析，tsdown entry `src/bridge/index`→`lib/src/bridge/index.js`）。

验证输出摘要（DSH_HOME 隔离）：
- `tsc -p .` exit 0；`tsdown` 产出 lib/bin.js + lib/src/bridge/index.js。
- 冒烟（immediate EOF，连跑 3 次均 2 result + exit 0）：initialize → capabilities{close:{}}；session/new → sessionId + configOptions[model{3 模型} , thought_level{off/low/high/max, current=high}]；stdout 无杂讯；mcpServers:[] 放行；EOF exit 0。
- 卡点/修复记录：
  1. cordis `cannot get property "sessions" without inject` → inject=['agents','sessions']。
  2. **EOF 竞态（关键）**：session/new 在响应路径上 await `sessions.flush`（磁盘 I/O ~19ms），immediate-EOF 管道下 SDK 在 flush 完成前关闭连接 → 回复被丢弃（exit 0 但只 1 条 result）。根因=客户端 EOF 即 transport close，回复只能在 EOF 处理前落盘。修复：flush 移出响应路径（改 fire-and-forget + teardown closeOne 内 flush 兜底），agent.create+configOptions 均在 EOF 前完成 → 与官方 dsh-acp 同速。
  3. 手改 built lib 调试会损坏产物（python 插桩碰坏代码），调试改 src+rebuild。
- 待办：P0 vitest（codec/config-options/session-store/content/updates）、P1 边界测试、真实 prompt 链路验证（无 key 时按契约以 error reject、不挂起）、P2。

## 3.2 P0+P1 全绿（vitest 51 passed）

- vitest：codec-stop-reasons / config-options / session-store / updates(plan-update·usage-update 折叠) / content(image-offload 基础) / frame-purity（真实 spawn lib/bin.js + DSH_HOME 隔离，initialize+session/new 纯 ndjson、exit 0）→ 6 files / 51 tests passed。
- 顺手修两处模块级小问题：config-options.modelSelectOptionList 的 currentValue 现在校验目录成员资格（陈旧/休眠 route 回退首项，Zed 下拉永不指向缺失项）；base64 规范仅收带 padding 的 canonical 形式（与 rc.2 dsh-acp 一致）。

## 3.3 P2 部分实施（尽力而为，P0/P1 保持全绿）+ 最终验证

P2 已做（均保持 57 测试全绿 + smoke 两 result + exit 0）：
- `usage_update`：assistant/message · tool/result · turn/end 后经 ctx sessionProjections（dsh-token-meter 的 contextPressure 投影：used=projectedTokens??pressureTokens，size=contextWindow；任一未知不发）。
- `todo→plan`：todo/write 整表替换发 `plan`（priority=medium，全量覆盖，同 fold 去重）；turn/start 在曾发过 plan 后清空列表。
- thought/message 增量流式：assistant/chunk（text-delta→agent_message_chunk，reasoning-delta→agent_thought_chunk），按 (turn,step,index) 累积去重；assistant/message 只补未流式的 remainder（updates.ts 纯函数 streamTextDelta/committedBlockRemainder，有单测，杜绝重复帧）。
- tool 卡片：tool/call → `tool_call`（pending，rawInput，粗粒度 kind），tool/result → `tool_call_update`（completed/failed，结果文本截断 8k）；diff/terminal 细粒度渲染未做（见 Known Limitations）。
- `available_commands_update` + slash：session/new 后 setTimeout(0) 延后通告（smoke 已见 compact/feedback/goal/permission/plan 5 条）；prompt 以 `/` 开头 → commands.execute（命令平面，不进模型历史；未命中回落普通输入；结果以 agent_message_chunk 回显，回合 end_turn；带图原始 base64 直传命令平面）。
- `request_permission`：approval/request（桥自有 agent + callId）→ conn.requestPermission allow-once/reject-once；foreign/call-less → next()（fail-closed 语义不变）。
- 识图通道：content.ts 准入+持久化 + promptCapabilities.image 依 attachment store ∩ 模型 inputModalities 如实开关（默认 deepseek-v4-flash → false，诚实）。

P2 明确未做（不广告 → Zed 不呈现，不留半坏路径）：
- session/list · load(回放) · delete：未实现，initialize 仍如实 loadSession:false / sessionCapabilities 仅 close:{}。
- elicitation（form）：本组合未挂 ask_user_question 工具，无提问来源；能力门控逻辑未启用。
- terminal/diff 卡片的 tool-owned presentCall/presentResult 精细集成：当前为通用卡片（ponytail: ceiling=无工具所有者视图；升级路径=接 dsh-tools ToolRuntime present*→ACP diff/terminal 内容）。
- MCP 挂载（mcpServers 非空 → invalidParams，设计 §6.7 归 M4）。

最终验证（DSH_HOME=$(mktemp -d) 隔离，全部贴汇报）：
1. `tsc -p .` exit 0
2. `tsdown` 49.38 kB（bin.js + src/bridge/index.js）
3. smoke：initialize result + session/new result（sessionId + configOptions[model×3, thought_level off/low/high/max, current=high]）+ available_commands_update×5 + exit 0；stdout 纯 JSON-RPC
4. `vitest run`：6 files / 57 tests passed（codec-stop-reasons / config-options / session-store / updates / content / frame-purity）

## 3.4 主会话复核（独立验证，非实现者自报）

- 复核四组命令（DSH_HOME=$(mktemp -d) 隔离）：`tsc` exit 0；`tsdown` 49.38 kB（lib/bin.js + lib/src/bridge/index.js）；冒烟 = initialize result + session/new result（sessionId + configOptions[model×3, thought_level current=high]）+ 延后 available_commands_update + exit 0，stdout 纯 JSON-RPC；`vitest` 6 files / 57 passed。
- 修复一处时序性测试缺陷（§3.3 的“57 passed”依赖运行时机）：`frame-purity.test.ts` 原断言 stdout 恰好 2 行，但 available_commands_update 经 setTimeout(0) 延后于 session/new 响应（design §6.6），immediate-EOF 下该帧是否先于退出落盘取决于事件循环竞态 → 断言放宽为“两条 result 必在 + 至多一条合法 session/update 通告”，并逐帧校验形状（acceptance §2 仅要求帧纯净，无行数要求）。连跑 6 次 + 全套 3 次稳定通过。
