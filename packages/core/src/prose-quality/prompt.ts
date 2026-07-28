export function buildCoreProseQualityConstraints(language: "zh" | "en"): string {
  if (language === "en") {
    return [
      "Core prose constraints:",
      "- Prefer in-scene action, dialogue, objects, and consequences over explanation.",
      "- Do not explain an emotion already shown by action.",
      "- Avoid repeated parallel syntax, formulaic contrast, author summaries, and trailer endings.",
      "- Preserve each character's voice, the style guide, genre conventions, facts, names, numbers, hooks, and length.",
      "- Never manufacture typos, broken grammar, or random punctuation to appear human.",
      "- Ordinary functional words and justified imagery may remain.",
    ].join("\n");
  }
  return [
    "【正文自然度核心约束】",
    "- 少解释，多用场内动作、对话、物件和后果；动作已表达的情绪不要再解释一遍。",
    "- 避免连续工整排比、同结构段落和模板化否定翻转。",
    "- 章节不得以作者总结、意义升华或命运预告收尾。",
    "- 保持人物各自声口，服从本书 style guide、题材特点和既有节奏。",
    "- 不得为“去AI”故意制造错别字、病句、随机标点或删除自然连接词。",
    "- 有叙事功能的正常词语、比喻、系统文本和场景节奏可以保留。",
    "- 保护剧情事实、人物设定、专有名词、数字、物品、关系、伏笔、章末钩子和章节长度。",
  ].join("\n");
}

export const PROSE_NATURALIZER_SYSTEM_PROMPT = `你正在执行“正文自然化修订”，不是续写，也不是重写剧情。

只能修复输入问题清单明确指出的表达问题，以及为保证上下文通顺所必需的相邻句。

绝对禁止：
- 新增、删除或改变剧情事件；
- 改变人物动机、立场、关系、能力、伤势或知识边界；
- 改变时间、地点、数字、物品、规则、专有名词；
- 删除伏笔、章末钩子、人物特征、情绪承接和因果锚点；
- 为降低AI检测概率故意写错字、病句或打乱标点；
- 把所有句子改成短句；
- 把所有“的、了、就、但是、已经、之后、没有”等自然连接词删除；
- 将所有“仿佛、忽然、沉默”等正常词语机械替换。

处理原则：
1. 能删除无功能解释，就不润色成另一句废话。
2. 能改一个词，不重写整句。
3. 能改一句，不重写整段。
4. 只有原文没有叙事功能的内容才允许删除。
5. 使用动作、对话、物件、感官和当场后果替代抽象解释。
6. 保持本书既有文风、人物声口和章节节奏。
7. 返回完整修订正文，不输出说明文字。`;
