# Inoks Story Webnovel

> 面向中文长篇连载的本地优先创作工作台：让正文质量、故事事实与长期记忆走同一条可审计的提交链。

Inoks Story Webnovel 是一个 TypeScript 单体工作区，提供 CLI 与 Studio 两种工作界面，用于规划、生成、审阅、修订和持续维护长篇网络小说。它把“写出一章”视为一次受约束的故事提交，而不是一次只保存 Markdown 的文本操作。

## 它解决什么问题

长篇创作最容易失控的地方，通常不是模型能不能继续写，而是：修订后的正文和记忆是否一致、旧伏笔是否仍然有效、状态文件是否被半途更新，以及章节越多时上下文是否越来越臃肿。

Inoks Story Webnovel 将这些风险拆成一条原生控制链：

- **Prose Quality Gate**：对中文正文进行确定性扫描；只对高确定性模板化表达阻断，对密度和节奏问题给出建议。必要时才进入最多两轮的最小化自然化修订。
- **Story Spec 与 Narrative Research**：把章节合同、事件因果、时间、情绪轨迹、缺失逻辑和读者兑现窗口转成写前约束与写后审计。
- **Human Feel 与 Benchmark Transfer**：用场内动作、对话、选择和后果检查叙事功能；只迁移用户合法文本中的抽象机制。
- **Story System**：以 `accepted ChapterCommit` 与规范化事件为唯一正史来源。状态、伏笔、章节摘要、MemoryDB 和检索索引全部是可重建投影。

这意味着：正文未通过质量门时，不会污染人物状态、时间线、伏笔或长期记忆；投影失败时，已接受的章节提交仍会保留并可恢复。

## 核心写入链

```text
写作规划
  → 分层记忆检索
  → Writer 生成草稿
  → 长度治理
  → Prose Quality Gate
  → 连续性 / 剧情审查
  → 事实提取与实体消歧
  → ChapterCommit 验证
  → 事务化提交
  → 事件日志与派生投影
```

正式章节只有在这条链完成后才会落入正史。Writer、Reviser 和普通 Agent 没有直接写入权威状态的权限。

## 能力概览

### 中文正文质量门

- 纯 TypeScript、无外部 AI 检测 API、无运行时脚本依赖。
- 为中文提供阻断规则、建议规则、位置定位、白名单、稳定评分和 JSON 报告。
- 阻断规则保持窄范围：否定翻转模板、无叙事功能的长破折号、模板化章末升华等。
- 建议规则按次数与密度衡量：碎句、等长段、动作清单、抽象解释链、对话标签过密等。
- 修订受到剧情事实、人物关系、专有名词、数字、道具、伏笔、钩子、长度和修改比例保护。
- strict、balanced、report-only 三种执行模式；默认 strict。

### 可恢复的故事正史

- Commit、事件 ID 和哈希链均确定性生成，重复运行同一章不会制造重复事件。
- 每次 accepted Commit 记录正文哈希、验证结果、事件、状态增量、实体关系变更和摘要载荷。
- 章节文件、Commit 与 HEAD 经由 staging、prepared manifest、原子 rename 和恢复逻辑提交。
- 失败的必需投影会被记录，并在下一次写作前的 preflight 阶段自动检查。
- 旧章节被手动改动时会标记 `history-diverged`；必须通过 Amendment 产生审计记录和重放影响分析。

### 长篇记忆而非全文塞上下文

下一章检索将信息分成四个区：

- `protected`：当前事实、角色知识边界、世界规则、活跃伏笔、硬约束。
- `recent`：最近章节摘要。
- `retrieved`：按实体、地点、事件和关键词得到的可追溯历史。
- `compressed`：剧情序列、剧情弧、卷和全书摘要。

本地 FTS/BM25 是基础路径；向量检索可选，服务不可用时不会影响正确性。

## 快速开始

### 环境

- Node.js 20 或更高版本
- pnpm 9 或更高版本
- 一个 OpenAI 兼容或已配置的模型服务

### 从源码运行

```bash
git clone https://github.com/jiangyuer018/inoks-story-webnovel.git
cd inoks-story-webnovel
pnpm install
pnpm build
```

在一个小说项目目录中初始化并启动：

```bash
inoks-story init my-novel
cd my-novel
inoks-story studio
```

CLI 也可直接使用：

```bash
inoks-story book create --title "我的长篇" --genre xuanhuan
inoks-story write next 我的长篇
inoks-story story status 我的长篇
```

## 配置

项目配置文件为 `inoks-story-webnovel.json`，运行数据保存在 `.inoks-story-webnovel/`，环境变量采用 `INOKS_STORY_` 前缀。

