# ChronoLobster（龙虾时序）

`ticktick-llm-connector` 是一个面向大模型工作流的滴答清单（TickTick/Dida）CLI 连接器，重点解决：

- 直接读取滴答 API（不依赖 Obsidian 解析层）
- 微信采集任务碎片化（例如“待投递 + 链接”被拆成两个任务）
- 任务自动二分类：`待行动` / `材料`

## 项目备注

- 项目愿景：把“微信 -> 滴答 -> 大模型”打通成一个可迭代的时间管理基础设施。
- 当前定位：先解决滴答在微信采集下的碎片化输入问题，再叠加自动化与 AI 决策层。
- 适用人群：重度微信用户、滴答清单用户、想把任务系统接入 AI 的开发者与效率爱好者。

## 功能

- `digest`：读取收件箱、今日任务、未来 N 天任务
- `dedupe`：重复任务检测与清理（默认 dry-run）
- `wechat`：微信采集任务整理（标记+链接合并 + 分类打标）
- `cache-digest`：基于 TickTickSync 缓存文件做离线摘要（不访问网络）

## Skills 封装

仓库已内置两个可复用 Skill：

- `skills/lobster-time-management`
  - 面向“龙虾时间管理”场景，重点是微信采集清洗、任务合并与行动化。
- `skills/ticktick-llm-bridge`
  - 面向“大模型对接”场景，重点是把 TickTick JSON 结构化地喂给 AI 流程。

如果你使用 Codex Skills 机制，可以直接从该仓库路径安装对应目录。

## 安装

```bash
cd ticktick-llm-connector
npm install
npm run check
npm test
```

> 本项目无第三方依赖，Node.js >= 20 即可。

## 配置

默认自动搜索 `TickTickSync` 的 `data.json`，你也可以显式指定：

```bash
export TICKTICKSYNC_CONFIG="/path/to/.obsidian/plugins/tickticksync/data.json"
```

或在每次命令中传入：

```bash
--config /path/to/.obsidian/plugins/tickticksync/data.json
```

## 常用命令

### 1) 直连滴答摘要

```bash
node ./bin/tt-llm.mjs digest --date 2026-02-28 --tz Asia/Shanghai --format md
```

### 2) 重复任务检测（不改数据）

```bash
node ./bin/tt-llm.mjs dedupe --scope inbox --window-hours 24 --format md
```

### 3) 微信采集整理（不改数据）

```bash
node ./bin/tt-llm.mjs wechat --window-seconds 240 --format md
```

### 4) 真正写回滴答（谨慎）

```bash
node ./bin/tt-llm.mjs wechat --window-seconds 240 --apply --format md
```

## 微信整理规则

- 标记任务识别：`待投递` / `待阅读` / `好素材`
- 合并策略：
  - 在同项目内，按任务时间窗口（默认 180 秒）匹配最近的链接任务
  - 保留链接任务，删除标记任务
  - 将标记内容写入保留任务描述（例如 `微信标记: 待投递`）
- 分类策略：
  - `待投递` -> `待行动`
  - `待阅读` / `好素材` -> `材料`
  - 其余按关键词和链接特征自动判定

## 发布前完善清单

- [x] 默认 dry-run，`--apply` 才会修改线上任务  [link](https://dida365.com/webapp/#p/inbox1017279818/tasks/69a2859f9aecc56fbabf97f0) #ticktick  %%[ticktick_id:: 69a2859f9aecc56fbabf97f0]%%
- [x] 命令行参数校验  [link](https://dida365.com/webapp/#p/inbox1017279818/tasks/69a285a59aecc56fbabf97f2) #ticktick  %%[ticktick_id:: 69a285a59aecc56fbabf97f2]%%
- [x] 基础 smoke test  [link](https://dida365.com/webapp/#p/inbox1017279818/tasks/69a285a79aecc56fbabf97f4) #ticktick  %%[ticktick_id:: 69a285a79aecc56fbabf97f4]%%
- [x] CI（GitHub Actions）  [link](https://dida365.com/webapp/#p/inbox1017279818/tasks/69a285a99aecc56fbabf97f6) #ticktick  %%[ticktick_id:: 69a285a99aecc56fbabf97f6]%%
- [x] 文档与许可证  [link](https://dida365.com/webapp/#p/inbox1017279818/tasks/69a285aa9aecc56fbabf97f8) #ticktick  %%[ticktick_id:: 69a285aa9aecc56fbabf97f8]%%
- [ ] 真实场景回归样本（建议 >= 20 条微信采集任务）  [link](https://dida365.com/webapp/#p/inbox1017279818/tasks/69a285ac9aecc56fbabf97fa) #ticktick  %%[ticktick_id:: 69a285ac9aecc56fbabf97fa]%%
- [ ] 误合并容忍度评估（建议先连续 3 天只跑 dry-run）  [link](https://dida365.com/webapp/#p/inbox1017279818/tasks/69a285ac9aecc56fbabf97fc) #ticktick  %%[ticktick_id:: 69a285ac9aecc56fbabf97fc]%%

## 上传 GitHub

```bash
cd ticktick-llm-connector
git init
git add .
git commit -m "初始发布：滴答大模型连接器"
# 可选：如果已安装 GitHub CLI
# gh repo create <your-repo-name> --public --source=. --remote=origin --push
```

## 安全说明

- `data.json` 中包含 token，禁止提交到仓库。
- 不要在 issue 或日志中粘贴完整 token / Cookie。

## 许可

MIT
