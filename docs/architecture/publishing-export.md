# Publishing Export

发布系统是 ChapterCommit 的下游交付层，不是新的正文来源。

## 预检与导出

- 只读取每章当前有效的 accepted Commit。
- 导出前校验 Story System、正文哈希、章节号和上一批失败状态。
- 支持番茄扩展包和起点发布包，输出 Markdown、TXT 或 ZIP。
- ZIP 只包含章节文件；内部 manifest 存在 `.inoks-story-webnovel/publishing/batches/`。
- 文件名会去除跨平台非法字符并保持稳定编号。

状态链：

```text
exported
→ handed_to_extension
→ scheduled_external
→ published_external
```

`published_external` 必须来自人工显式确认或可追溯外部日志。系统还保留 `failed_external` 与 `status_unknown`，不会把“生成 ZIP”误报为发布成功。

```bash
inoks-story publish export <book-id> --platform fanqie --format zip
inoks-story publish status <book-id>
inoks-story publish mark <book-id> --chapter 12 --platform fanqie --status handed_to_extension
inoks-story publish import-log <book-id> --platform fanqie --file upload.log
```
