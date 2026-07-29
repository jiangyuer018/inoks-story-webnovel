import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalJson, sha256 } from "../story-system/commit.js";
import type { ChapterIntent, ChapterMemo } from "../models/input-governance.js";
import { ChapterSpecSchema } from "./schemas.js";
import { storySpecRoot } from "./constitution-loader.js";
import { detectStorySpecPlaceholders } from "../scene-realization/placeholder-detector.js";
import type {
  ChapterSpec,
  ControlledNarrativeBeat,
  SceneContract,
  SceneState,
  StorySpecApprovalMode,
} from "./types.js";

export interface EnsureChapterSpecInput {
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly intent?: ChapterIntent;
  readonly memo?: ChapterMemo;
  readonly targetCharacters?: ReadonlyArray<string>;
  readonly approvalMode?: StorySpecApprovalMode;
  readonly blockOnPlaceholders?: boolean;
}

export class StorySpecApprovalRequiredError extends Error {
  readonly code = "STORY_SPEC_APPROVAL_REQUIRED";

  constructor(
    readonly spec: ChapterSpec,
    readonly specPath: string,
  ) {
    super(`Story Spec 第 ${spec.chapterNumber} 章 v${spec.version} 正在等待批准：${specPath}`);
    this.name = "StorySpecApprovalRequiredError";
  }
}

export class StorySpecPlaceholderError extends Error {
  readonly code = "STORY_SPEC_PLACEHOLDER_BLOCKED";

  constructor(
    readonly spec: ChapterSpec,
    readonly placeholders: ReadonlyArray<string>,
    readonly missingFields: ReadonlyArray<string>,
  ) {
    super([
      `Story Spec 第 ${spec.chapterNumber} 章仍包含占位规划，已阻止进入 Writer。`,
      placeholders.length > 0 ? `占位语：${placeholders.join("、")}` : "",
      missingFields.length > 0 ? `缺失字段：${missingFields.join("、")}` : "",
    ].filter(Boolean).join(" "));
    this.name = "StorySpecPlaceholderError";
  }
}

export class StorySpecStore {
  readonly root: string;

  constructor(private readonly bookDir: string) {
    this.root = storySpecRoot(bookDir);
  }

  async loadChapter(chapterNumber: number): Promise<ChapterSpec | null> {
    const path = join(this.chapterDir(chapterNumber), "spec.json");
    const raw = await readFile(path, "utf-8").catch(() => "");
    return raw ? ChapterSpecSchema.parse(JSON.parse(raw)) : null;
  }

  async saveChapter(spec: ChapterSpec): Promise<ChapterSpec> {
    const parsed = ChapterSpecSchema.parse(spec);
    const dir = this.chapterDir(parsed.chapterNumber);
    const versionPath = join(dir, "versions", `v${String(parsed.version).padStart(4, "0")}.json`);
    await writeJsonAtomic(versionPath, parsed);
    await writeJsonAtomic(join(dir, "spec.json"), parsed);
    await writeAtomic(join(dir, "spec.md"), renderChapterSpec(parsed));
    await writeAtomic(join(dir, "tasks.md"), renderChapterTasks(parsed));
    await this.updateHead(parsed);
    return parsed;
  }

  async listChapterVersions(chapterNumber: number): Promise<ReadonlyArray<ChapterSpec>> {
    const dir = join(this.chapterDir(chapterNumber), "versions");
    const names = (await readdir(dir).catch(() => [])).filter((name) => /^v\d+\.json$/.test(name)).sort();
    return Promise.all(names.map(async (name) =>
      ChapterSpecSchema.parse(JSON.parse(await readFile(join(dir, name), "utf-8")))));
  }

