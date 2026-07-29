import { describe, expect, it } from "vitest";
import { auditHumanFeel, classifyNarrativeSegments } from "../human-feel/index.js";

describe("Human Feel Engine", () => {
  it("classifies dialogue, action, decision thought, functional environment, exposition and ornament", () => {
    const content = [
      "“账本给我。”林舟说，“价钱你开。”",
      "林舟伸手按住账本，挡住掌柜抽回去的手。",
      "他判断后门已经被封，决定拿银票换时间。",
      "雨水漫进门槛，浸湿账页，掌柜不得不把箱子挪开。",
      "这意味着事情已经变化，也就是说原来的办法不再可行。",
      "夜色如墨，空气仿佛凝固，树影如鬼魅。",
    ].join("\n\n");
    expect(classifyNarrativeSegments(content).map((segment) => segment.classification))
      .toEqual(["D", "A", "T", "E", "X", "O"]);
  });

  it("returns precise issues instead of only a score", () => {
    const text = "他点了点头，叹了口气，又深吸一口气。\n\n空气仿佛凝固，夜色如墨。";
    const report = auditHumanFeel(text);
    expect(report.emptyActionIssues).toHaveLength(1);
    expect(report.genericMetaphorIssues.length).toBeGreaterThanOrEqual(2);
    const issue = report.genericMetaphorIssues[0]!;
    expect(text.slice(issue.start, issue.end)).toBe(issue.excerpt);
    expect(issue.paragraphIndex).toBe(1);
    expect(issue.rationale).not.toBe("");
    expect(report.suggestions.some((suggestion) => suggestion.issueId === issue.id)).toBe(true);
  });

  it("detects information-dump dialogue and uncoupled turns", () => {
    const report = auditHumanFeel(
      "“你应该知道，我们家族三百年前建立了这座城，事情是这样的……”\n"
      + "“北边有七座矿山和四条河流。”\n"
      + "“市场每天上午开门，下午关门。”",
    );
    expect(report.artificialDialogueIssues.length).toBeGreaterThan(0);
    expect(report.reactionCouplingIssues.length).toBeGreaterThan(0);
  });

  it("detects redundant thought and explanation after an expressive action", () => {
    const report = auditHumanFeel(
      "他心里感到愤怒，反复想到昨夜的事，却没有改变任何打算。\n\n"
      + "她握紧拳头，因为她显然非常愤怒。",
    );
    expect(report.redundantThoughtIssues.length).toBeGreaterThan(0);
    expect(report.excessiveExplanationIssues.length).toBeGreaterThan(0);
  });

  it("blocks a long scene with no goal, relationship, risk, resource, information or action change", () => {
    const paragraph = "屋里摆着旧桌和木椅。墙纸颜色暗淡。窗外云层缓慢移动。";
    const report = auditHumanFeel(Array.from({ length: 12 }, () => paragraph.repeat(2)).join("\n\n"));
    expect(report.sceneStagnationIssues[0]?.severity).toBe("blocking");
    expect(report.verdict).toBe("block");
  });

  it("flags over-neat paragraph allocation but does not make it blocking", () => {
    const report = auditHumanFeel([
      "林舟走到门边，停下脚步看着门锁。",
      "掌柜走到账边，停下脚步看着账本。",
      "伙计走到窗边，停下脚步看着街口。",
      "捕快走到桌边，停下脚步看着银票。",
      "少女走到墙边，停下脚步看着暗门。",
      "老人走到柜边，停下脚步看着钥匙。",
    ].join("\n\n"));
    expect(report.overNeatPlotIssues).toHaveLength(1);
    expect(report.overNeatPlotIssues[0]?.severity).toBe("advisory");
  });

  it("honors locked paragraphs and rejected suggestions", () => {
    const text = "空气仿佛凝固。\n\n他点了点头，叹了口气。";
    const initial = auditHumanFeel(text);
    const ignored = initial.emptyActionIssues[0]!.id;
    const report = auditHumanFeel(text, {
      lockedParagraphs: new Set([0]),
      ignoredIssueIds: new Set([ignored]),
    });
    expect(report.genericMetaphorIssues).toHaveLength(0);
    expect(report.emptyActionIssues).toHaveLength(0);
  });

  it("keeps English on the existing English review path", () => {
    const report = auditHumanFeel("This means the air froze like glass.", { language: "en" });
    expect(report.verdict).toBe("pass");
    expect(report.segments).toEqual([]);
  });
});
