import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import {
  parseCurrentStateFacts,
  parsePendingHooksMarkdown,
} from "../utils/story-markdown.js";
import { ChapterCommitSchema, StoryEventSchema } from "./schemas.js";
import type {
  ChapterCommit,
  ChapterCommitProjectionPayload,
  ChapterFactCandidates,
  ChapterSummaryPayload,
  CommitValidation,
  EntityDelta,
  RelationshipDelta,
  StateDelta,
  StoryEvent,
} from "./types.js";

export const STORY_SYSTEM_SCHEMA_VERSION = "inoks-story-story-system/v1";

const LEGACY_EXTENDED_VALIDATION_KEYS = [
  "storyConvergencePassed",
  "humanFeelPassed",
  "emotionPassed",
  "payoffPassed",
  "structurePassed",
  "similarityPassed",
  "temporalPassed",
  "humanApprovalPassed",
] as const;

// Stored v1 commits created before the V3 gates remain readable, but only
// objects parsed and hash-verified by parseStoredChapterCommit receive this
// compatibility marker. New candidates still go through the strict schema.
const verifiedLegacyStoredCommits = new WeakSet<object>();

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function deterministicCommitId(input: {
  readonly bookId: string;
  readonly chapter: number;
  readonly contentHash: string;
  readonly parentCommitId: string | null;
}): string {
  return `commit-${sha256(`${input.bookId}\0${input.chapter}\0${input.contentHash}\0${input.parentCommitId ?? ""}`).slice(0, 32)}`;
}

export function deterministicEventId(input: {
  readonly commitId: string;
  readonly eventType: string;
  readonly subject: string;
  readonly payload: Record<string, unknown>;
}): string {
  return `event-${sha256(`${input.commitId}\0${input.eventType}\0${input.subject}\0${canonicalJson(input.payload)}`).slice(0, 32)}`;
}