  async markStale(chapterNumber: number, reason: string): Promise<ChapterSpec | null> {
    const current = await this.loadChapter(chapterNumber);
    if (!current || current.status === "stale") return current;
    const next: ChapterSpec = {
      ...current,
      version: current.version + 1,
      status: "stale",
      approvedAt: undefined,
      approvedBy: undefined,
      acceptanceCriteria: [
        ...current.acceptanceCriteria,
        {
          id: `stale-${current.version + 1}`,
          description: reason,
          severity: "blocking",
          evidenceTerms: [],
        },
      ],
      createdAt: new Date().toISOString(),
    };
    return this.saveChapter(next);
  }

  async approveChapter(
    chapterNumber: number,
    params: {
      readonly expectedVersion: number;
      readonly approvedBy: StorySpecApprovalMode;
      readonly blockOnPlaceholders?: boolean;
    },
  ): Promise<ChapterSpec> {
    const current = await this.loadChapter(chapterNumber);
    if (!current) throw new Error(`Story Spec 第 ${chapterNumber} 章不存在`);
    if (current.version !== params.expectedVersion) {
      throw new Error(
        `Story Spec 版本冲突：期望 v${params.expectedVersion}，当前 v${current.version}`,
      );
    }
    if (current.status === "stale" || current.status === "superseded") {
      throw new Error(`Story Spec 当前状态 ${current.status} 不允许批准`);
    }
    if (params.blockOnPlaceholders !== false) {
      const detection = detectStorySpecPlaceholders(current);
      if (detection.verdict === "block") {
        throw new StorySpecPlaceholderError(current, detection.placeholders, detection.missingFields);
      }
    }
    if (current.status === "approved" || current.status === "active") return current;
    return this.saveChapter({
      ...current,
      version: current.version + 1,
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: params.approvedBy,
      createdAt: new Date().toISOString(),
    });
  }

  specPath(chapterNumber: number): string {
    return join(this.chapterDir(chapterNumber), "spec.json");
  }

  private chapterDir(chapterNumber: number): string {
    return join(this.root, "chapters", `chapter-${String(chapterNumber).padStart(4, "0")}`);
  }

  private async updateHead(spec: ChapterSpec): Promise<void> {
    const path = join(this.root, "HEAD");
    const currentRaw = await readFile(path, "utf-8").catch(() => "");
    const current = currentRaw ? JSON.parse(currentRaw) as Record<string, unknown> : {};
    const chapters = typeof current.chapters === "object" && current.chapters
      ? current.chapters as Record<string, unknown>
      : {};
    await writeJsonAtomic(path, {
      schemaVersion: "1.0",
      updatedAt: new Date().toISOString(),
      chapters: {
        ...chapters,
        [String(spec.chapterNumber)]: {
          id: spec.id,
          version: spec.version,
          status: spec.status,
          sourceIntentHash: spec.sourceIntentHash,
        },
      },
    });
  }
}

export async function ensureChapterSpec(input: EnsureChapterSpecInput): Promise<ChapterSpec> {
  const store = new StorySpecStore(input.bookDir);
  const intentHash = sha256(canonicalJson({
    chapter: input.chapterNumber,
    intent: input.intent ?? null,
    memo: input.memo ?? null,
  }));
  const current = await store.loadChapter(input.chapterNumber);
  if (current?.sourceIntentHash === intentHash && current.status !== "superseded") {
    return maybeApprove(current, store, input);
  }

  const nextVersion = (current?.version ?? 0) + 1;
  const spec = buildChapterSpec(input, intentHash, nextVersion);
  const saved = await store.saveChapter(spec);
  return maybeApprove(saved, store, input);
}

async function maybeApprove(
  spec: ChapterSpec,
  store: StorySpecStore,
  input: EnsureChapterSpecInput,
): Promise<ChapterSpec> {
  const approvalMode = input.approvalMode ?? "human";
  if (approvalMode === "human") return spec;
  return store.approveChapter(spec.chapterNumber, {
    expectedVersion: spec.version,
    approvedBy: approvalMode,
    blockOnPlaceholders: input.blockOnPlaceholders,
  });
}

