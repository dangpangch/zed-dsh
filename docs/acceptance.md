# 验收清单（acceptance.md）

> 分层测试策略见 `design.zh.md` §12。本文件 = 手工真机清单 + 冒烟步骤 + 测试命名基准。
> M1 完成标准 = 第 1 节清单通过；每节按其里程碑标注。

## 1. M1 真机清单（Zed ≥ v0.221；会话历史 ≥ v0.225）——用户执行

前置：`npx -y dsh-acp-zed --list-models` 打印模型目录、exit 0；key 已就绪（env 或 `login`）。

- [ ] Custom Agent 路径：settings 加 `npx` 条目 → Agent Panel 新线程 → 模型答复正常。
- [ ] 沙箱：让 agent 写工程内文件成功；写工程外被拦，弹一次性权限（Allow once / Reject once）可应答。
- [ ] 工具卡片：让 agent 跑 bash 与编辑文件 → 卡片含命令/输出/退出码与文件位置行号；编辑含结构化 diff。
- [ ] 流式：长回答时文本增量可见；思考（thought）流式可见（若模型启用）。
- [ ] 会话选项：线程齿轮菜单能切 Model / Thought Level / Write permission；下一回合生效。
- [ ] 识图：粘贴截图 → agent 能描述（DeepSeek 视觉模型）。
- [ ] 斜杠技能：`/` 菜单列出技能，`/xxx` 可执行；未知 `/xxx` 回落普通输入。
- [ ] ask_user_question：触发提问 → 表单（选项/多选/自定义）弹出并可作答。
- [ ] 会话历史（v0.225+）：recent-threads 可恢复会话，转录回放（含已完成工具调用）。
- [ ] MCP：Zed 配一个 stdio `context_servers` → 新线程出现 `mcp__<server>__<tool>` 工具并可调用。
- [ ] 取消：发送长任务后取消 → 回合以 cancelled 结束、不残留子进程。
- [ ] 认证：无 key 时提示 Authenticate（显示 Log in from the terminal / env 两种 sign-in）；`dsh-acp-zed login` 后恢复可用。
- [ ] Registry 路径（如已发布）：`zed: acp registry` 安装 → settings 显示 `type:"registry"` → 同上功能抽检。
- [ ] 诊断：`dev: Open Acp Logs` 有 JSON-RPC 记录；服务端 stderr 无协议帧泄漏。

## 2. SDK 冒烟（无模型栈，组合级）——脚本化

- spawn `node lib/bin.js`（或归档内 `cmd`）。
- 发送 `initialize`（protocolVersion v1, clientCapabilities {}）→ 收到响应含能力，stdout 每一行都是合法 JSON-RPC。
- `session/new`（cwd 为临时目录）→ 返回 sessionId + configOptions。
- 断 stdin（EOF）→ 进程 exit 0；无孤儿进程。
- 断言：stdout 无任何非 ndjson 行（帧纯净）。

## 3. packaging 冒烟（M3）

- 对每平台归档：解压 → 执行归档内 `cmd`（= `dsh-acp-zed(.exe)`）`lib/bin.js --help` → stderr 有 usage、exit 0（证明可 spawn、运行时完整）。
- `registry/agent.json` 过 `agent.schema.json` 校验（registry 仓库 `verify_agents.py` 等价检查）。
- 归档 sha256 与 manifest/registry/extension 注入值一致。

## 4. 测试命名基准（vitest，M2 起，每个 ACP 行为一个文件）

`config-options` · `auth-methods-terminal` · `session-list-load` · `session-delete` · `session-restore` · `thinking-modes` · `stdout-destroyed` · `slash-commands` · `elicitation` · `image-offload` · `usage-update` · `plan-update` · `mcp-mount` · `multi-session` · `cancel-races` · `teardown-quiescence` · `codec-stop-reasons` · `frame-purity`。

## 5. 回归触发点

改协议映射（`protocol-map.md` 任一表）→ 必须同步改对应测试与真机步骤；参考实现 B/C 的 quirks 若被 Zed 新版本废除，更新 `design.zh.md` 附录 A 并回填本清单。
