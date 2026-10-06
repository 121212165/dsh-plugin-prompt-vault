# dsh-plugin-prompt-vault

> 🧩 **dsh 插件家族**（22 件）：总目录 **[dsh-plugin-family](https://github.com/121212165/dsh-plugin-family)** ｜ 明星插件：**[ide-hub](https://github.com/121212165/dsh-plugin-ide-hub)** 跨 IDE 统一管理 · **[task-forge](https://github.com/121212165/dsh-plugin-task-forge)** 跨窗口无损交接 · **[quota](https://github.com/121212165/dsh-plugin-quota)** 实时用量仪表


**EN** · Personal prompt library inside the harness: `/pv` imports tagged templates (`## title` + body), lists and shows them, and sends one into the current session as a user message. · 13 `node --test` green, `npm run check` passing · **mount and activation verified live** in dsh 0.1.7-alpha.1 (headless profile) · the send path now writes a producer-owned source kind, after v0.1.0's `{kind:"plugin"}` wrapper turned out to abort the session (A/B evidence recorded below).

DeepSeek Harness (dsh) 插件：把个人提示词资产库带进 harness。用 `## 标题 + 正文` 的 markdown 文件批量导入，`/pv` 列表/检索/打标，`/pv send` 把一条提示词直接作为用户消息注入当前会话（官方 cookbook 验证过的 `ctx.agents.followup()` 面）。

适合把 [prompt-vault](https://github.com/121212165/prompt-vault) 这类沉淀库变成随手可用的弹药。

## 用法

```text
/pv                     # 全部列表
/pv 反审                # 按标题/id/标签过滤
/pv show anti-ai        # 看正文
/pv send anti-ai        # 注入当前会话
/pv import ~/prompts.md # 批量导入
/pv tag anti-ai 质量    # 打标
```

存储：`~/.dsh/prompt-vault/library.jsonl`（JSONL，容错解析）。id 自动 slug 化并去重；`show`/`send` 支持唯一前缀匹配，歧义时报错不猜。

## 安装

三步，实测于 `@deepseek-ai/dsh@0.1.7-alpha.1`（需 `pnpm` 在 PATH 上）：

```sh
# ① 装进 profile：dsh plugin 把参数原样转发给 pnpm，git 包会自动跑 prepare 构建 lib/
dsh plugin --profile web add github:121212165/dsh-plugin-prompt-vault
```

② 把本仓库根目录 `cordis.patch.yml` 的内容**并进** `$DSH_HOME/profiles/web/cordis.patch.yml`。
该文件默认是 `[]`，所以要么整份替换，要么把 insert 条目并进同一个数组；**不要直接追加**——
追加会形成两个 YAML 文档，启动即报
`failed to parse overlay ... end of the stream or a document separator is expected`（本机实测踩过）。

③ 重启 dsh。配置层与 client 半都要重启才生效（客户端按 boot 时算出的内容 rev 下发，硬刷新浏览器没用）。

自检挂载：`dsh --profile web --dump-config | grep dsh-plugin-prompt-vault`，应看到该条目。
## 验证状态

- 导入/解析/列表/匹配为纯函数，5 个 node --test 全绿；`npm run check`（typecheck + test + build）通过。
- **装配层（plugin.ts）测试已补齐**（新增 8 条，共 13 条）：`test/harness.ts` 用脚本化 mock ctx（commands/agents 捕获 + 假会话 followup 录制）驱动真实 `apply()`，handler 路径全部落在 `mkdtempSync` 临时目录，绝不触碰真实 `~/.dsh`。harness 方法论借鉴 dsh-auto-review（222★，PerryLink）的 mountHarness，实现为 node:test 版、移植自 dsh-plugin-task-forge（本家族首个落地的装配层测试模板）。
- **挂载激活已验证**（dsh `0.1.7-alpha.1`，headless profile，2026-10-01）：本插件与 cache-guard、price-aware 同挂在一个隔离 profile 里跑通，`inject: ['commands','llm','agents']` 三个服务全部解析成功，dsh 没有报 `entry did not activate`。这条结论带对照实验：把 `inject` 临时改成一个不存在的服务后，dsh 明确输出 `prompt-vault (dsh-plugin-prompt-vault): pending (waiting for service: definitely-not-a-service)`，所以"没报错"确实是"激活成功"的证据，而不是日志被吞。`ctx.agents` 的运行时形状仍未被真正调用过（见下）。
- **已修：v0.1.0 的 `send` 会把会话打断，不是"干净的报错"。** 它用 `source: {kind:'plugin', plugin:<name>}` 造消息，而 session format v4 已废弃这个包装并直接抛错（`@deepseek-ai/dsh-session-format-v3-to-v4` 的 `source()`：`format v4 message requires a producer-owned source kind`），且抛错发生在消息落盘那一刻。现在改用生产者自有 kind `plugin:prompt-vault`（与官方 v3→v4 迁移函数 `producerKind()` 的目标形状一致），保留"这条是插件注入的、不是人敲的"归因。
- **该 kind 修复的实跑证据在兄弟插件上取得，不在本仓库**：cache-guard 与 price-aware 各做过一次 A/B——旧写法下会话在注入那一刻中断（日志停在 `tool/call`，无 `step/end`/`turn/end`，CLI 报 `format v4 message requires a producer-owned source kind`），新写法下会话跑完且记录以 `plugin:<name>` 持久化。v4 那道校验（`assertV4MessageSources`）按它自己的注释是"validate producer attribution in **every declared durable message slot**"，与消息来自 `additionalContexts` 还是 `followup` 无关，所以规则本身是通用的。**本插件 `agent.followup()` 这条腿仍未被驱动**：headless CLI 会把 `/pv` 当普通提示词交给模型（实测），斜杠命令只在 web/tui 面上可达，因此需要一次 web UI 手工验证才算完整。
