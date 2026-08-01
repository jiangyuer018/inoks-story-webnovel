# Benchmark Mechanism Transfer

Benchmark Engine 只处理用户合法提供的文本。它抽取可迁移的结构机制，而不是复刻表达。

## 安全边界

- 可学习：节奏位置、冲突升级方式、情绪功能、Promise/Payoff 窗口、角色功能和读者反馈机制。
- 禁止迁移：原句、专有名词、独特设定组合、角色身份、标志性桥段和可识别表达。
- Writer 只读取人工批准且已经去除来源标识的机制卡与 `NarrativeDeliveryProfile`，不读取源文本、原句、专名或 prohibited source details。
- `NarrativeDeliveryProfile` 只保留对话/动作/物件/旁白的信息比例、互动耦合、心理到决策、功能环境、解释旁白、对话策略和留白策略等抽象参数。
- prohibited source details、来源实体和原文保留在隔离存储中，只供写后保护门使用。
- 相似度审查接收正文、候选/来源事件序列、实体、关系结构、场景功能和 Beat 序列；高风险结果不得进入正式提交。单纯共享通用套路不会因一次机制重合直接阻断。

原型或竞品只能作为功能与信息架构参考。Studio 使用原创导航、CSS 标识、色彩、文案与组件实现，不复制第三方 UI 资产。
