# dsh-plugin-prompt-vault

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

克隆或 npm 安装到 profile 的 node_modules；源码安装先 `npm install`（prepare 构建出 lib/）。

## 验证状态

- 导入/解析/列表/匹配为纯函数，5 个 node --test 全绿。
- `send` 的 agents 注入面来自官方 cookbook（UI 插件示例同款），但 `ctx.agents` 的运行时形状未在本机验证——这是本插件唯一未验证点，失败会是干净的报错而非副作用。
