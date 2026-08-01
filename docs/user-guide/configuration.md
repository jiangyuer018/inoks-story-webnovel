# V2 长篇配置

所有字段都有兼容默认值，旧项目无需立即补写。

```json
{
  "writing": {
    "automationMode": "review-first",
    "storySpec": {
      "approvalMode": "human",
      "blockOnPlaceholders": true,
      "requireReaderContract": true
    },
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
      "generateSequenceSummaries": true,
      "sequenceSize": 8,
      "generateArcSummaries": true,
      "retrieval": {
        "recentChapterCount": 5,
        "maxHistoricalEvents": 20,
        "maxRelatedSummaries": 10,
        "useFts": true,
        "useEmbeddings": false,
        "protectedTokenRatio": 0.45,
        "retrievedTokenRatio": 0.30,
        "compressedTokenRatio": 0.25
      }
    }
  }
}
```

自动化模式为 `manual | review-first | auto-draft | auto-publish`。即使 auto-publish，也不能越过质量 blocking、连续性错误、投影失败、章节哈希冲突或外部发布失败。

`storySpec.approvalMode` 默认为 `human`：机器生成的章节规格进入 `awaiting-review`。只有人工批准、显式 `automatic`，或允许的专用 Reviewer 才能激活。`blockOnPlaceholders` 会在 Writer 之前拒绝抽象占位规划；`requireReaderContract` 会阻止空读者合同进入正式长篇写作。

`review-first` 和人工审阅模式允许守护进程完成草稿与自动审查，但停在 `awaiting-human-approval`。作者编辑正文后批准哈希立即失效，必须重新执行全部审查；批准后再次变化同样不能提交。

单本书的 `book.json` 可配置 `automation.enabled`、priority、每轮/每日章数、最小间隔、daemon 启动行为，以及 Commit/发布前人工批准要求。未显式启用的书不会被 scheduler 自动写作。

Studio“模型角色”支持按 Agent 覆盖 model、temperature、maxTokens 和同服务 fallbackModels。fallback 只在主模型请求失败且请求未被用户中止时顺序尝试；不同服务或不同密钥仍应配置为独立服务，而不是在备用模型字段中混写。
