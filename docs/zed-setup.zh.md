# zed-dsh 安装手册（zed-setup.zh.md）

> DeepSeek Harness 作为 Zed 外部 agent。三路线：① ACP Registry（推荐，Zed ≥ v0.221）② Custom Agent（dev/免注册）③ 旧版扩展（仅 ≤ v0.22x）。
> 完整设计见 `design.zh.md`；排障见本文档末。

## 0. 前置

- Zed stable。Node.js `^22.19 || >=24`（② 与 ①npx 分发需要；①binary 分发发布后无需 Node）。
- DeepSeek API key：环境变量 `DEEPSEEK_API_KEY`，或先 `dsh-acp-zed login` 持久化（mode 600，`~/.dsh/acp-zed/auth.env`）。

## 1. ACP Registry（推荐，发布后可用）

1. Zed Command Palette → `zed: acp registry`（或 Agent Settings → External Agents → Add Agent → Install from Registry）。
2. 选择 **DeepSeek Harness** 安装；settings 自动出现 `"agent_servers": { "deepseek-harness": { "type": "registry" } }`。
3. 首次使用时如提示 Authenticate：选择 **Log in from the terminal**（= `dsh-acp-zed --login`）或直接在 env 里给 `DEEPSEEK_API_KEY`。

发布状态：Registry 条目以 `distribution.npx` 先行提交（M4）；binary（免 Node）随 M3 归档就绪后升级条目。

## 2. Custom Agent（无需注册）

`zed: open settings` → 追加：

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

自检（命令应打印模型目录到 stderr 并以 0 退出）：

```bash
npx -y dsh-acp-zed --list-models
```

带 key（env 块优先于 login 文件）：

```json
"env": { "DEEPSEEK_API_KEY": "sk-…" }
```

开发（源码 checkout）：

```json
{ "command": "node", "args": ["/abs/path/zed-dsh/server/lib/bin.js"] }
```

## 3. 旧版 Zed 扩展（兼容附录，官方已弃用）

- Zed ≤ v0.22x：`extension/` 目录以 `zed-dsh` 命名放入本地扩展目录（或从 GitHub Release 安装 `zed-dsh.zip`）；Agent Panel 选择 DeepSeek Harness。
- Zed ≥ v0.221：请改用路线 ①/②（官方会把已装扩展 agent 迁移到 registry 等价物）。

## 4. 使用

- Agent Panel 选 DeepSeek Harness → 新线程。齿轮菜单 = 会话选项：**Model / Thought Level / Write permission**（每线程，下一回合生效）。
- 输入 `/` 查看斜杠技能；发 `/name args` 调用（其余文本照常交给模型）。
- 线程历史：recent-threads 恢复（Zed ≥ v0.225）；恢复限于会话原工作区。
- 图片：可直接粘贴/拖入截图（Zed 显示可发图后）。
- 需要 MCP 工具：在 Zed 配 `context_servers`（stdio/HTTP），自动挂进每个新线程。
- 调试：`dev: Open Acp Logs`；服务端诊断在 `zed: open log`。

## 5. 排障

| 症状 | 处理 |
|---|---|
| spawn 失败 "No such file or directory" | GUI 启动的 Zed 读不到 nvm PATH：`which npx` 取绝对路径作 `command`，或从终端 `zed .` 启动 |
| 每次提问都要求认证 | 补 env key 或 `dsh-acp-zed login`；`--list-models` 应打印目录并 exit 0 |
| 会话可建但模型不响应 | 检查 `--list-models`、provider 配置（`~/.dsh/acp-zed/settings.yaml`）、credentials |
| 挂载的 MCP 无工具 | Zed `context_servers` 只支持 stdio/streamable-HTTP（`sse` 被拒）；不可达服务器会软失败并 stderr 具名 |
| 配置不生效 | overlay/settings 分层生效边界：settings 热更、overlay 重启生效（无 HMR） |
| Windows | `command` 用 node 绝对路径或 npx 绝对路径；URL 用 `file:///C:/…` 形式 |

## 6. 自定义 provider（示例，settings.yaml 热更）

```yaml
llm-pi-ai:
  providers:
    local-kimi:
      displayName: Local Kimi
      api: openai-completions
      baseURL: http://10.0.0.8:8000/v1
      models:
        - id: moonshotai/Kimi-K3
          contextWindow: 1048576
```

凭据放 `credentials.yaml`（或环境变量，优先）。组合/overlay 定制与插件：见 `docs/design.zh.md` §4.2 与 §9。

## 7. Agent Panel 图标（deepseek-harness 官方小鱼）

各路线能否在 Agent Panel / 新线程菜单显示图标，取决于 Zed 侧，而非本仓库配置：

| 路线 | Panel 是否显示图标 | 说明 |
|---|---|---|
| ① ACP Registry | ✅（发布后） | Zed 读取 registry 条目 `icon` URL（registry CI 发布时由 `<id>/icon.svg` 自动注入，源文件**无需**写 `icon` 字段）→ 下载缓存 → 面板 14px 主题色渲染。前置：PR 的 `<id>/icon.svg` 必须通过官方 CI 校验：16×16 正方形 + 仅 `currentColor` 单色（`registry/icon.svg` 已按该校验器验证通过） |
| ② Custom Agent | ❌ | Zed 的 custom agent 配置（settings `agent_servers`）**无 icon 字段**（官方特性请求未实现），面板恒显示 Sparkle——与本仓库无关 |
| ③ 旧版扩展（≤ v0.22x） | ✅ | `extension.toml` → `icon = "icon/dsh.svg"`，Zed 渲染时自动单色化 |

更换图标后不生效的排障：Zed 按 agent id 缓存图标（`external_agents/registry/icons/deepseek-harness.svg`，Linux 约 `~/.local/share/zed/` 下），且**已缓存后不重新下载**（每小时 registry 刷新仅在缓存文件缺失时拉取）——更新图标需删除该缓存文件后重启 Zed。

