import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StoryConstraint, StoryConstraintSet } from "./types.js";

export const DEFAULT_STORY_CONSTITUTION = `# Story Constitution

## 场景优先
正文首先是正在发生的戏。通过人物目标、阻力、对话、动作、判断、选择、代价和后果推进。

## 信息戏剧化
信息优先由动作、利益冲突中的对话、物件、环境变化、他人反应、人物判断和选择后果传递。

## 最少作者介入
不重复解释动作已经表达的情绪，不提前解释潜台词，不用总结代替本应发生的冲突。

## 人物主动性与对话利益
主要人物进入场景时拥有自己的欲望、恐惧、隐瞒、策略和退出条件。对话必须存在目标、立场、信息或风险差异。

## 反应耦合与动作功能
人物言行必须互相改变判断或策略。动作必须影响关系、信息、风险、资源、节奏或下一步选择。

## 心理推进与环境功能
超过一句的心理活动必须改变判断、策略或行动。环境只有影响阻力、风险、线索、关系或行动时才展开。

## 比喻视角
比喻服从当前视角人物的职业、经历、知识和观察习惯，不使用模型公共比喻装饰正文。

## 场景状态变化
每场戏结束时，目标、关系、权力、风险、资源、信息、伏笔、期待或下一步行动至少改变一项。

## 爽点真实兑现
爽点必须产生可观察的身份、资源、关系、权力、认知或后续局势变化，不能用围观震惊代替结果。

## 正史唯一来源
只有 accepted ChapterCommit 能改变故事正史。大纲、计划、猜测、谎言、梦境、传闻和未审查草稿不得投影为客观事实。
`;

const CORE_CONSTRAINTS: ReadonlyArray<Omit<StoryConstraint, "source">> = [
  { id: "constitution.scene-first", text: "以场内目标、阻力、选择和后果推进，不用作者讲解代替戏。", strength: "hard" },
  { id: "constitution.dramatize-information", text: "信息优先通过动作、冲突对白、物件、反应或当场后果传递。", strength: "hard" },
  { id: "constitution.no-redundant-explanation", text: "动作已经表达的情绪和潜台词不得再由旁白解释一遍。", strength: "hard" },
  { id: "constitution.character-agency", text: "主要人物必须按自己的欲望、利益、恐惧和策略行动。", strength: "hard" },
  { id: "constitution.scene-change", text: "每个场景结束时至少产生一项可验证的状态变化。", strength: "hard" },
  { id: "constitution.functional-environment", text: "环境描写应影响阻力、风险、线索、判断或行动。", strength: "soft" },
  { id: "constitution.pov-metaphor", text: "比喻必须符合视角人物的知识和生活领域。", strength: "soft" },
  { id: "constitution.open-expression", text: "在不改变正史和场景合同的前提下，自由选择对白措辞和功能性细节。", strength: "open" },
];

export function storySpecRoot(bookDir: string): string {
  return join(bookDir, ".inoks-story-webnovel", "story-spec");
}

export async function ensureStoryConstitution(bookDir: string): Promise<string> {
  const path = join(storySpecRoot(bookDir), "constitution.md");
  const existing = await readFile(path, "utf-8").catch(() => "");
  if (existing.trim()) return existing;
  await writeAtomic(path, DEFAULT_STORY_CONSTITUTION);
  return DEFAULT_STORY_CONSTITUTION;
}

export async function loadStoryConstitution(bookDir: string): Promise<string> {
  return ensureStoryConstitution(bookDir);
}

export function constitutionConstraints(): StoryConstraintSet {
  const source = "constitution.md";
  const build = (strength: StoryConstraint["strength"]): ReadonlyArray<StoryConstraint> =>
    CORE_CONSTRAINTS.filter((item) => item.strength === strength).map((item) => ({ ...item, source }));
  return {
    hard: build("hard"),
    soft: build("soft"),
    open: build("open"),
  };
}

export function constitutionPromptRules(constitution: string): ReadonlyArray<string> {
  return constitution
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .slice(0, 16);
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf-8");
  await rename(temporary, path);
}