export function buildChapterCommit(params: {
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapter: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly chapterPath: string;
  readonly parentCommit?: ChapterCommit | null;
  readonly proseQualityPassed: boolean;
  readonly continuityPassed: boolean;
  readonly fulfillmentPassed: boolean;
  readonly blockingCount: number;
  readonly extendedValidation?: Partial<Pick<
    ChapterCommit["validation"],
    | "storyConvergencePassed"
    | "humanFeelPassed"
    | "emotionPassed"
    | "payoffPassed"
    | "structurePassed"
    | "similarityPassed"
    | "temporalPassed"
    | "humanApprovalPassed"
  >>;
  readonly candidates: ChapterFactCandidates;
  readonly runtimeStateDelta?: RuntimeStateDelta;
  readonly stateDeltas?: ReadonlyArray<StateDelta>;
  readonly entityDeltas?: ReadonlyArray<EntityDelta>;
  readonly relationshipDeltas?: ReadonlyArray<RelationshipDelta>;
  readonly summary: ChapterSummaryPayload;
  readonly projectionPayload: ChapterCommitProjectionPayload;
  readonly provenance?: Record<string, unknown>;
  readonly createdAt?: string;
}): ChapterCommit {
  const contentHash = sha256(params.content);
  const parentCommitId = params.parentCommit?.commitId ?? null;
  const commitId = deterministicCommitId({
    bookId: params.bookId,
    chapter: params.chapter,
    contentHash,
    parentCommitId,
  });
  const acceptedEvents = params.candidates.acceptedCandidates
    .filter((event) => event.confidence >= 0.75 && event.epistemicStatus === "objective")
    .map((event) => StoryEventSchema.parse({
      ...event,
      chapter: params.chapter,
      eventId: deterministicEventId({
        commitId,
        eventType: event.eventType,
        subject: event.subject,
        payload: event.payload,
      }),
    }));
  const rawStateDeltas = params.stateDeltas
    ? [...params.stateDeltas]
    : params.runtimeStateDelta
      ? stateDeltasFromRuntimeDelta(params.runtimeStateDelta, acceptedEvents)
      : [];
  const stateDeltas = rawStateDeltas.map((delta) => {
    if (delta.sourceEventId) return delta;
    const sourceEvent = acceptedEvents.find((event) =>
      event.subject === delta.subject
      && event.payload.predicate === delta.predicate
      && canonicalJson(event.payload.newValue) === canonicalJson(delta.newValue));
    return sourceEvent ? { ...delta, sourceEventId: sourceEvent.eventId } : delta;
  });
  const disambiguationPassed = params.candidates.ambiguousCandidates.length === 0;
  const validation: CommitValidation = {
    proseQualityPassed: params.proseQualityPassed,
    continuityPassed: params.continuityPassed,
    fulfillmentPassed: params.fulfillmentPassed,
    disambiguationPassed,
    blockingCount: params.blockingCount,
    storyConvergencePassed: params.extendedValidation?.storyConvergencePassed === true,
    humanFeelPassed: params.extendedValidation?.humanFeelPassed === true,
    emotionPassed: params.extendedValidation?.emotionPassed === true,
    payoffPassed: params.extendedValidation?.payoffPassed === true,
    structurePassed: params.extendedValidation?.structurePassed === true,
    similarityPassed: params.extendedValidation?.similarityPassed === true,
    temporalPassed: params.extendedValidation?.temporalPassed === true,
    humanApprovalPassed: params.extendedValidation?.humanApprovalPassed === true,
  };
  const status = validation.proseQualityPassed
    && validation.continuityPassed
    && validation.fulfillmentPassed
    && validation.disambiguationPassed
    && validation.storyConvergencePassed === true
    && validation.humanFeelPassed === true
    && validation.emotionPassed === true
    && validation.payoffPassed === true
    && validation.structurePassed === true
    && validation.similarityPassed === true
    && validation.temporalPassed === true
    && validation.humanApprovalPassed === true
    ? "accepted" as const
    : "rejected" as const;
  const withoutHash = {
    schemaVersion: STORY_SYSTEM_SCHEMA_VERSION,
    commitId,
    bookId: params.bookId,
    chapter: params.chapter,
    status,
    parentCommitId,
    previousCommitHash: params.parentCommit?.commitHash ?? null,
    source: {
      chapterPath: normalizeRelativePath(params.bookDir, params.chapterPath),
      contentHash,
      title: params.title,
      wordCount: params.wordCount,
    },
    validation,
    events: acceptedEvents,
    stateDeltas,
    entityDeltas: [...(params.entityDeltas ?? [])],
    relationshipDeltas: [...(params.relationshipDeltas ?? [])],
    summary: params.summary,
    provenance: {
      extractor: "inoks-story-chapter-analyzer",
      projectionRole: "derived-read-models",
      ambiguousCandidates: params.candidates.ambiguousCandidates,
      rejectedCandidates: params.candidates.rejectedCandidates,
      projectionPayload: params.projectionPayload,
      ...params.provenance,
    },
    projectionStatus: {
      currentState: "pending" as const,
      temporalMemory: "pending" as const,
      chapterSummary: "pending" as const,
      hooks: "pending" as const,
      entity: "pending" as const,
      relationship: "pending" as const,
      retrievalIndex: "pending" as const,
    },
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
  const commitHash = hashCommitPayload(withoutHash);
  return ChapterCommitSchema.parse({ ...withoutHash, commitHash }) as ChapterCommit;
}

export function validationPassedExceptHumanApproval(validation: CommitValidation): boolean {
  return validation.proseQualityPassed === true
    && validation.continuityPassed === true
    && validation.fulfillmentPassed === true
    && validation.disambiguationPassed === true
    && validation.storyConvergencePassed === true
    && validation.humanFeelPassed === true
    && validation.emotionPassed === true
    && validation.payoffPassed === true
    && validation.structurePassed === true
    && validation.similarityPassed === true
    && validation.temporalPassed === true
    && validation.blockingCount === 0;
}

export function approveChapterCommit(params: {
  readonly commit: ChapterCommit;
  readonly approvedContentHash: string;
  readonly approvedAt?: string;
}): ChapterCommit {
  if (params.commit.source.contentHash !== params.approvedContentHash) {
    throw new Error("Human approval hash does not match the reviewed chapter content");
  }
  if (!validationPassedExceptHumanApproval(params.commit.validation)) {
    throw new Error("Chapter cannot be approved while a required quality gate is unresolved");
  }
  const withoutHash = {
    ...stripCommitHash(params.commit),
    status: "accepted" as const,
    validation: {
      ...params.commit.validation,
      humanApprovalPassed: true,
    },
    provenance: {
      ...params.commit.provenance,
      humanApproval: {
        contentHash: params.approvedContentHash,
        approvedAt: params.approvedAt ?? new Date().toISOString(),
      },
    },
  };
  return ChapterCommitSchema.parse({
    ...withoutHash,
    commitHash: hashCommitPayload(withoutHash),
  }) as ChapterCommit;
}

export function validateChapterCommit(params: {
  readonly commit: ChapterCommit;
  readonly content: string;
  readonly head: ChapterCommit | null;
  readonly allowRejected?: boolean;
  readonly currentValues?: ReadonlyMap<string, unknown>;
}): ChapterCommit {
  const isVerifiedLegacyCommit = verifiedLegacyStoredCommits.has(params.commit);
  const commit = isVerifiedLegacyCommit
    ? params.commit
    : ChapterCommitSchema.parse(params.commit) as ChapterCommit;
  if (!isVerifiedLegacyCommit && hashCommitPayload(stripCommitHash(commit)) !== commit.commitHash) {
    throw new Error(`Commit ${commit.commitId} hash mismatch`);
  }
  if (sha256(params.content) !== commit.source.contentHash) {
    throw new Error(`Commit ${commit.commitId} content hash mismatch`);
  }
  if (commit.parentCommitId !== (params.head?.commitId ?? null)) {
    throw new Error(`Commit parent conflict: expected ${params.head?.commitId ?? "null"}, got ${commit.parentCommitId ?? "null"}`);
  }
  if (commit.previousCommitHash !== (params.head?.commitHash ?? null)) {
    throw new Error("Commit hash-chain parent mismatch");
  }
  const amendmentTarget = typeof commit.provenance.amendsCommitId === "string"
    ? commit.provenance.amendsCommitId
    : null;
  if (amendmentTarget && !params.head) {
    throw new Error("Amendment commit requires an existing HEAD");
  }
  const canonicalHeadChapter = params.head
    ? Number(params.head.provenance.canonicalHeadChapter ?? params.head.chapter)
    : 0;
  const expectedChapter = canonicalHeadChapter + 1;
  if (amendmentTarget) {
    if (commit.chapter < 1 || commit.chapter > canonicalHeadChapter) {
      throw new Error(`Amendment chapter ${commit.chapter} is outside committed history 1-${canonicalHeadChapter}`);
    }
    if (Number(commit.provenance.canonicalHeadChapter) !== canonicalHeadChapter) {
      throw new Error("Amendment canonicalHeadChapter does not match current history");
    }
  } else if (commit.chapter !== expectedChapter) {
    throw new Error(`Chapter sequence conflict: expected ${expectedChapter}, got ${commit.chapter}`);
  }
  if (commit.status === "rejected" && !params.allowRejected) {
    throw new Error(`Commit ${commit.commitId} was rejected`);
  }
  if (params.currentValues) {
    for (const delta of commit.stateDeltas) {
      const key = `${delta.subject}::${delta.predicate}`;
      const hasCurrentValue = params.currentValues.has(key);
      if (hasCurrentValue
        && canonicalJson(params.currentValues.get(key)) !== canonicalJson(delta.oldValue)) {
        throw new Error(`State old-value conflict for ${key}`);
      }
      if (!hasCurrentValue
        && params.head
        && delta.oldValue !== null
        && delta.oldValue !== undefined
        && canonicalJson(delta.oldValue) !== canonicalJson("")) {
        throw new Error(`State old-value conflict for ${key}: no current canonical fact exists`);
      }
    }
  }
  return commit;
}

export class ChapterCommitStore {
  readonly root: string;

  constructor(readonly bookDir: string) {
    this.root = join(bookDir, ".inoks-story-webnovel", "story-system");
  }

  async loadHead(): Promise<ChapterCommit | null> {
    const id = (await readFile(join(this.root, "HEAD"), "utf-8").catch(() => "")).trim();
    if (!id) return null;
    const commits = await this.listCommits();
    const head = commits.find((commit) => commit.commitId === id);
    if (!head) throw new Error(`Story System HEAD points to missing commit ${id}`);
    return head;
  }

  async listCommits(): Promise<ChapterCommit[]> {
    const dir = join(this.root, "commits");
    const names = (await readdir(dir).catch(() => [] as string[]))
      .filter((name) => name.endsWith(".commit.json"))
      .sort();
    const commits: ChapterCommit[] = [];
    for (const name of names) {
      const raw = await readFile(join(dir, name), "utf-8");
      commits.push(parseStoredChapterCommit(JSON.parse(raw)));
    }
    if (commits.length <= 1) return commits;
    const byParent = new Map<string | null, ChapterCommit[]>();
    for (const commit of commits) {
      const children = byParent.get(commit.parentCommitId) ?? [];
      children.push(commit);
      byParent.set(commit.parentCommitId, children);
    }
    const ordered: ChapterCommit[] = [];
    let parentId: string | null = null;
    while (true) {
      const children: ChapterCommit[] = byParent.get(parentId) ?? [];
      if (children.length === 0) break;
      if (children.length > 1) {
        throw new Error(`Story System commit chain forks at ${parentId ?? "root"}`);
      }
      const commit: ChapterCommit = children[0]!;
      ordered.push(commit);
      parentId = commit.commitId;
    }
    if (ordered.length !== commits.length) throw new Error("Story System contains unreachable commits");
    return ordered;
  }

  async loadChapter(chapter: number): Promise<ChapterCommit | null> {
    return (await this.listCommits()).filter((commit) => commit.chapter === chapter).at(-1) ?? null;
  }

  commitPath(chapter: number): string {
    return join(this.root, "commits", `chapter-${String(chapter).padStart(4, "0")}.commit.json`);
  }

  eventPath(chapter: number): string {
    return join(this.root, "events", `chapter-${String(chapter).padStart(4, "0")}.events.json`);
  }

  commitPathFor(commit: ChapterCommit): string {
    return typeof commit.provenance.amendsCommitId === "string"
      ? join(this.root, "commits", `chapter-${String(commit.chapter).padStart(4, "0")}.amendment.${commit.commitId}.commit.json`)
      : this.commitPath(commit.chapter);
  }

  eventPathFor(commit: ChapterCommit): string {
    return typeof commit.provenance.amendsCommitId === "string"
      ? join(this.root, "events", `chapter-${String(commit.chapter).padStart(4, "0")}.amendment.${commit.commitId}.events.json`)
      : this.eventPath(commit.chapter);
  }

  sourcePath(commitId: string): string {
    return join(this.root, "sources", `${commitId}.md`);
  }

  async writeRejected(commit: ChapterCommit): Promise<string> {
    const path = join(this.root, "rejected", `chapter-${String(commit.chapter).padStart(4, "0")}.${commit.commitId}.json`);
    await writeJsonAtomic(path, commit);
    return path;
  }

  async verifyChain(): Promise<void> {
    const commits = (await this.listCommits()).filter((commit) => commit.status === "accepted");
    let parent: ChapterCommit | null = null;
    const latestByChapter = new Map<number, ChapterCommit>();
    for (const commit of commits) latestByChapter.set(commit.chapter, commit);
    for (const commit of commits) {
      const sourceSnapshot = await readFile(this.sourcePath(commit.commitId), "utf-8").catch(() => "");
      const isEffective = latestByChapter.get(commit.chapter)?.commitId === commit.commitId;
      validateChapterCommit({
        commit,
        content: sourceSnapshot
          ? readChapterBodyValue(sourceSnapshot)
          : isEffective
            ? await readChapterBody(join(this.bookDir, commit.source.chapterPath))
            : "",
        head: parent,
      });
      parent = commit;
    }
    const head = await this.loadHead();
    if ((head?.commitId ?? null) !== (parent?.commitId ?? null)) {
      throw new Error("Story System HEAD does not match commit chain tail");
    }
  }
}

export function candidatesFromRuntimeDelta(
  chapter: number,
  delta: RuntimeStateDelta | undefined,
  sourceContent: string,
): ChapterFactCandidates {
  if (!delta) return { acceptedCandidates: [], ambiguousCandidates: [], rejectedCandidates: [] };
  const events: StoryEvent[] = [];
  const push = (eventType: string, subject: string, payload: Record<string, unknown>) => {
    events.push({
      eventId: "pending-event-id",
      chapter,
      eventType,
      subject,
      payload,
      evidence: [`chapter:${chapter}`],
      confidence: 0.95,
      epistemicStatus: "objective",
      sourceExcerpt: findEvidenceExcerpt(sourceContent, payload),
      sourceStart: 0,
      sourceEnd: 0,
    });
  };
  for (const [predicate, value] of Object.entries(delta.currentStatePatch ?? {})) {
    push(predicate === "currentLocation" ? "location_changed" : "entity_state_changed", "protagonist", {
      predicate,
      newValue: value,
    });
  }
  for (const hook of delta.hookOps.upsert) push("open_loop_created", hook.hookId, { ...hook });
  for (const hookId of delta.hookOps.mention) push("open_loop_advanced", hookId, { hookId });
  for (const hookId of delta.hookOps.resolve) push("open_loop_closed", hookId, { hookId });
  for (const candidate of delta.newHookCandidates) {
    push("open_loop_created", candidate.expectedPayoff || candidate.type, { ...candidate });
  }
  return { acceptedCandidates: events, ambiguousCandidates: [], rejectedCandidates: [] };
}

export function extractCandidatesFromTruthProjection(params: {
  readonly chapter: number;
  readonly content: string;
  readonly previousStateMarkdown: string;
  readonly nextStateMarkdown: string;
  readonly previousHooksMarkdown: string;
  readonly nextHooksMarkdown: string;
}): ChapterFactCandidates & { readonly stateDeltas: ReadonlyArray<StateDelta> } {
  const previousFacts = new Map(parseCurrentStateFacts(params.previousStateMarkdown, params.chapter - 1)
    .map((fact) => [`${fact.subject}::${fact.predicate}`, fact.object]));
  const nextFacts = parseCurrentStateFacts(params.nextStateMarkdown, params.chapter);
  const acceptedCandidates: StoryEvent[] = [];
  const ambiguousCandidates: StoryEvent[] = [];
  const rejectedCandidates: StoryEvent[] = [];
  const stateDeltas: StateDelta[] = [];

  for (const fact of nextFacts) {
    const key = `${fact.subject}::${fact.predicate}`;
    const oldValue = previousFacts.get(key) ?? null;
    if (oldValue === fact.object) continue;
    const evidence = locateEvidence(params.content, fact.object);
    const epistemicStatus = inferEpistemicStatus(evidence.excerpt);
    const event: StoryEvent = {
      eventId: "pending-event-id",
      chapter: params.chapter,
      eventType: /位置|location/i.test(fact.predicate) ? "location_changed" : "entity_state_changed",
      subject: fact.subject,
      object: fact.object,
      payload: { predicate: fact.predicate, oldValue, newValue: fact.object },
      evidence: evidence.excerpt ? [evidence.excerpt] : ["validated-truth-projection"],
      confidence: evidence.excerpt ? 0.92 : 0.85,
      epistemicStatus,
      sourceExcerpt: evidence.excerpt,
      sourceStart: evidence.start,
      sourceEnd: evidence.end,
    };
    if (epistemicStatus === "objective" && event.confidence >= 0.75) {
      acceptedCandidates.push(event);
      stateDeltas.push({
        subject: fact.subject,
        predicate: fact.predicate,
        oldValue,
        newValue: fact.object,
      });
    } else {
      ambiguousCandidates.push(event);
    }
  }

  const previousHooks = new Map(parsePendingHooksMarkdown(params.previousHooksMarkdown)
    .map((hook) => [hook.hookId, hook]));
  for (const hook of parsePendingHooksMarkdown(params.nextHooksMarkdown)) {
    const previous = previousHooks.get(hook.hookId);
    if (previous && canonicalJson(previous) === canonicalJson(hook)) continue;
    const eventType = /resolved|closed|已回收|已解决/i.test(hook.status)
      ? "open_loop_closed"
      : previous ? "open_loop_advanced" : "open_loop_created";
    acceptedCandidates.push({
      eventId: "pending-event-id",
      chapter: params.chapter,
      eventType,
      subject: hook.hookId,
      payload: { ...hook },
      evidence: [`truth-projection:${hook.hookId}`],
      confidence: 0.9,
      epistemicStatus: "objective",
      sourceExcerpt: "",
      sourceStart: 0,
      sourceEnd: 0,
    });
  }

  return { acceptedCandidates, ambiguousCandidates, rejectedCandidates, stateDeltas };
}

function stateDeltasFromRuntimeDelta(
  delta: RuntimeStateDelta,
  events: ReadonlyArray<StoryEvent>,
): StateDelta[] {
  return Object.entries(delta.currentStatePatch ?? {}).map(([predicate, newValue]) => {
    const event = events.find((candidate) => candidate.payload.predicate === predicate);
    return {
      subject: "protagonist",
      predicate,
      oldValue: null,
      newValue,
      sourceEventId: event?.eventId,
    };
  });
}

function findEvidenceExcerpt(content: string, payload: Record<string, unknown>): string {
  const values = Object.values(payload).filter((value): value is string => typeof value === "string" && value.length >= 2);
  for (const value of values) {
    const index = content.indexOf(value);
    if (index >= 0) return content.slice(Math.max(0, index - 40), Math.min(content.length, index + value.length + 40));
  }
  return "";
}

function locateEvidence(content: string, value: string): { excerpt: string; start: number; end: number } {
  const index = content.indexOf(value);
  if (index < 0) return { excerpt: "", start: 0, end: 0 };
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + value.length + 60);
  return { excerpt: content.slice(start, end), start: index, end: index + value.length };
}

