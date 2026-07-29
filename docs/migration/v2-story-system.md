# 旧书迁移到 ChapterCommit Authority

迁移默认只生成报告，不覆盖旧数据。

```bash
inoks-story story migrate <book-id>
```

流程：

1. 校验并备份章节、truth Markdown 与 MemoryDB。
2. 按章节顺序重新读取最终正文。
3. 形成可恢复迁移进度和 Commit 候选。
4. 重建投影并比较 current state、hooks、summaries 与原状态。
5. 输出差异、歧义和未通过项目。

人工检查报告后显式执行：

```bash
inoks-story story migrate <book-id> --apply
inoks-story story verify <book-id>
```

迁移中断后可重复执行；确定性 Commit 不会重复生成事件。不要在备份外直接编辑已迁移章节。若必须修订旧章，使用 Amendment 路径并从该章重放。
