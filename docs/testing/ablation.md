# A–H 消融评测

inkOS 提供可复现的聚合器，但不把自动指标当作文学质量结论。

| 配置 | 机制 |
|---|---|
| A | Baseline Writer |
| B | + ProseQualityGate |
| C | + Story Spec |
| D | + Event Causal Graph |
| E | + Emotion Trajectory |
| F | + Human Feel Engine |
| G | + ChapterCommit 与长篇记忆 |
| H | 完整系统 |

每个 `sampleId` 必须让 A–H 使用相同 model、promptVersion 和 seed。输入记录剧情完整度、因果、情绪弧、旁白比例、动作/对话耦合、beat 兑现、真人感、连续性冲突、记忆一致性、作者后改比例和相似度风险。

```bash
inoks-story eval ablation --input ablation-runs.json --output ablation-report.json --json
```

只有 A–H 配对完整、模型/提示词无漂移且每个配置都有人工盲评分时，报告才会标记 `eligible-for-human-interpretation`；否则为 `engineering-only`。即使达到前者，也只允许人工解释实验，不得宣称叙事问题已经解决。

[`ablation-engineering-fixture.json`](ablation-engineering-fixture.json) 只用于命令、schema 和聚合公式的 smoke test；其各组数值刻意相同且无人评，不是产品效果证据。
