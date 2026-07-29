# ChapterCommit Story System

`accepted ChapterCommit + normalized events` 是唯一正史源。

```text
最终正文
→ 事实提取与实体消歧
→ Commit 验证
→ staging transaction
→ 章节与 Commit 原子落盘
→ HEAD
→ 独立投影
```

Commit ID、event ID 和哈希链均由稳定输入确定性生成。同一正文、父 Commit 和章节号重复执行不会制造第二套历史。

## 事务与恢复

事务状态依次为 `prepared → chapter_moved → commit_moved → committed → projecting → complete`。崩溃恢复检查 manifest、正文哈希、Commit 哈希与 HEAD，完成安全步骤或保留可诊断失败。投影失败不删除 accepted Commit；下一章 preflight 会先修复，无法修复则阻断。

## 投影

Current State、时间事实、伏笔、章节/Sequence/Arc/Volume/Book 摘要、实体关系与检索索引都由投影器生成。投影器独立、幂等、可重试，支持从第 1 章或指定章节重放。

旧章正文与 Commit 哈希不一致时进入 `history-diverged`。合法修改必须产生 Amendment，记录撤销/新增事件和状态修正，再从受影响章节重放。
