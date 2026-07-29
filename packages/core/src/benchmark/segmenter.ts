export interface SegmentedChapter {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
}

export interface SegmentedScene {
  readonly sceneIndex: number;
  readonly content: string;
  readonly start: number;
  readonly end: number;
}

export function segmentBenchmarkChapters(text: string): ReadonlyArray<SegmentedChapter> {
  const heading = /^(?:#{1,3}\s*)?(?:第\s*(\d+)\s*章|Chapter\s+(\d+))[\s:：]*(.*)$/gim;
  const matches = [...text.matchAll(heading)];
  if (matches.length === 0) return [{ chapterNumber: 1, title: "未命名章节", content: text.trim() }];
  return matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    return {
      chapterNumber: Number(match[1] ?? match[2] ?? index + 1),
      title: match[3]?.trim() || `第${index + 1}章`,
      content: text.slice(start, end).trim(),
    };
  });
}

export function segmentBenchmarkScenes(content: string): ReadonlyArray<SegmentedScene> {
  const boundaries = [...content.matchAll(/\n\s*(?:\*{3,}|-{3,}|#{2,}\s+[^\n]+)\s*\n/g)];
  if (boundaries.length === 0) return splitByParagraphClusters(content);
  const points = [0, ...boundaries.map((match) => (match.index ?? 0) + match[0].length), content.length];
  return points.slice(0, -1).flatMap((start, index) => {
    const end = points[index + 1]!;
    const scene = content.slice(start, end).trim();
    return scene ? [{ sceneIndex: index + 1, content: scene, start, end }] : [];
  });
}

function splitByParagraphClusters(content: string): ReadonlyArray<SegmentedScene> {
  const paragraphs = content.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
  if (paragraphs.length <= 4) return [{ sceneIndex: 1, content: content.trim(), start: 0, end: content.length }];
  const result: SegmentedScene[] = [];
  let searchFrom = 0;
  for (let index = 0; index < paragraphs.length; index += 4) {
    const group = paragraphs.slice(index, index + 4).join("\n\n");
    const start = content.indexOf(paragraphs[index]!, searchFrom);
    const end = start + group.length;
    result.push({ sceneIndex: result.length + 1, content: group, start, end });
    searchFrom = end;
  }
  return result;
}