function buildChapterSpec(
  input: EnsureChapterSpecInput,
  sourceIntentHash: string,
  version: number,
): ChapterSpec {
  const goal = input.intent?.goal.trim() || input.memo?.goal.trim() || `完成第${input.chapterNumber}章的可验证状态变化`;
  const mustKeep = unique(input.intent?.mustKeep ?? []);
  const mustAvoid = unique(input.intent?.mustAvoid ?? []);
  const expectedChanges = extractMemoChanges(input.memo?.body);
  const beats = buildBeats(input.chapterNumber, goal, mustKeep, expectedChanges);
  const scene = buildDefaultScene(input.chapterNumber, goal, input.targetCharacters ?? [], beats);
  const id = `chapter-spec-${sha256(`${input.bookId}\0${input.chapterNumber}\0${sourceIntentHash}`).slice(0, 24)}`;
  const createdAt = new Date().toISOString();

  return {
    id,
    version,
    status: "awaiting-review",
    bookId: input.bookId,
    volumeId: `volume-${String(Math.floor((input.chapterNumber - 1) / 100) + 1).padStart(3, "0")}`,
    arcId: `arc-${String(Math.floor((input.chapterNumber - 1) / 40) + 1).padStart(3, "0")}`,
    chapterNumber: input.chapterNumber,
    pov: input.targetCharacters?.[0] ?? "",
    location: "",
    time: "",
    chapterGoal: goal,
    readerExpectation: extractMemoSection(input.memo?.body, "读者此刻在等什么"),
    emotionalTrajectoryId: `emotion-chapter-${String(input.chapterNumber).padStart(4, "0")}`,
    payoffTargets: extractMemoSection(input.memo?.body, "该兑现的"),
    plannedEvents: unique([goal, ...mustKeep]),
    requiredBeats: beats.filter((beat) => beat.strength === "hard").map((beat) => beat.id),
    hardConstraints: mustAvoid.map((item) => `禁止：${item}`),
    softTargets: unique(input.intent?.styleEmphasis ?? []),
    openSpace: ["对白措辞", "功能性动作", "不改变正史的局部反应", "功能性环境细节"],
    requiredStateChanges: expectedChanges,
    acceptanceCriteria: [
      ...mustKeep.map((item, index) => ({
        id: `must-keep-${index + 1}`,
        description: `正文必须保留：${item}`,
        severity: "blocking" as const,
        evidenceTerms: meaningfulTerms(item),
      })),
      ...expectedChanges.map((item, index) => ({
        id: `state-change-${index + 1}`,
        description: `章末应产生变化：${item}`,
        severity: "advisory" as const,
        evidenceTerms: meaningfulTerms(item),
      })),
    ],
    sceneContracts: [scene],
    beats,
    sourceIntentHash,
    createdAt,
  };
}

function buildBeats(
  chapter: number,
  goal: string,
  mustKeep: ReadonlyArray<string>,
  expectedChanges: ReadonlyArray<string>,
): ReadonlyArray<ControlledNarrativeBeat> {
  const parentId = `scene-${String(chapter).padStart(4, "0")}-01`;
  const required = mustKeep.map((item, index): ControlledNarrativeBeat => ({
    id: `beat-${String(chapter).padStart(4, "0")}-hard-${index + 1}`,
    parentId,
    function: item,
    requiredInputs: meaningfulTerms(item),
    expectedStateChange: [],
    completionCriteria: meaningfulTerms(item),
    // Intent text is machine-produced and may be fulfilled through synonyms.
    // It becomes a deterministic hard gate only after an author/editor marks
    // the persisted Beat as hard with explicit completion evidence.
    strength: "soft",
    status: "active",
  }));
  return [
    {
      id: `beat-${String(chapter).padStart(4, "0")}-goal`,
      parentId,
      function: goal,
      requiredInputs: [],
      expectedStateChange: expectedChanges,
      completionCriteria: meaningfulTerms(goal),
      strength: "soft",
      status: "active",
    },
    ...required,
  ];
}

