import type {
  ClassifiedNarrativeSegment,
  NarrativeSegmentClass,
} from "./types.js";

export function classifyNarrativeSegments(content: string): ReadonlyArray<ClassifiedNarrativeSegment> {
  const paragraphs = locateParagraphs(content);
  return paragraphs.map((paragraph, paragraphIndex) => {
    const result = classify(paragraph.text);
    return {
      paragraphIndex,
      start: paragraph.start,
      end: paragraph.end,
      text: paragraph.text,
      ...result,
    };
  });
}

function classify(text: string): {
  readonly classification: NarrativeSegmentClass;
  readonly confidence: number;
  readonly reasons: ReadonlyArray<string>;
} {
  const dialogueChars = (text.match(/[“"][^”"]+[”"]/g) ?? []).join("").length;
  if (dialogueChars >= text.length * 0.45) {
    return { classification: "D", confidence: 0.9, reasons: ["dialogue-density"] };
  }
  const environment = count(text, /风|雨|雪|雾|夜色|阳光|月光|天空|街道|房间|山林|空气/g);
  const action = count(text, /走|跑|抓|拿|推|退|转|抬|放|踢|砍|敲|拉|按|递|接|挡|躲|浸|湿|挪/g);
  const decision = count(text, /决定|选择|判断|打算|宁可|必须|不能再|改变主意|冒险/g);
  const thought = count(text, /想到|认为|猜|判断|明白|意识到|心里|心中|念头|盘算/g);
  const exposition = count(text, /这意味着|也就是说|原因(?:是|在于)|之所以|换句话说|事实上|显而易见|不难看出/g);
  const ornament = count(text, /仿佛|宛如|犹如|恍若|诗意|画卷|涟漪|潮水|刀子般|凝固/g);
  if (exposition >= 2 || (exposition >= 1 && text.length >= 120)) {
    return { classification: "X", confidence: 0.85, reasons: ["explanation-chain"] };
  }
  if (ornament >= 2 && action === 0 && dialogueChars === 0) {
    return { classification: "O", confidence: 0.82, reasons: ["ornamental-density"] };
  }
  if (environment >= 1 && action > 0) {
    return { classification: "E", confidence: 0.72, reasons: ["environment-interaction"] };
  }
  if (environment >= 3 && action === 0) {
    return { classification: "O", confidence: 0.74, reasons: ["environment-without-interaction"] };
  }
  if (thought > 0 && decision > 0) {
    return { classification: "T", confidence: 0.82, reasons: ["thought-changes-decision"] };
  }
  if (thought >= 2 && decision === 0) {
    return { classification: "X", confidence: 0.7, reasons: ["thought-without-decision"] };
  }
  if (action > 0) return { classification: "A", confidence: 0.75, reasons: ["observable-action"] };
  return { classification: "N", confidence: 0.55, reasons: ["necessary-narration-candidate"] };
}

function locateParagraphs(content: string): ReadonlyArray<{ text: string; start: number; end: number }> {
  const paragraphs: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /\S[\s\S]*?(?=\r?\n\s*\r?\n|$)/g;
  for (const match of content.matchAll(pattern)) {
    const text = match[0].trim();
    if (!text) continue;
    const rawStart = match.index ?? 0;
    const leading = match[0].indexOf(text);
    const start = rawStart + Math.max(0, leading);
    paragraphs.push({ text, start, end: start + text.length });
  }
  if (paragraphs.length === 0 && content.trim()) {
    const start = content.indexOf(content.trim());
    paragraphs.push({ text: content.trim(), start, end: start + content.trim().length });
  }
  return paragraphs;
}

function count(value: string, pattern: RegExp): number {
  return (value.match(pattern) ?? []).length;
}
