# Narrative Research Layer

该层把研究中的结构化叙事思想改写成可审计的工程约束，而不是复制论文实现或用一个总分替代编辑判断。

## 已落地机制

| 机制 | inkOS 表达 | 作用位置 | 失败边界 |
|---|---|---|---|
| Plot Planning / DOC / CONCOCT / DOME | Story/Chapter Spec 与分层规划 | Writer 之前 | Spec 不成为事实 |
| Event Causal Graph | 因果节点、前因、后果、未闭合链 | 规划与审稿 | 孤立事件和断因果可阻断 |
| Temporal Graph | 章节、场景、相对时间与知识边界 | 连续性审查、MemoryDB | 与当前有效事实冲突时阻断 |
| Emotion Trajectory | 场景级情绪值、方向、触发证据 | Writer 提示与审稿 | 无铺垫跃迁、长时间平坦、峰值拥挤提示修订 |
| Missing Logic Completion | 动机、资源、权限、转场、代价 | 写前补全 | 只能补约束，不得虚构为既成事实 |
| Reader Contract / Payoff | Promise、兑现窗口、延迟与关闭 | 规划、动态大纲、审稿 | overdue 或伪兑现进入质量问题 |

学术概念只提供问题分解方式。模型、数据格式、阈值、错误恢复、许可证和测试均按 inkOS 原生 TypeScript 体系重新设计。

## 数据流

```text
Story Constitution
→ Chapter Spec
→ causal / temporal / emotion / missing-logic audits
→ Writer constraints
→ final-text audits
→ accepted events
```

写前结果是约束；写后结果必须以最终正文证据定位。ProseQualityGate 改变正文哈希后，任何旧事实提取结果都作废并重新分析。

## 测试策略

测试分别覆盖孤立节点、循环和断链、时间冲突、人物知识越界、情绪平坦/跳变/峰值拥挤、动机与资源缺口、Promise overdue，以及动态提案批准后 Spec stale 传播。
