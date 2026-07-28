/**
 * Adapted from worldwonderer/oh-story-claudecode story-deslop.
 * Original project licensed under the MIT License.
 * Rules and implementation were ported and adapted for Inoks Story Webnovel.
 */

import {
  ABSTRACT_PATTERN,
  ACTION_LIST_PATTERN,
  BLOCKING_RULES,
  CLICHE_PATTERN,
  DIALOGUE_TAG_PATTERN,
  HEDGE_WORDS,
  METAPHOR_PATTERN,
  MICRO_ACTION_PATTERN,
  NATURAL_CONNECTIVES,
  PROSE_QUALITY_RULE_VERSION,
  REASONING_PATTERN,
  TRANSITION_WORDS,
  type RegexRule,
} from "./rules-zh.js";
import type {
  ProseQualityIssue,
  ProseQualityScanOptions,
  ProseQualityScanResult,
} from "./types.js";

interface SourceMap {
  readonly text: string;
  readonly offset: number;
}

export function scanProseQuality(
  content: string,
  options: ProseQualityScanOptions = {},
): ProseQualityScanResult {
  const language = options.language ?? "zh";
  if (!content.trim()) return emptyResult();
  if (language === "en") return scanEnglishLegacy(content);

  const whitelist = new Set(
    (options.whitelist ?? []).map((item) => item.trim()).filter(Boolean),
  );
  const issues: ProseQualityIssue[] = [];
  const narrative = narrativeSegments(content);
  const endingStart = Math.max(0, content.length - 800);

  for (const rule of BLOCKING_RULES) {
    const sources = rule.endingOnly
      ? narrative
          .filter((segment) => segment.offset + segment.text.length >= endingStart)
          .map((segment) => {
            const trim = Math.max(0, endingStart - segment.offset);
            return { text: segment.text.slice(trim), offset: segment.offset + trim };
          })
      : rule.narrativeOnly ? narrative : [{ text: content, offset: 0 }];
    for (const source of sources) {
      collectRegexIssues(content, source, rule, whitelist, issues);
    }
  }

  const paragraphs = content.split(/\n\s*\n|\r?\n/).map((text) => text.trim()).filter(Boolean);
  const narrativeText = narrative.map((item) => item.text).join("\n");
  const visibleChars = Math.max(1, visibleLength(narrativeText));
  const perKilo = (hits: number) => hits / (visibleChars / 1000);
  const metrics: Record<string, number> = {
    visibleChars,
    paragraphs: paragraphs.length,
  };

  for (const paragraph of paragraphs) {
    const start = content.indexOf(paragraph);
    if (paragraph.length > 200) {
      pushAggregate(content, issues, "long-paragraph", "advisory", "超长段落", start,
        `单段 ${paragraph.length} 字，手机阅读容易失去镜头边界。`, "按动作、线索或视线切换断段。");
    }
    const actionHits = matchCount(paragraph, ACTION_LIST_PATTERN);
    const separators = matchCount(paragraph, /[，、；;]/g);
    if (actionHits >= 5 && separators >= 4 && !/(打斗|追逐|仪式|招式|连击)/.test(paragraph)) {
      pushAggregate(content, issues, "action-list-tic", "advisory", "动作清单", start,
        `同段连续动作 ${actionHits} 个，呈现监控步骤表。`, "合并无功能步骤，保留推动情节、情绪或空间变化的动作。");
    }
  }

  const shortNarrative = narrativeText.split(/[。！？!?]/).map((value) => value.trim()).filter(Boolean);
  let shortRun = 0;
  let shortRunStart = -1;
  for (const sentence of shortNarrative) {
    if (visibleLength(sentence) <= 5) {
      if (shortRun === 0) shortRunStart = content.indexOf(sentence);
      shortRun += 1;
      if (shortRun === 6) {
        pushAggregate(content, issues, "period-stutter", "advisory", "碎句号/电报体", shortRunStart,
          "连续六个及以上极短叙述句，读感像提纲。", "仅合并断裂处，恢复必要的动作顺序、空间和因果连接。");
      }
    } else {
      shortRun = 0;
      shortRunStart = -1;
    }
  }

  const microHits = matchCount(narrativeText, MICRO_ACTION_PATTERN);
  metrics.microActionDensity = perKilo(microHits);
  if (microHits >= 5 && perKilo(microHits) >= 6) {
    pushAggregate(content, issues, "micro-action-tic", "advisory", "微动作复读", firstMatch(content, MICRO_ACTION_PATTERN),
      `“了下/了一下”式补语 ${microHits} 次（${perKilo(microHits).toFixed(1)}/千字）。`, "合并重复动作 beat，不要把每个动作都补成轻反应。");
  }

  const clicheHits = matchCount(narrativeText, CLICHE_PATTERN);
  metrics.clicheDensity = perKilo(clicheHits);
  if (clicheHits >= 8 && perKilo(clicheHits) >= 12) {
    pushAggregate(content, issues, "cliche-density-tic", "advisory", "套词密度", firstMatch(content, CLICHE_PATTERN),
      `高危套词 ${clicheHits} 次（${perKilo(clicheHits).toFixed(1)}/千字）。`, "删无功能解释，改成当场动作、物件、对话或后果；不要同义词轮换。");
  }

  const metaphorHits = matchCount(narrativeText, METAPHOR_PATTERN);
  metrics.metaphorDensity = perKilo(metaphorHits);
  if (metaphorHits >= 7 && perKilo(metaphorHits) >= 3) {
    pushAggregate(content, issues, "metaphor-density-tic", "advisory", "比喻密度", firstMatch(content, METAPHOR_PATTERN),
      `比喻标记 ${metaphorHits} 次（${perKilo(metaphorHits).toFixed(1)}/千字）。`, "保留少数有叙事功能、贴角色视角的比喻，其余回到具体画面。");
  }

  const reasoningHits = matchCount(narrativeText, REASONING_PATTERN);
  metrics.reasoningDensity = perKilo(reasoningHits);
  if (reasoningHits >= 8 && perKilo(reasoningHits) >= 18) {
    pushAggregate(content, issues, "reasoning-chain-tic", "advisory", "解释链密度", firstMatch(content, REASONING_PATTERN),
      `判断/解释链 ${reasoningHits} 次（${perKilo(reasoningHits).toFixed(1)}/千字）。`, "把抽象判断落到角色当下证据、动作、对话和现场反馈。");
  }

  const abstractHits = matchCount(narrativeText, ABSTRACT_PATTERN);
  metrics.abstractSummaryDensity = perKilo(abstractHits);
  if (abstractHits >= 3 && perKilo(abstractHits) >= 4) {
    pushAggregate(content, issues, "abstract-summary-tic", "advisory", "抽象总结", firstMatch(content, ABSTRACT_PATTERN),
      `作者总结/命运大词 ${abstractHits} 次。`, "回到角色可见的动作、物件、台词或物理后果。");
  }

  const transitionCounts = TRANSITION_WORDS.map((word) => ({
    word,
    count: countLiteral(narrativeText, word),
  })).filter(({ count }) => count >= 3);
  metrics.formulaicTransitions = transitionCounts.reduce((sum, item) => sum + item.count, 0);
  if (transitionCounts.length > 0) {
    pushAggregate(content, issues, "formulaic-transitions", "advisory", "公式化转折",
      content.indexOf(transitionCounts[0]!.word),
      transitionCounts.map(({ word, count }) => `${word}×${count}`).join("、"),
      "用动作、时序或视角变化完成转折。");
  }

  const hedgeHits = HEDGE_WORDS.reduce((sum, word) => sum + countLiteral(narrativeText, word), 0);
  metrics.hedgeDensity = perKilo(hedgeHits);
  if (perKilo(hedgeHits) > 3) {
    pushAggregate(content, issues, "hedge-density", "advisory", "套话密度", firstLiteral(content, HEDGE_WORDS),
      `模糊词 ${hedgeHits} 次（${perKilo(hedgeHits).toFixed(1)}/千字）。`, "在叙述确定时直接写事实；角色不确定时可以保留。");
  }

  const notices = paragraphs.filter((paragraph) => /^【[^】]+】$/.test(paragraph));
  const formalHits = notices.reduce((sum, line) => sum + matchCount(line, /不得|必须|不可|禁止|严禁|应当|须|需|务必|被视为|计入/g), 0);
  metrics.noticeFormality = formalHits;
  if (notices.length >= 4 && formalHits >= 5) {
    pushAggregate(content, issues, "system-notice-formality-tic", "advisory", "系统公文腔",
      content.indexOf(notices[0]!),
      `连续 ${notices.length} 条公告/系统文本包含 ${formalHits} 个硬规则词。`, "保留场内载体，只在载体内部白话化或展示角色面对的具体后果。");
  }

  const dialogueCount = matchCount(content, /[“「『"][^”」』"\n]{1,160}[”」』"]/g);
  const dialogueTags = matchCount(content, DIALOGUE_TAG_PATTERN);
  metrics.dialogueTagDensity = dialogueCount > 0 ? dialogueTags / dialogueCount : 0;
  if (dialogueCount >= 5 && dialogueTags / dialogueCount > 0.5) {
    pushAggregate(content, issues, "dialogue-tag-density", "advisory", "对话标签过密",
      firstMatch(content, DIALOGUE_TAG_PATTERN),
      `${dialogueTags}/${dialogueCount} 段对话带显式标签。`, "能由上下文识别说话人时省略标签，或用有功能的动作承接。");
  }

  const quoteEmphasis = matchCount(narrativeText, /[“「『"][\u4e00-\u9fffA-Za-z]{1,4}[”」』"]/g);
  metrics.quoteEmphasis = quoteEmphasis;
  if (quoteEmphasis >= 3) {
    pushAggregate(content, issues, "quote-emphasis-tic", "advisory", "引号强调滥用",
      firstMatch(content, /[“「『"][\u4e00-\u9fffA-Za-z]{1,4}[”」』"]/g),
      `叙述层短词引号强调 ${quoteEmphasis} 处。`, "只保留真正需要反讽或转述的一两处。");
  }

  detectUniformParagraphs(content, paragraphs, issues, metrics);
  detectListStructure(content, shortNarrative, issues, metrics);
  detectOvercompression(content, paragraphs, narrativeText, issues, metrics);
  detectAdjacentRepetition(content, paragraphs, issues, metrics);

  const filtered = issues.filter((issue) => !isWhitelisted(issue.excerpt, whitelist));
  const blockingCount = filtered.filter((issue) => issue.severity === "blocking").length;
  const advisoryCount = filtered.filter((issue) => issue.severity === "advisory").length;
  const infoCount = filtered.filter((issue) => issue.severity === "info").length;
  const score = Math.max(0, Math.round(100 - blockingCount * 18 - advisoryCount * 4 - infoCount));
  const level = blockingCount >= 3 || score < 60 ? "heavy"
    : blockingCount > 0 || score < 80 ? "medium"
      : advisoryCount > 0 || score < 95 ? "light"
        : "clean";
  return {
    passed: blockingCount === 0,
    score,
    level,
    blockingCount,
    advisoryCount,
    infoCount,
    metrics,
    issues: filtered,
    ruleVersion: PROSE_QUALITY_RULE_VERSION,
  };
}

function scanEnglishLegacy(content: string): ProseQualityScanResult {
  const issues: ProseQualityIssue[] = [];
  const metrics: Record<string, number> = {};
  const paragraphs = content.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
  detectUniformParagraphs(content, paragraphs, issues, metrics);
  const total = Math.max(1, content.length);
  const hedgeHits = ["seems", "seemed", "perhaps", "maybe", "apparently", "in some ways", "to some extent"]
    .reduce((sum, word) => sum + countLiteral(content.toLowerCase(), word), 0);
  metrics.hedgeDensity = hedgeHits / (total / 1000);
  if (metrics.hedgeDensity > 3) {
    pushAggregate(content, issues, "hedge-density", "advisory", "Hedge density", 0,
      `Hedge density is ${metrics.hedgeDensity.toFixed(1)} per 1k characters.`, "Use concrete detail when the viewpoint is not genuinely uncertain.");
  }
  const score = Math.max(0, 100 - issues.length * 4);
  return {
    passed: true,
    score,
    level: issues.length > 0 ? "light" : "clean",
    blockingCount: 0,
    advisoryCount: issues.filter((issue) => issue.severity === "advisory").length,
    infoCount: issues.filter((issue) => issue.severity === "info").length,
    metrics,
    issues,
    ruleVersion: `${PROSE_QUALITY_RULE_VERSION}-en-legacy`,
  };
}

function collectRegexIssues(
  content: string,
  source: SourceMap,
  rule: RegexRule,
  whitelist: ReadonlySet<string>,
  issues: ProseQualityIssue[],
): void {
  const regex = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`);
  for (const match of source.text.matchAll(regex)) {
    const text = match[0];
    if (!text || match.index === undefined || isWhitelisted(text, whitelist)) continue;
    const start = source.offset + match.index;
    issues.push(makeIssue(content, rule.id, rule.severity, rule.category, start, start + text.length, rule.message, rule.suggestion));
  }
}

function narrativeSegments(content: string): SourceMap[] {
  const quotePattern = /[“「『"][^”」』"\n]*[”」』"]/g;
  const segments: SourceMap[] = [];
  let cursor = 0;
  for (const match of content.matchAll(quotePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ text: content.slice(cursor, index), offset: cursor });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), offset: cursor });
  return segments;
}

function makeIssue(
  content: string,
  ruleId: string,
  severity: ProseQualityIssue["severity"],
  category: string,
  start: number,
  end: number,
  message: string,
  suggestion: string,
): ProseQualityIssue {
  const safeStart = Math.max(0, Math.min(start, content.length));
  const safeEnd = Math.max(safeStart, Math.min(end, content.length));
  const before = content.slice(0, safeStart);
  const line = before.split("\n").length;
  const column = safeStart - before.lastIndexOf("\n");
  const excerpt = content.slice(Math.max(0, safeStart - 24), Math.min(content.length, safeEnd + 24)).replace(/\s+/g, " ").trim();
  return {
    id: `${ruleId}:${safeStart}:${safeEnd}`,
    ruleId,
    severity,
    category,
    message,
    suggestion,
    start: safeStart,
    end: safeEnd,
    line,
    column,
    excerpt,
  };
}

function pushAggregate(
  content: string,
  issues: ProseQualityIssue[],
  ruleId: string,
  severity: ProseQualityIssue["severity"],
  category: string,
  at: number,
  message: string,
  suggestion: string,
): void {
  const start = Math.max(0, at);
  issues.push(makeIssue(content, ruleId, severity, category, start, Math.min(content.length, start + 1), message, suggestion));
}

function detectUniformParagraphs(
  content: string,
  paragraphs: ReadonlyArray<string>,
  issues: ProseQualityIssue[],
  metrics: Record<string, number>,
): void {
  if (paragraphs.length < 3) return;
  const lengths = paragraphs.map((paragraph) => visibleLength(paragraph));
  const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  if (mean === 0) return;
  const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length;
  const cv = Math.sqrt(variance) / mean;
  metrics.paragraphLengthCv = cv;
  if (cv < 0.15) {
    pushAggregate(content, issues, "paragraph-uniformity", "advisory", "段落等长", content.indexOf(paragraphs[0]!),
      `段落长度变异系数 ${cv.toFixed(3)}，节奏过于均匀。`, "按场景节拍自然拉开段落长度，不要随机拆句。");
  }
}

function detectListStructure(
  content: string,
  sentences: ReadonlyArray<string>,
  issues: ProseQualityIssue[],
  metrics: Record<string, number>,
): void {
  let run = 1;
  let max = 1;
  for (let index = 1; index < sentences.length; index += 1) {
    run = sentences[index]!.slice(0, 2) === sentences[index - 1]!.slice(0, 2) ? run + 1 : 1;
    max = Math.max(max, run);
  }
  metrics.samePrefixRun = max;
  if (max >= 3) {
    pushAggregate(content, issues, "list-structure", "info", "列表式结构", 0,
      `连续 ${max} 句使用相同开头。`, "仅在确实呈现机械排比时调整主语、时序或动作入口。");
  }
}

function detectOvercompression(
  content: string,
  paragraphs: ReadonlyArray<string>,
  narrativeText: string,
  issues: ProseQualityIssue[],
  metrics: Record<string, number>,
): void {
  if (visibleLength(narrativeText) < 1200 || paragraphs.length < 45) return;
  const short = paragraphs.filter((paragraph) => visibleLength(paragraph) <= 15).length;
  const ratio = short / paragraphs.length;
  const connectives = NATURAL_CONNECTIVES.reduce((sum, word) => sum + countLiteral(narrativeText, word), 0);
  const density = connectives / (visibleLength(narrativeText) / 1000);
  metrics.shortParagraphRatio = ratio;
  metrics.connectiveDensity = density;
  if (ratio >= 0.58 && density < 85) {
    pushAggregate(content, issues, "overcompressed-prose-tic", "advisory", "过度精炼", 0,
      `短叙述段占 ${(ratio * 100).toFixed(0)}%，自然连接密度 ${density.toFixed(1)}/千字。`, "只修读起来像提纲的断裂处，保留有意短镜头。");
  }
}

function detectAdjacentRepetition(
  content: string,
  paragraphs: ReadonlyArray<string>,
  issues: ProseQualityIssue[],
  metrics: Record<string, number>,
): void {
  let hits = 0;
  for (let index = 1; index < paragraphs.length; index += 1) {
    const left = keywordSet(paragraphs[index - 1]!);
    const right = keywordSet(paragraphs[index]!);
    if (left.size < 3 || right.size < 3) continue;
    const common = [...left].filter((term) => right.has(term)).length;
    const similarity = common / Math.min(left.size, right.size);
    if (similarity >= 0.75) {
      hits += 1;
      const start = content.indexOf(paragraphs[index]!);
      pushAggregate(content, issues, "adjacent-repetition", "advisory", "相邻段重复表达", start,
        "相邻段落高度重复同一信息、动作或情绪。", "合并重复表达，保留最能推动剧情或情绪的细节。");
    }
  }
  metrics.adjacentRepetition = hits;
}

function keywordSet(text: string): Set<string> {
  const terms = text.match(/[\u4e00-\u9fff]{2,4}|[A-Za-z]{3,}/g) ?? [];
  return new Set(terms.filter((term) => !/^(这个|那个|然后|但是|已经|之后)$/.test(term)));
}

function isWhitelisted(text: string, whitelist: ReadonlySet<string>): boolean {
  return [...whitelist].some((entry) => entry && text.includes(entry));
}

function matchCount(text: string, pattern: RegExp): number {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))].length;
}

function firstMatch(text: string, pattern: RegExp): number {
  return text.search(new RegExp(pattern.source, pattern.flags.replace("g", "")));
}

function countLiteral(text: string, value: string): number {
  if (!value) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(value, offset)) >= 0) {
    count += 1;
    offset += value.length;
  }
  return count;
}

function firstLiteral(content: string, words: ReadonlyArray<string>): number {
  const positions = words.map((word) => content.indexOf(word)).filter((value) => value >= 0);
  return positions.length > 0 ? Math.min(...positions) : 0;
}

function visibleLength(text: string): number {
  return (text.match(/[\u4e00-\u9fffＡ-ｚA-Za-z0-9]/g) ?? []).length;
}

function emptyResult(): ProseQualityScanResult {
  return {
    passed: true,
    score: 100,
    level: "clean",
    blockingCount: 0,
    advisoryCount: 0,
    infoCount: 0,
    metrics: {},
    issues: [],
    ruleVersion: PROSE_QUALITY_RULE_VERSION,
  };
}