以下为与长篇生产最相关的配置示例：

```json
{
  "writing": {
    "automationMode": "review-first",
    "proseQuality": {
      "enabled": true,
      "enforcement": "strict",
      "autoRepair": true,
      "maxRepairIterations": 2,
      "minimumScore": 80,
      "failOnUnresolvedBlocking": true,
      "saveRejectedDraft": true,
      "applyTo": ["chapter", "short-fiction", "continuation", "revision"]
    },
    "longFormMemory": {
      "enabled": true,
      "authority": "chapter-commit",
      "strictPreflight": true,
      "blockOnProjectionFailure": true,
      "sequenceSize": 8,
      "retrieval": {
        "recentChapterCount": 5,
        "maxHistoricalEvents": 20,
        "useFts": true,
        "useEmbeddings": false
      }
    }
  }
}
```

中文白名单是可选的：

```text
<projectRoot>/.inoks-story-webnovel/prose-quality-whitelist.txt
<bookDir>/story/prose_quality_whitelist.txt
```

每行一个词或短语；以 `#` 开头的行会被忽略。

## Story System 命令

```bash
# 当前提交、投影和健康状态
inoks-story story status <book-id>

# 校验哈希链、正文哈希与投影同步状态
inoks-story story verify <book-id>

# 恢复未完成事务和失败投影
inoks-story story repair <book-id>

# 仅凭 accepted Commit 和事件重建派生数据
inoks-story story replay <book-id> --from 1 --reset

# 为旧书生成迁移报告；显式 --apply 才会切换 authority
inoks-story story migrate <book-id>
inoks-story story migrate <book-id> --apply
```

`story replay` 可以重建当前状态、伏笔、摘要、MemoryDB、实体关系和检索索引。它不会把摘要当作正史事实。

## 发布与评测

```bash
# 只导出 accepted Commit，并显式追踪外部发布状态
inoks-story publish export <book-id> --platform fanqie --format zip
inoks-story publish status <book-id>
inoks-story publish import-log <book-id> --platform fanqie --file upload.log

# 聚合 A-H 配对消融；自动指标不能替代人工盲评
inoks-story eval ablation --input ablation-runs.json --output ablation-report.json
```

Studio 已按生产职责重新构造为原创控制面：生产、连载作品、研究资产、运行治理，以及作品内的规格、质量、正史和发布链。未复制原型项目的 Logo、远程字体、布局代码或平台页面。

## 架构与使用文档

- [Story Spec](docs/architecture/story-spec-system.md)
- [Narrative Research Layer](docs/architecture/narrative-research-layer.md)
- [Human Feel Engine](docs/architecture/human-feel-engine.md)
- [Benchmark Mechanism Transfer](docs/architecture/benchmark-engine.md)
- [ChapterCommit Story System](docs/architecture/chapter-commit-system.md)
- [Publishing Export](docs/architecture/publishing-export.md)
- [旧书迁移](docs/migration/v2-story-system.md)
- [A-H 消融评测](docs/testing/ablation.md)
- [Studio 故事控制中心](docs/user-guide/studio-control-center.md)
- [V2 配置](docs/user-guide/configuration.md)

## 目录说明

书籍的权威提交保存在：

```text
<bookDir>/.inoks-story-webnovel/story-system/
├── HEAD
├── commits/
├── events/
├── transactions/
├── projection-log.jsonl
└── rejected/
```

`accepted commits + normalized events` 是唯一事实源。`story/current_state.md`、`story/pending_hooks.md`、`story/chapter_summaries.md`、`memory.db` 和 Studio 状态页均为派生视图。

质量报告保存在：

```text
<bookDir>/quality/prose/chapter-0001.json
```

严格模式中未能解决的草稿会进入：

```text
<bookDir>/.inoks-story-webnovel/rejected-drafts/chapter-0001/
```

## 开发与验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm audit:semantic-patterns
pnpm verify:publish-manifests
```

各工作区也可以单独执行测试：

```bash
pnpm --filter @inoks-story-webnovel/core test
pnpm --filter @inoks-story-webnovel/cli test
pnpm --filter @inoks-story-webnovel/studio test
```

## 许可证与来源说明

本项目采用 AGPL-3.0-only。完整条款见 [LICENSE](LICENSE)，第三方组件、移植规则和设计参考见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Prose Quality Gate 的部分规则在 MIT 许可下参考并适配了 `worldwonderer/oh-story-claudecode` 的 story-deslop；ChapterCommit 和投影架构依据公开设计思想重新实现为 TypeScript。详情和来源边界均记录在第三方声明中。
