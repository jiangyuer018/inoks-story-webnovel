# Story Spec System

Story Spec 把“这章要写什么”与“这章实际发生了什么”分开。Spec 是写前合同，不是正史事实；只有最终正文生成事件并形成 accepted ChapterCommit 后，才可改变故事状态。

## 输入与输出

- 输入：Story Constitution、Book/Volume/Arc 合同、章目标、mustKeep、forbiddenChanges、当前事实与活跃伏笔。
- 输出：版本化 `ChapterSpec`，包括 required beats、hard constraints、角色目标、场景功能、期望变化和允许偏移。
- 存储：`<bookDir>/.inoks-story-webnovel/story-spec/`。
- 状态：`draft → approved → fulfilled`；上游修订可把后续 Spec 标为 `stale`。

## 运行位置

```text
长期记忆检索
→ Spec 生成/加载
→ 人物行为计划与缺失逻辑补全
→ Writer
→ 质量门和连续性审查
→ Spec fulfillment audit
→ ChapterCommit
```

Writer 收到紧凑的硬约束；Reviewer 得到完整 Spec 做兑现审查。动态大纲只产生修订提案，人工批准后旧版本仍保留，受影响的章会变为 stale，避免静默覆盖。

## 降级与验证

缺少旧项目 Spec 时，正式写章会生成首版；无法形成合格 Spec 时阻止自动提交，不把大纲计划投影为事实。测试覆盖版本头、stale 传播、批准/拒绝、必需 beat 兑现和无 Spec 的旧项目兼容。