function buildDefaultScene(
  chapter: number,
  goal: string,
  characters: ReadonlyArray<string>,
  beats: ReadonlyArray<ControlledNarrativeBeat>,
): SceneContract {
  const emptyState = (): SceneState => ({ goals: [], relationships: [], risks: [], resources: [], information: [] });
  return {
    id: `scene-${String(chapter).padStart(4, "0")}-01`,
    pov: characters[0] ?? "",
    immediateGoal: goal,
    oppositionGoal: "由本章冲突来源阻止目标顺利完成",
    characterAgendas: Object.fromEntries(characters.map((character) => [character, {
      wants: character === characters[0] ? goal : "维护自己的利益与立场",
      fears: "承担失败或暴露的代价",
      hides: [],
      cannotSay: [],
      tactic: "根据对方反应调整策略",
      leverage: [],
      exitCondition: "目标、关系、风险或信息发生可验证变化",
    }])),
    knownInformation: [],
    hiddenInformation: [],
    readerMustLearn: [],
    readerMustNotKnowYet: [],
    conflictMethod: "以利益、立场、信息或风险差异制造阻力",
    turningPoint: "人物获得新信息或承受实际后果",
    decisionPoint: "视角人物必须作出会改变后续局势的选择",
    irreversibleChange: "场景结束时至少一项状态不能无成本复原",
    entryState: emptyState(),
    exitState: { ...emptyState(), goals: [goal] },
    narrativeFunctions: ["推动主线", "产生状态变化"],
    deliveryPreference: {
      dialogue: "medium",
      action: "high",
      thought: "medium",
      narration: "limited",
    },
    beatIds: beats.map((beat) => beat.id),
  };
}

function extractMemoSection(body: string | undefined, heading: string): ReadonlyArray<string> {
  if (!body) return [];
  const match = body.match(new RegExp(`(?:^|\\n)##\\s*${escapeRegExp(heading)}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`));
  if (!match?.[1]) return [];
  return match[1].split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

function extractMemoChanges(body: string | undefined): ReadonlyArray<string> {
  return unique(extractMemoSection(body, "章尾必须发生的改变"));
}

function meaningfulTerms(value: string): ReadonlyArray<string> {
  const normalized = value.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter((term) => term.length >= 2);
  if (terms.length > 0) return unique(terms).slice(0, 8);
  const compact = normalized.replace(/\s+/g, "");
  return compact.length >= 4
    ? unique([compact.slice(0, 4), compact.slice(-4)])
    : [compact];
}

function renderChapterSpec(spec: ChapterSpec): string {
  return [
    `# Chapter Spec ${spec.chapterNumber} · v${spec.version}`,
    "",
    `- status: ${spec.status}`,
    `- id: ${spec.id}`,
    `- goal: ${spec.chapterGoal}`,
    `- pov: ${spec.pov || "未指定"}`,
    `- volume: ${spec.volumeId}`,
    `- arc: ${spec.arcId}`,
    "",
    "## Hard",
    ...spec.hardConstraints.map((item) => `- ${item}`),
    "",
    "## Soft",
    ...spec.softTargets.map((item) => `- ${item}`),
    "",
    "## Open",
    ...spec.openSpace.map((item) => `- ${item}`),
    "",
    "## Beats",
    ...spec.beats.map((beat) => `- [${beat.strength}] ${beat.id}: ${beat.function}`),
    "",
  ].join("\n");
}

function renderChapterTasks(spec: ChapterSpec): string {
  return [
    `# Chapter ${spec.chapterNumber} Tasks`,
    "",
    ...spec.beats.map((beat) => `- [ ] ${beat.id} · ${beat.function}`),
    "",
    "## Acceptance",
    ...spec.acceptanceCriteria.map((criterion) => `- [ ] [${criterion.severity}] ${criterion.description}`),
    "",
  ].join("\n");
}

function unique(values: ReadonlyArray<string>): ReadonlyArray<string> {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, content, "utf-8");
  await rename(temporary, path);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
