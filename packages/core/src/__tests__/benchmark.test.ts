import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BenchmarkStore,
  analyzeBenchmarkSimilarity,
  buildBenchmarkProfile,
  generateDifferentiatedVariants,
  recommendBenchmarkCandidates,
  scanPublicMarket,
  segmentBenchmarkChapters,
  segmentBenchmarkScenes,
} from "../benchmark/index.js";

const temporaryPaths: string[] = [];

async function temporaryBook(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "inoks-benchmark-"));
  temporaryPaths.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const sourceText = [
  "# 第1章 失效的印鉴",
  "",
  "林舟把印鉴按上验符台，台面没有亮。守门官收回通行令，街口的人都盯着他。",
  "",
  "他没有争辩，只拆开印鉴背板。里面的阵纹被人反接。林舟当众换回铜线，验符台轰然亮起。",
  "",
  "守门官重新核验身份，把通行令亲手交给他。刚才拦路的人只能让开。",
  "",
  "# 第2章 未干的墨",
  "",
  "账本上的墨还没干。林舟发现昨夜的记录被换过，掌柜立刻伸手来抢。",
].join("\n");

describe("Benchmark Engine", () => {
  it("segments user-provided chapters and scenes without fetching platform prose", () => {
    const chapters = segmentBenchmarkChapters(sourceText);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]?.title).toBe("失效的印鉴");
    expect(segmentBenchmarkScenes(chapters[0]!.content).length).toBeGreaterThan(0);
    expect(() => buildBenchmarkProfile({
      sourceId: "source-1",
      title: "测试",
      text: sourceText,
      roles: ["pacing"],
      userProvidedText: false,
    })).toThrow(/provided or authorized/i);
  });

  it("profiles function ratios and abstracts mechanisms instead of saving a plot template", () => {
    const profile = buildBenchmarkProfile({
      sourceId: "source-1",
      title: "合法样本",
      text: sourceText,
      roles: ["opening", "payoff", "pacing"],
      userProvidedText: true,
      prohibitedSourceElements: ["林舟", "验符台", "通行令"],
    });
    expect(profile.chapterProfiles[0]?.sceneCount).toBeGreaterThan(0);
    expect(profile.pacingProfile.dialogueRatio).toBeGreaterThanOrEqual(0);
    expect(profile.extractedMechanisms.length).toBeGreaterThan(0);
    expect(profile.extractedMechanisms[0]?.requiredBeats).toContain("可观察结果");
    expect(profile.extractedMechanisms[0]?.prohibitedSourceDetails).toContain("验符台");
    expect(profile.extractedMechanisms[0]?.approved).toBe(false);
  });

  it("requires explicit mechanism approval before Writer can retrieve guidance", async () => {
    const bookDir = await temporaryBook();
    const profile = buildBenchmarkProfile({
      sourceId: "source-1",
      title: "合法样本",
      text: sourceText,
      roles: ["primary"],
      userProvidedText: true,
    });
    const store = new BenchmarkStore(bookDir);
    await store.saveProfile(profile, sourceText);
    expect(await store.approvedMechanisms()).toEqual([]);
    const mechanismId = profile.extractedMechanisms[0]!.id;
    await store.setMechanismApproval(profile.sourceId, mechanismId, true);
    expect((await store.approvedMechanisms())[0]?.id).toBe(mechanismId);
  });

  it("blocks copied expression while allowing source-agnostic mechanism similarity", () => {
    const copied = analyzeBenchmarkSimilarity({
      candidate: "林舟把印鉴按上验符台，台面没有亮。守门官收回通行令，街口的人都盯着他。",
      sources: [{ sourceId: "source-1", text: sourceText }],
    });
    expect(copied.verdict).toBe("block");
    expect(copied.flaggedPassages.length).toBeGreaterThan(0);

    const transformed = analyzeBenchmarkSimilarity({
      candidate: "顾遥故意让审计程序报错，再从日志里的时序差证明权限表被人篡改。平台主管当场恢复了她的部署资格。",
      sources: [{ sourceId: "source-1", text: sourceText }],
      candidateEvents: ["authority-failure", "active-diagnosis", "reversal", "practical-reward"],
      sourceEvents: {
        "source-1": ["authority-failure", "active-diagnosis", "reversal", "practical-reward"],
      },
      candidateEntities: ["顾遥", "审计程序", "平台主管"],
      sourceEntities: { "source-1": ["林舟", "验符台", "守门官"] },
    });
    expect(transformed.mechanismSimilarity).toBe(1);
    expect(transformed.entitySimilarity).toBe(0);
    expect(transformed.verdict).not.toBe("block");
  });

  it("generates multiple differentiated candidates and carries source-detail prohibitions", () => {
    const profile = buildBenchmarkProfile({
      sourceId: "source-1",
      title: "合法样本",
      text: sourceText,
      roles: ["primary"],
      userProvidedText: true,
      prohibitedSourceElements: ["验符台", "通行令"],
    });
    const variants = generateDifferentiatedVariants({
      mechanism: profile.extractedMechanisms[0]!,
      bookSeed: "现代网络安全创业",
      scenes: ["融资尽调室", "线上事故复盘会", "客户机房"],
      conflictSources: ["投资人质疑数据", "客户拒绝开放日志", "竞争对手制造误报"],
      relationshipStructures: ["创始人与投资人", "工程师与客户负责人", "前同事与竞争对手"],
      solutionMethods: ["还原日志时序", "设计可复现实验", "让对手的规则自证矛盾"],
      rewards: ["获得试点合同", "取得部署权限", "赢得董事会席位"],
      costs: ["暴露核心方案", "承担事故赔偿", "失去旧同盟"],
      count: 3,
    });
    expect(variants).toHaveLength(3);
    expect(new Set(variants.map((variant) => variant.scene)).size).toBe(3);
    expect(variants[0]?.followUpImpact).toContain("验符台");
  });

  it("keeps market scanning at public metadata and ranks candidates by tags", async () => {
    const snapshot = await scanPublicMarket({
      platform: "fanqie",
      scanPublicMetadata: async () => [
        { rank: 2, title: "职场悬疑", tags: ["职场", "悬疑"], synopsis: "公开简介" },
        { rank: 1, title: "玄幻升级", tags: ["玄幻", "升级"] },
      ],
    }, "热读榜");
    expect(snapshot.sourcePolicy).toBe("public-metadata-only");
    const candidates = recommendBenchmarkCandidates(snapshot, ["职场", "悬疑"]);
    expect(candidates[0]?.title).toBe("职场悬疑");
  });
});