function inferEpistemicStatus(excerpt: string): StoryEvent["epistemicStatus"] {
  if (/梦中|梦里|梦见|做梦/.test(excerpt)) return "dream";
  if (/据说|传闻|听说/.test(excerpt)) return "rumor";
  if (/谎称|撒谎|骗(?:他|她|人)/.test(excerpt)) return "lie";
  if (/假如|假设|倘若|如果/.test(excerpt)) return "hypothesis";
  if (/计划|打算|准备将|准备要/.test(excerpt)) return "plan";
  if (/以为|猜测|怀疑|认为/.test(excerpt)) return "character-belief";
  return "objective";
}

function hashCommitPayload(value: unknown): string {
  return sha256(canonicalJson(value));
}

function parseStoredChapterCommit(value: unknown): ChapterCommit {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ChapterCommitSchema.parse(value) as ChapterCommit;
  }
  const raw = value as Record<string, unknown>;
  const validation = raw.validation;
  if (!validation || typeof validation !== "object" || Array.isArray(validation)) {
    return ChapterCommitSchema.parse(value) as ChapterCommit;
  }
  const validationRecord = validation as Record<string, unknown>;
  const missingKeys = LEGACY_EXTENDED_VALIDATION_KEYS.filter((key) => validationRecord[key] === undefined);
  if (missingKeys.length === 0) return ChapterCommitSchema.parse(value) as ChapterCommit;

  if (raw.schemaVersion !== STORY_SYSTEM_SCHEMA_VERSION) {
    return ChapterCommitSchema.parse(value) as ChapterCommit;
  }
  const { commitHash, ...withoutHash } = raw;
  if (typeof commitHash !== "string" || hashCommitPayload(withoutHash) !== commitHash) {
    throw new Error(`Legacy commit ${String(raw.commitId ?? "unknown")} hash mismatch`);
  }

  const legacyAccepted = raw.status === "accepted";
  const normalized = ChapterCommitSchema.parse({
    ...raw,
    validation: {
      ...validationRecord,
      ...Object.fromEntries(missingKeys.map((key) => [key, legacyAccepted])),
    },
  }) as ChapterCommit;
  verifiedLegacyStoredCommits.add(normalized);
  return normalized;
}

function stripCommitHash(commit: ChapterCommit): Omit<ChapterCommit, "commitHash"> {
  const { commitHash: _commitHash, ...rest } = commit;
  return rest;
}

function normalizeRelativePath(bookDir: string, path: string): string {
  return relative(bookDir, path).replace(/\\/g, "/");
}

async function readChapterBody(path: string): Promise<string> {
  const raw = await readFile(path, "utf-8");
  return readChapterBodyValue(raw);
}

function readChapterBodyValue(raw: string): string {
  return raw.replace(/^# .*\r?\n+/, "");
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(temp, path);
}
