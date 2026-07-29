# V2 长篇配置

所有字段都有兼容默认值，旧项目无需立即补写。

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

单本书的 `book.json` 可配置 `automation.enabled`、priority、每轮/每日章数、最小间隔、daemon 启动行为，以及 Commit/发布前人工批准要求。未显式启用的书不会被 scheduler 自动写作。

Studio“模型角色”支持按 Agent 覆盖 model、temperature、maxTokens 和同服务 fallbackModels。fallback 只在主模型请求失败且请求未被用户中止时顺序尝试；不同服务或不同密钥仍应配置为独立服务，而不是在备用模型字段中混写。
