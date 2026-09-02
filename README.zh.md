# zed-dsh — DeepSeek Harness × Zed Agent

在 Zed 的 Agent Panel（及其他 ACP 客户端）中运行
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) agent：
ACP v1 stdio 会话，流式文本与思考、工具卡片与结构化 diff、每会话模型/思考档位/写权限选择器、会话历史、斜杠技能、识图、MCP、一次性权限。

**状态：M0 骨架 + M1 本地完成。**
M1：基线锁定（dsh rc.2），server 可安装构建，CLI 动词通过
（`--help`、`login/logout` 落 mode-600 auth.env、`--list-models` 自 boot 完整
`dsh-base`+补丁组合并打印 provider/模型目录）。剩余 M1 项——真实 Zed 首个
ACP 会话——随 M2 交互桥落地。 完整设计见 [docs/design.zh.md](docs/design.zh.md)；
里程碑（M1–M4）见 `plan.md`（M1 = Custom Agent 可跑通）。

## 安装（当前 Zed ≥ v0.221）

1. **ACP Registry（推荐，M4 发布后）**：`zed: acp registry` → DeepSeek Harness。
2. **Custom Agent**：Zed settings 粘贴（见 `examples/`）：

```json
{
  "agent_servers": {
    "DeepSeek Harness": {
      "type": "custom",
      "command": "npx",
      "args": ["-y", "dsh-acp-zed"],
      "env": {}
    }
  }
}
```

3. 旧版 Zed（≤ v0.22x）：`extension/` 兼容附录（官方已弃用）。

安装与排障手册：`docs/zed-setup.zh.md`。
