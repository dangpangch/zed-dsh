# ACP v1 ↔ DSH 协议映射（protocol-map.md）

> 设计文档 companion。来源标注：U=上游 `@deepseek-ai/dsh-acp` README；A=`@anht3889/dsh-acp-zed`；B=`cnctem/dsh-acp`；C=`svkozak/pi-acp`。硬性 Zed quirks 已在表内标 ⚠。

## 1. initialize 能力声明（如实）

| 能力 | 值 | 条件 |
|---|---|---|
| protocolVersion | SDK 协商（v1） | — |
| session/new · list · load · resume · close · delete | true | delete 尽力而为（B） |
| promptCapabilities | text + `resource_link` + `image` | image 仅当附件存储 + 精确 image 路由（U）；audio/embeddedContext=false |
| elicitation | form | 依 client `clientCapabilities.elicitation.form` 启用（A/B） |
| mcpServers | stdio / streamable-HTTP | deprecated `sse` 拒绝 |
| authentication | Terminal Auth（`--login`）+ env-first | Registry 入册要求（C） |

## 2. 方法逐条

| 方法 | 关键参数/返回 | DSH 行为 | ⚠/备注 |
|---|---|---|---|
| initialize | clientCapabilities | 版本协商 + 能力返回 | — |
| authenticate | — | 有 env key → 成功；否则 `AUTH_REQUIRED` 列 sign-in 方法 | 无 key 不静默降级 |
| session/new | cwd(绝对), mcpServers?, config? | 校验 cwd → 建持久 agent → 返回 configOptions | 图片能力在 admission 时再检真实路由 |
| session/list | cursor/page, cwd? | 持久会话 新→旧 分页 | createdAt 近似 updatedAt（B） |
| session/load | sessionId, cwd? | 校验 header → 释放同 id 在线 → resume → 回放（todo 折叠成一条 plan） | Zed 历史 v0.225+（C） |
| session/resume | sessionId | 连接内恢复 | — |
| session/delete | sessionId | 释放在线 + rm 持久产物，幂等 | seam 无删除 API 时 locate+rm（B） |
| session/close | sessionId | quiescent 只清理本会话 | 其余会话/Context 不动 |
| session/prompt | text/image/resource_link 混排 | 单飞行；准入整批→route 快照→入队 | 拒绝批次不落盘；cancel 赢过准入则无晚到回合 |
| session/cancel | sessionId | 取消在飞 prompt/自主工作 | 未知 id no-op |
| $/cancel_request | — | 同上 | — |
| session/set_config_option | option id+value | model/reasoning_effort/permission 校验→返回完整状态 | 在飞 turn 保持旧值 |
| session/update | sessionUpdate 变体 | 见 §3 | 按会话串行 |
| session/request_permission | requestId, choices | 一次性 allow/reject；foreign 委托；RPC 失败→unavailable fail-closed | 无持久 grant |
| elicitation/create | form | ask_user_question 表单（§4） | client 不支持 → 工具报错不挂起 |

## 3. session/update 变体（渲染面）

| sessionUpdate | 载荷 | dsh 事件源 | ⚠ |
|---|---|---|---|
| agent_message_chunk | text | assistant text-delta | 逐字流式 |
| agent_message | text | assistant/message | 无增量兜底，防重复 |
| thought | reasoning text | assistant reasoning-delta | ⚠ 参考 C 无 thought；本设计含 |
| tool_call | name/input/位置 | tool/call | kind；位置按会话 cwd 解析相对路径 |
| tool_call_update | completed/failed/result/diff | tool/result | 见 §5 diff |
| plan | {entries:[{content,priority,status}]} | todo/write 全表 + turn/start | ⚠ 稳定扁平通道（B/C），priority 恒 medium，turn/start 清空 |
| usage_update | {used,size} | 投影 contextPressure / provider usage | 未知不发；model 切换后刷新 |
| config_update | 完整 configOptions 状态 | set_config_option / 拓扑变化 | 回放不重放旧 update |
| status_update | 生命周期 | — | 最少必要 |

## 4. elicitation 表单映射（ask_user_question）

| dsh 形态 | JSON Schema 片段 | 回填 |
|---|---|---|
| 选项单选 | `{type:'string', oneOf:[{const,title}]}` | label → selected |
| multi_select | `{type:'array', items:{type:'string',enum}}` | labels → selected |
| 自由文本 | `{type:'string'}` | → custom |
| 选项题 + 自定义 | 附加 `{id}__other`（title Other，可选） | 单选 custom 取代 selected；多选并存 |
| 语义 | 无选项题 required；选项题主字段非 required | 未答字段省略 |
| toolCallId | 请求携带 callId（FIFO） | tool/result 清残留 |
| 取消 | decline/cancel → ASK_CANCELLED；abort → ASK_ABORTED | client 无 form 能力 → ELICITATION_UNSUPPORTED |

## 5. diff / 位置约定

- 编辑前对目标文件快照；`tool/result.meta.diffs`（hunk）优先。
- 行号：`oldText`/`old_str` 在快照中**唯一**匹配 → 1-based；多匹配不带行号。
- 结构化 diff：`oldText`/`newText`（或快照前后比对生成）。
- bash/pwsh：terminal 内容（cwd/命令/输出/退出码）；执行仍在 harness 内，ACP 无 terminal/fs 委托。

## 6. configOptions（Zed 渲染为选择器；⚠ Zed 忽略 models/modes）

| id | category | 选项来源 | 切换效果 |
|---|---|---|---|
| permission | permission | 权限预设 3 档（回退 sandboxPolicy 3 档） | 一次性 |
| model | model | llm.listProviders/listModels | 下一 turn |
| thought_level | thought_level | 模型 reasoning efforts；无则规范级表；未声明 default 补 provider-default | 下一 turn；守卫剥 provider-default |

## 7. 与上游 automation-only 差异（一页速览）

| 面 | 上游 U（automation-only） | 本设计（交互档） |
|---|---|---|
| session/load/delete/fork | ✗ | load ✓ delete ✓ fork ✗ |
| elicitation | ✗ | ✓（form，能力门控） |
| thought/message 增量流式 | 提交式 | 提交式 + 增量流式 |
| usage_update / plan | ✗ | ✓ |
| configOptions（permission 档） | model/reasoning 仅 | + permission |
| 命令/技能 | ✗ | available_commands_update + 命令平面执行 |
| MCP | 支持 stdio/HTTP | 同 + 共享实例去重 |
| authenticate | immediate | env-first + Terminal Auth |
