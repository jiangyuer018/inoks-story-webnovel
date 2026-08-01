import { BaseAgent } from "./base.js";
import type { BookConfig } from "../models/book.js";
import type { GenreProfile } from "../models/genre-profile.js";
import type { BookRules } from "../models/book-rules.js";
import { buildWriterSystemPrompt, type FanficContext } from "./writer-prompts.js";
import { buildSettlerSystemPrompt, buildSettlerUserPrompt } from "./settler-prompts.js";
import { buildObserverSystemPrompt, buildObserverUserPrompt } from "./observer-prompts.js";
import { parseSettlerDeltaOutput } from "./settler-delta-parser.js";
import { parseSettlementOutput } from "./settler-parser.js";
import { readGenreProfile, readBookRules } from "./rules-reader.js";
import {
  detectCrossChapterRepetition,
  detectParagraphLengthDrift,
  normalizePostWriteSurface,
  validatePostWrite,
  type PostWriteViolation,
} from "./post-write-validator.js";
import { analyzeAITells } from "./ai-tells.js";
import { buildCoreProseQualityConstraints } from "../prose-quality/prompt.js";
import type { ChapterIntent, ChapterMemo, ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthSpec } from "../models/length-governance.js";
import type { RuntimeStateDelta } from "../models/runtime-state.js";
import { buildLengthSpec, countChapterLength } from "../utils/length-metrics.js";
import {
  capContextBlock,
  filterHooks,
  filterSummaries,
  filterSubplots,
  filterEmotionalArcs,
  filterCharacterMatrix,
} from "../utils/context-filter.js";
import { buildGovernedMemoryEvidenceBlocks } from "../utils/governed-context.js";
import {
  buildGovernedCharacterMatrixWorkingSet,
  buildGovernedHookWorkingSet,
  mergeCharacterMatrixMarkdown,
  mergeTableMarkdownByKey,
} from "../utils/governed-working-set.js";
import { extractPOVFromOutline, filterMatrixByPOV, filterHooksByPOV } from "../utils/pov-filter.js";
import { parseCreativeOutput, type CreativeOutput } from "./writer-parser.js";
import type {
  RealizedScene,
  SceneRealizationBundle,
  SceneSemanticReviewRecord,
  SemanticSceneReview,
} from "../scene-realization/types.js";
import {
  HumanSceneRepairAgent,
  SceneSemanticGateError,
  SemanticSceneReviewerAgent,
} from "../scene-realization/index.js";
import { buildRuntimeStateArtifacts, type RuntimeStateArtifacts } from "../state/runtime-state-store.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";
import {
  renderCompiledWritingContract,
  type CompiledWritingContract,
} from "../story-spec/index.js";
import { parsePendingHooksMarkdown } from "../utils/memory-retrieval.js";
import { analyzeHookHealth } from "../utils/hook-health.js";
import { buildEnglishVarianceBrief } from "../utils/long-span-fatigue.js";
import {
  buildNarrativeIntentBrief,
  renderMemoAsNarrativeBlock,
  renderNarrativeSelectedContext,
  sanitizeNarrativeEvidenceBlock,
} from "../utils/narrative-control.js";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const LEGACY_WRITER_CONTEXT_BUDGET = {
  storyBible: 14_000,
  currentState: 7_000,
  ledger: 6_000,
  hooks: 9_000,
  chapterSummaries: 9_000,
  subplotBoard: 7_000,
  emotionalArcs: 7_000,
  characterMatrix: 12_000,
  parentCanon: 12_000,
  volumeOutline: 12_000,
} as const;
import {
  readStoryFrame,
  readVolumeMap,
  readCharacterContext,
  readCurrentStateWithFallback,
} from "../utils/outline-paths.js";

export interface WriteChapterInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly externalContext?: string;
  readonly chapterIntent?: string;
  readonly chapterMemo?: ChapterMemo;
  readonly chapterIntentData?: ChapterIntent;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly compiledWritingContract?: CompiledWritingContract;
  readonly lengthSpec?: LengthSpec;
  readonly wordCountOverride?: number;
  readonly temperatureOverride?: number;
  /** Canonical pipeline defers all fact extraction until the final prose is accepted. */
  readonly deferSettlement?: boolean;
}

function cleanSceneProse(raw: string): string {
  let text = raw.trim()
    .replace(/^```(?:markdown|md|text)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const tagged = text.match(/===\s*CHAPTER_CONTENT\s*===\s*([\s\S]*?)(?====\s*[A-Z_]+\s*===|$)/);
  if (tagged?.[1]) text = tagged[1].trim();
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:SCENE|场景)\s*(?:ID)?\s*[：:]/i.test(line))
    .join("\n")
    .trim();
}

function addTokenUsage(
  target: { promptTokens: number; completionTokens: number; totalTokens: number },
  usage: TokenUsage,
): void {
  target.promptTokens += usage.promptTokens;
  target.completionTokens += usage.completionTokens;
  target.totalTokens += usage.totalTokens;
}

export function normalizeSemanticReview(scene: RealizedScene, review: SemanticSceneReview): SemanticSceneReview {
  const hasHardFailure = !review.entryExitStateMatch
    || review.unintendedFacts.some((issue) => issue.severity === "blocking")
    || review.dialogueTurns.some((turn) => turn.violatesKnowledgeBoundary);
  if (review.verdict === "block" || hasHardFailure) {
    return review.verdict === "block" ? review : { ...review, verdict: "block" };
  }

  const informationById = new Map(review.informationFulfillment.map((item) => [item.informationUnitId, item]));
  const interactionByOrder = new Map(review.interactionFulfillment.map((item) => [item.turnOrder, item]));
  const needsRepair = review.verdict === "repair"
    || review.missingDramatization.length > 0
    || review.narrationUnits.some((unit) => !unit.necessary || !unit.permissionMatched)
    || review.dialogueTurns.some((turn) => (
      !turn.respondsToPreviousTurn
      || !turn.changesInteraction
      || turn.informationDump
      || turn.speakerGoal === null
    ))
    || review.actions.some((action) => (
      action.intention === null
      || action.observableEffect === null
      || action.removableWithoutLoss
    ))
    || review.thoughts.some((thought) => (
      thought.observation === null
      || thought.interpretation === null
      || (thought.beliefChange === null && thought.strategyChange === null && thought.decisionChange === null)
    ))
    || review.environmentDetails.some((detail) => detail.removableWithoutLoss)
    || scene.informationUnits.some((unit) => {
      const fulfillment = informationById.get(unit.id);
      return !fulfillment?.delivered || !fulfillment.consequenceVisible || fulfillment.carrierUsed.length === 0;
    })
    || scene.interactionTurns.some((turn) => {
      const fulfillment = interactionByOrder.get(turn.order);
      return !fulfillment?.fulfilled || (fulfillment.missingParts.length > 0);
    });
  return needsRepair && review.verdict === "pass" ? { ...review, verdict: "repair" } : review;
}

function buildSceneImmutableFacts(scene: RealizedScene): string[] {
  const facts = [
    ...scene.informationUnits.map((unit) => unit.fact),
    scene.plan.turningPoint,
    scene.plan.decisionPoint,
    scene.plan.irreversibleChange,
    ...scene.plan.entryState.goals,
    ...scene.plan.entryState.relationships,
    ...scene.plan.entryState.risks,
    ...scene.plan.entryState.resources,
    ...scene.plan.entryState.information,
    ...scene.plan.exitState.goals,
    ...scene.plan.exitState.relationships,
    ...scene.plan.exitState.risks,
    ...scene.plan.exitState.resources,
    ...scene.plan.exitState.information,
  ].map((item) => item.trim()).filter(Boolean);
  return [...new Set(facts)];
}

function buildSceneAllowedChanges(review: SemanticSceneReview): string[] {
  const changes = [
    ...review.missingDramatization.map((issue) => issue.message),
    ...review.narrationUnits
      .filter((unit) => !unit.necessary || !unit.permissionMatched)
      .map((unit) => `重构无许可或无必要的旁白：${unit.excerpt}`),
    ...review.dialogueTurns
      .filter((turn) => !turn.respondsToPreviousTurn || !turn.changesInteraction || turn.informationDump)
      .map((turn) => `重构未形成刺激—反应的对白：${turn.excerpt}`),
    ...review.actions
      .filter((action) => action.removableWithoutLoss || action.intention === null || action.observableEffect === null)
      .map((action) => `删除或赋予行动意图与后果：${action.excerpt}`),
    ...review.environmentDetails
      .filter((detail) => detail.removableWithoutLoss)
      .map((detail) => `删除或让环境参与行动：${detail.excerpt}`),
    ...review.interactionFulfillment
      .filter((turn) => !turn.fulfilled || turn.missingParts.length > 0)
      .map((turn) => `补全互动第 ${turn.turnOrder} 轮：${turn.missingParts.join("、")}`),
  ].filter(Boolean);
  return changes.length > 0 ? [...new Set(changes)] : ["按语义审查结论完成最小必要场景重构"];
}

export interface SettleChapterStateInput {
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly allowReapply?: boolean;
  readonly chapterIntent?: string;
  readonly contextPackage?: ContextPackage;
  readonly ruleStack?: RuleStack;
  readonly validationFeedback?: string;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface WriteChapterOutput {
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly wordCount: number;
  readonly preWriteCheck: string;
  readonly postSettlement: string;
  readonly runtimeStateDelta?: RuntimeStateDelta;
  readonly runtimeStateSnapshot?: RuntimeStateSnapshot;
  readonly updatedState: string;
  readonly updatedLedger: string;
  readonly updatedHooks: string;
  readonly chapterSummary: string;
  readonly updatedChapterSummaries?: string;
  readonly updatedSubplots: string;
  readonly updatedEmotionalArcs: string;
  readonly updatedCharacterMatrix: string;
  readonly postWriteErrors: ReadonlyArray<PostWriteViolation>;
  readonly postWriteWarnings: ReadonlyArray<PostWriteViolation>;
  readonly hookHealthIssues?: ReadonlyArray<{
    readonly severity: "critical" | "warning" | "info";
    readonly category: string;
    readonly description: string;
    readonly suggestion: string;
  }>;
  readonly semanticSceneReviews?: ReadonlyArray<SceneSemanticReviewRecord>;
  readonly tokenUsage?: TokenUsage;
}

export class WriterAgent extends BaseAgent {
  get name(): string {
    return "writer";
  }

  private localize(language: "zh" | "en", messages: { zh: string; en: string }): string {
    return language === "en" ? messages.en : messages.zh;
  }

  private logInfo(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.info(this.localize(language, messages));
  }

  private logWarn(language: "zh" | "en", messages: { zh: string; en: string }): void {
    this.ctx.logger?.warn(this.localize(language, messages));
  }

  async writeChapter(input: WriteChapterInput): Promise<WriteChapterOutput> {
    const { book, bookDir, chapterNumber } = input;

    const placeholder = "(文件尚未创建)";
    const [
      storyBible, volumeOutline, styleGuide, currentState, ledger, hooks,
      chapterSummaries, subplotBoard, emotionalArcs, characterMatrix, styleProfileRaw,
      parentCanon, fanficCanonRaw,
    ] = await Promise.all([
        readStoryFrame(bookDir, placeholder),
        readVolumeMap(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/style_guide.md")),
        // Phase 5 consolidation: architect no longer emits an initial current_state
        // section. When the file is only a seed placeholder, derive initial state
        // from roles/*.Current_State + pending_hooks startChapter=0 rows so the
        // writer still sees substantive content instead of a runtime-append note.
        readCurrentStateWithFallback(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/particle_ledger.md")),
        this.readFileOrDefault(join(bookDir, "story/pending_hooks.md")),
        this.readFileOrDefault(join(bookDir, "story/chapter_summaries.md")),
        this.readFileOrDefault(join(bookDir, "story/subplot_board.md")),
        this.readFileOrDefault(join(bookDir, "story/emotional_arcs.md")),
        readCharacterContext(bookDir, placeholder),
        this.readFileOrDefault(join(bookDir, "story/style_profile.json")),
        this.readFileOrDefault(join(bookDir, "story/parent_canon.md")),
        this.readFileOrDefault(join(bookDir, "story/fanfic_canon.md")),
      ]);

    const recentChapters = await this.loadRecentChapters(bookDir, chapterNumber);
    // Load more chapters for dialogue fingerprint extraction (voice consistency over longer span)
    const fingerprintChapters = await this.loadRecentChapters(bookDir, chapterNumber, 5);

    // Load genre profile + book rules
    const { profile: genreProfile, body: genreBody } =
      await readGenreProfile(this.ctx.projectRoot, book.genre);
    const parsedBookRules = await readBookRules(bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const bookRulesBody = parsedBookRules?.body ?? "";

    const styleFingerprint = this.buildStyleFingerprint(styleProfileRaw);

    const dialogueFingerprints = this.extractDialogueFingerprints(fingerprintChapters, storyBible);
    const relevantSummaries = this.findRelevantSummaries(chapterSummaries, volumeOutline, chapterNumber);

    const hasParentCanon = parentCanon !== "(文件尚未创建)";
    const hasFanficCanon = fanficCanonRaw !== "(文件尚未创建)";
    const resolvedLanguage = book.language ?? genreProfile.language;
    const targetWords = input.lengthSpec?.target ?? input.wordCountOverride ?? book.chapterWordCount;
    const resolvedLengthSpec = input.lengthSpec ?? buildLengthSpec(targetWords, resolvedLanguage);
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;
    const englishVarianceBrief = resolvedLanguage === "en"
      ? await buildEnglishVarianceBrief({
          bookDir,
          chapterNumber,
        })
      : null;

    // Build fanfic context if fanfic_canon.md exists
    const fanficContext: FanficContext | undefined = hasFanficCanon && bookRules?.fanficMode
      ? {
          fanficCanon: fanficCanonRaw,
          fanficMode: bookRules.fanficMode,
          allowedDeviations: bookRules.allowedDeviations ?? [],
        }
      : undefined;

    // ── Phase 1: Creative writing (temperature 0.7) ──
    const creativeSystemPrompt = await this.withPromptPackGuidance([
      buildWriterSystemPrompt(
        book, genreProfile, bookRules, bookRulesBody, genreBody, styleGuide, styleFingerprint,
        chapterNumber, "creative", fanficContext, resolvedLanguage,
        input.chapterMemo ? "governed" : "legacy",
        resolvedLengthSpec,
      ),
      buildCoreProseQualityConstraints(resolvedLanguage),
      input.compiledWritingContract
        ? renderCompiledWritingContract(input.compiledWritingContract)
        : "",
    ].join("\n\n"), "longform.writer");

    const creativeUserPrompt = input.chapterMemo && input.contextPackage && input.ruleStack
      ? this.buildGovernedUserPrompt({
          chapterNumber,
          chapterMemo: input.chapterMemo,
          chapterIntentData: input.chapterIntentData,
          contextPackage: input.contextPackage,
          ruleStack: input.ruleStack,
          externalContext: input.externalContext,
          lengthSpec: resolvedLengthSpec,
          language: book.language ?? genreProfile.language,
          varianceBrief: englishVarianceBrief?.text,
          selectedEvidenceBlock: this.joinGovernedEvidenceBlocks(governedMemoryBlocks),
        })
      : (() => {
          // Smart context filtering: inject only relevant parts of truth files
          const filteredHooks = filterHooks(hooks);
          const filteredSummaries = filterSummaries(chapterSummaries, chapterNumber);
          const filteredSubplots = filterSubplots(subplotBoard);
          const filteredArcs = filterEmotionalArcs(emotionalArcs, chapterNumber);
          const filteredMatrix = filterCharacterMatrix(characterMatrix, volumeOutline, bookRules?.protagonist?.name);

          // POV-aware filtering: limit context to what the POV character knows
          const povCharacter = extractPOVFromOutline(volumeOutline, chapterNumber);
          const povFilteredMatrix = povCharacter
            ? filterMatrixByPOV(filteredMatrix, povCharacter)
            : filteredMatrix;
          const povFilteredHooks = povCharacter
            ? filterHooksByPOV(filteredHooks, povCharacter, chapterSummaries)
            : filteredHooks;

          return this.buildUserPrompt({
            chapterNumber,
            storyBible,
            currentState,
            ledger: genreProfile.numericalSystem ? ledger : "",
            hooks: povFilteredHooks,
            recentChapters,
            lengthSpec: resolvedLengthSpec,
            externalContext: input.externalContext,
            chapterSummaries: filteredSummaries,
            subplotBoard: filteredSubplots,
            emotionalArcs: filteredArcs,
            characterMatrix: povFilteredMatrix,
            dialogueFingerprints,
            relevantSummaries,
            parentCanon: hasParentCanon ? parentCanon : undefined,
            language: book.language ?? genreProfile.language,
          });
        })();

    const creativeTemperature = input.temperatureOverride ?? 0.7;

    this.logInfo(resolvedLanguage, {
      zh: `阶段 1：创作正文（第${chapterNumber}章）`,
      en: `Phase 1: creative writing for chapter ${chapterNumber}`,
    });

    const realizedWriting = input.compiledWritingContract?.chapterSpec.sceneRealization
      ? await this.writeRealizedScenes({
          realization: input.compiledWritingContract.chapterSpec.sceneRealization,
          baseSystemPrompt: creativeSystemPrompt,
          baseUserPrompt: creativeUserPrompt,
          language: resolvedLanguage,
          chapterNumber,
          temperature: creativeTemperature,
          countingMode: resolvedLengthSpec.countingMode,
        })
      : null;
    const creativeResponse = realizedWriting
      ? null
      : await this.chat(
          [
            { role: "system", content: creativeSystemPrompt },
            { role: "user", content: creativeUserPrompt },
          ],
          { temperature: creativeTemperature },
        );
    const creativeUsage = realizedWriting?.usage ?? creativeResponse!.usage;

    const creative = realizedWriting?.creative
      ?? parseCreativeOutput(chapterNumber, creativeResponse!.content, resolvedLengthSpec.countingMode);
    const titleReview = await this.reviewChapterTitle({
      title: creative.title,
      content: creative.content,
      chapterNumber,
      chapterSummaries,
      externalContext: input.externalContext,
      language: resolvedLanguage,
    });
    const reviewedTitle = titleReview.title ?? creative.title;

    // Phase 4: soft-check that PRE_WRITE_CHECK aligns with the chapter memo.
    // Memo was already parse-validated in the planner, so this only warns —
    // the LLM self-check may have skipped or abbreviated a row.
    if (input.chapterMemo) {
      this.verifyPreWriteCheckAlignsWithMemo(creative.preWriteCheck, chapterNumber, resolvedLanguage);
    }

    // ── Phase 2: State settlement (temperature 0.3) ──
    this.logInfo(resolvedLanguage, input.deferSettlement ? {
      zh: `阶段 2：延后状态结算，等待正文质量门（第${chapterNumber}章）`,
      en: `Phase 2: deferring state settlement until the prose gate accepts chapter ${chapterNumber}`,
    } : {
      zh: `阶段 2：状态结算（第${chapterNumber}章，${creative.wordCount}字）`,
      en: `Phase 2: state settlement for chapter ${chapterNumber} (${creative.wordCount} words)`,
    });
    const isGovernedSettlement = Boolean(input.chapterIntent && input.contextPackage && input.ruleStack);
    const filteredHooksForSettlement = isGovernedSettlement && input.contextPackage
      ? buildGovernedHookWorkingSet({
          hooksMarkdown: hooks,
          contextPackage: input.contextPackage,
          chapterIntent: input.chapterIntent,
          chapterNumber,
          language: resolvedLanguage,
        })
      : hooks;
    const filteredSubplotsForSettlement = isGovernedSettlement
      ? filterSubplots(subplotBoard)
      : subplotBoard;
    const filteredArcsForSettlement = isGovernedSettlement
      ? filterEmotionalArcs(emotionalArcs, chapterNumber)
      : emotionalArcs;
    const filteredMatrixForSettlement = isGovernedSettlement
      ? buildGovernedCharacterMatrixWorkingSet({
          matrixMarkdown: characterMatrix,
          chapterIntent: input.chapterIntent ?? volumeOutline,
          contextPackage: input.contextPackage!,
          protagonistName: bookRules?.protagonist?.name,
        })
      : characterMatrix;

    const settleResult = input.deferSettlement
      ? {
          settlement: {
            postSettlement: "",
            runtimeStateDelta: undefined,
            runtimeStateSnapshot: undefined,
            updatedState: currentState,
            updatedLedger: ledger,
            updatedHooks: hooks,
            chapterSummary: "",
            updatedSubplots: subplotBoard,
            updatedEmotionalArcs: emotionalArcs,
            updatedCharacterMatrix: characterMatrix,
          },
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        }
      : await this.settle({
          book,
          genreProfile,
          bookRules,
          chapterNumber,
          title: reviewedTitle,
          content: creative.content,
          currentState,
          ledger: genreProfile.numericalSystem ? ledger : "",
          hooks: filteredHooksForSettlement,
          chapterSummaries: input.contextPackage ? filterSummaries(chapterSummaries, chapterNumber) : chapterSummaries,
          subplotBoard: filteredSubplotsForSettlement,
          emotionalArcs: filteredArcsForSettlement,
          characterMatrix: filteredMatrixForSettlement,
          volumeOutline,
          selectedEvidenceBlock: governedMemoryBlocks
            ? this.joinGovernedEvidenceBlocks(governedMemoryBlocks)
            : undefined,
          chapterIntent: input.chapterIntent,
          contextPackage: input.contextPackage,
          ruleStack: input.ruleStack,
          validationFeedback: undefined,
          originalHooks: hooks,
          originalSubplots: subplotBoard,
          originalEmotionalArcs: emotionalArcs,
          originalCharacterMatrix: characterMatrix,
        });
    const settlement = settleResult.settlement;
    const settleUsage = settleResult.usage;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      chapterNumber,
    );
    const resolvedRuntimeStateDelta = runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta;
    const priorHookIds = new Set(parsePendingHooksMarkdown(hooks).map((hook) => hook.hookId));
    const hookHealthIssues = resolvedRuntimeStateDelta
      && (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)
      ? analyzeHookHealth({
          language: resolvedLanguage,
          chapterNumber,
          targetChapters: book.targetChapters,
          hooks: (runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot)!.hooks.hooks,
          delta: resolvedRuntimeStateDelta,
          existingHookIds: [...priorHookIds],
        })
      : [];

    // ── Post-write validation (regex + rule-based, zero LLM cost) ──
    const surfaceNormalizedContent = normalizePostWriteSurface(creative.content, resolvedLanguage);
    const surfaceNormalizedWordCount = countChapterLength(surfaceNormalizedContent, resolvedLengthSpec.countingMode);
    const ruleViolations = [
      ...validatePostWrite(surfaceNormalizedContent, genreProfile, bookRules, resolvedLanguage),
      ...detectCrossChapterRepetition(surfaceNormalizedContent, fingerprintChapters, resolvedLanguage),
      ...detectParagraphLengthDrift(surfaceNormalizedContent, fingerprintChapters, resolvedLanguage),
    ];
    const aiTellIssues = analyzeAITells(surfaceNormalizedContent, resolvedLanguage).issues;

    const postWriteErrors = ruleViolations.filter(v => v.severity === "error");
    const postWriteWarnings = ruleViolations.filter(v => v.severity === "warning");

    if (ruleViolations.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `后写校验：第${chapterNumber}章 ${postWriteErrors.length} 个错误，${postWriteWarnings.length} 个警告`,
        en: `Post-write: ${postWriteErrors.length} errors, ${postWriteWarnings.length} warnings in chapter ${chapterNumber}`,
      });
      for (const v of ruleViolations) {
        this.ctx.logger?.warn(`[${v.severity}] ${v.rule}: ${v.description}`);
      }
    }
    if (aiTellIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `AI 味检查：第${chapterNumber}章发现 ${aiTellIssues.length} 个问题`,
        en: `AI-tell check: ${aiTellIssues.length} issues in chapter ${chapterNumber}`,
      });
      for (const issue of aiTellIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }
    if (hookHealthIssues.length > 0) {
      this.logWarn(resolvedLanguage, {
        zh: `伏笔健康：第${chapterNumber}章发现 ${hookHealthIssues.length} 条警告`,
        en: `Hook health: ${hookHealthIssues.length} warning(s) in chapter ${chapterNumber}`,
      });
      for (const issue of hookHealthIssues) {
        this.ctx.logger?.warn(`[${issue.severity}] ${issue.category}: ${issue.description}`);
      }
    }

    // ── Merge into WriteChapterOutput ──
    const tokenUsage: TokenUsage = {
      promptTokens: creativeUsage.promptTokens + settleUsage.promptTokens + (titleReview.usage?.promptTokens ?? 0),
      completionTokens: creativeUsage.completionTokens + settleUsage.completionTokens + (titleReview.usage?.completionTokens ?? 0),
      totalTokens: creativeUsage.totalTokens + settleUsage.totalTokens + (titleReview.usage?.totalTokens ?? 0),
    };

    return {
      chapterNumber,
      title: reviewedTitle,
      content: surfaceNormalizedContent,
      wordCount: surfaceNormalizedWordCount,
      preWriteCheck: creative.preWriteCheck,
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: resolvedRuntimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: resolvedRuntimeStateDelta
        ? this.renderDeltaSummaryRow(resolvedRuntimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors,
      postWriteWarnings,
      hookHealthIssues,
      semanticSceneReviews: realizedWriting?.sceneReviews,
      tokenUsage,
    };
  }

  private async writeRealizedScenes(input: {
    readonly realization: SceneRealizationBundle;
    readonly baseSystemPrompt: string;
    readonly baseUserPrompt: string;
    readonly language: "zh" | "en";
    readonly chapterNumber: number;
    readonly temperature: number;
    readonly countingMode: LengthSpec["countingMode"];
  }): Promise<{
    readonly creative: CreativeOutput;
    readonly usage: TokenUsage;
    readonly sceneReviews: ReadonlyArray<SceneSemanticReviewRecord>;
  }> {
    const usage: { promptTokens: number; completionTokens: number; totalTokens: number } = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    const completed: string[] = [];
    const sceneReviews: SceneSemanticReviewRecord[] = [];
    const reviewer = new SemanticSceneReviewerAgent(this.ctx);
    const repairer = new HumanSceneRepairAgent(this.ctx);
    const budgetByEvent = new Map(
      input.realization.concretenessPlan.map((item) => [item.eventId, item.plannedCharBudget]),
    );
    const fallbackBudget = Math.max(
      300,
      Math.round(
        input.realization.concretenessPlan.reduce((sum, item) => sum + item.plannedCharBudget, 0)
        / input.realization.scenes.length,
      ),
    );

    for (const scene of input.realization.scenes) {
      const directBudget = budgetByEvent.get(scene.plan.id);
      const beatBudget = scene.plan.beatIds
        .map((id) => budgetByEvent.get(id) ?? 0)
        .reduce((sum, value) => sum + value, 0);
      const targetChars = directBudget ?? (beatBudget > 0 ? beatBudget : fallbackBudget);
      const previousTail = completed.at(-1)?.slice(-1_200) ?? "";
      const response = await this.chat([
        {
          role: "system",
          content: [
            input.baseSystemPrompt,
            "",
            input.language === "en"
              ? "SCENE-REALIZATION MODE: Write only the requested scene. Do not add a title, labels, analysis, new canon facts, or a later scene."
              : "【逐场景实现模式】只写当前场景正文。不要输出标题、标签、说明，不要新增正史事实，不要提前写后续场景。",
            input.language === "en"
              ? "Every line must implement the supplied agendas, information carriers, interaction dependencies, and narration permissions. Narration without a matching permission is forbidden."
              : "每一句都要实现给定人物议程、信息承载、互动依赖和旁白许可。没有匹配许可的解释性旁白禁止出现。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            input.baseUserPrompt,
            "",
            `CURRENT_SCENE_JSON:\n${JSON.stringify(scene, null, 2)}`,
            `TARGET_SCENE_CHARS: ${targetChars || fallbackBudget}`,
            previousTail ? `PREVIOUS_SCENE_TAIL:\n${previousTail}` : "PREVIOUS_SCENE_TAIL: (opening scene)",
            input.language === "en"
              ? "Return scene prose only. End exactly at this scene's exit state."
              : "只返回场景正文，并准确停在本场 exitState；不得用总结或预告收尾。",
          ].join("\n\n"),
        },
      ], { temperature: input.temperature });
      usage.promptTokens += response.usage.promptTokens;
      usage.completionTokens += response.usage.completionTokens;
      usage.totalTokens += response.usage.totalTokens;
      let prose = cleanSceneProse(response.content);
      if (countChapterLength(prose, input.countingMode) < 100) {
        throw new Error(`Scene ${scene.plan.id} returned empty or unusably short prose`);
      }

      let reviewResult = await reviewer.review({ scene, content: prose, language: input.language });
      addTokenUsage(usage, reviewResult.usage);
      let review = normalizeSemanticReview(scene, reviewResult.review);
      if (review.verdict === "block") {
        throw new SceneSemanticGateError(scene.plan.id, review);
      }

      let repairIterations = 0;
      for (let iteration = 0; review.verdict === "repair" && iteration < 2; iteration += 1) {
        repairIterations = iteration + 1;
        const repaired = await repairer.repair({
          originalScene: prose,
          scenePlan: scene.plan,
          characterAgendas: scene.characterAgendas,
          informationUnits: scene.informationUnits,
          interactionTurns: scene.interactionTurns,
          narrationPermissions: scene.narrationPermissions,
          review,
          immutableFacts: buildSceneImmutableFacts(scene),
          allowedChanges: buildSceneAllowedChanges(review),
          language: input.language,
        });
        addTokenUsage(usage, repaired.usage);
        const repairedProse = cleanSceneProse(repaired.content);
        if (repairedProse === prose || countChapterLength(repairedProse, input.countingMode) < 100) {
          throw new SceneSemanticGateError(scene.plan.id, review);
        }
        prose = repairedProse;
        reviewResult = await reviewer.review({ scene, content: prose, language: input.language });
        addTokenUsage(usage, reviewResult.usage);
        review = normalizeSemanticReview(scene, reviewResult.review);
        if (review.verdict === "block") {
          throw new SceneSemanticGateError(scene.plan.id, review);
        }
      }

      if (review.verdict !== "pass") {
        throw new SceneSemanticGateError(scene.plan.id, review);
      }
      completed.push(prose);
      sceneReviews.push({
        sceneId: scene.plan.id,
        content: prose,
        review,
        repairIterations,
      });
    }

    const content = completed.join("\n\n");
    return {
      creative: {
        title: input.language === "en"
          ? `Chapter ${input.chapterNumber}`
          : `第${input.chapterNumber}章`,
        content,
        wordCount: countChapterLength(content, input.countingMode),
        preWriteCheck: input.realization.scenes
          .map((scene) => `${scene.plan.id}: ${scene.plan.immediateGoal} → ${scene.plan.irreversibleChange}`)
          .join("\n"),
      },
      usage,
      sceneReviews,
    };
  }

  private async reviewChapterTitle(input: {
    readonly title: string;
    readonly content: string;
    readonly chapterNumber: number;
    readonly chapterSummaries: string;
    readonly externalContext?: string;
    readonly language: "zh" | "en";
  }): Promise<{ readonly title?: string; readonly usage?: TokenUsage }> {
    if (this.hasExplicitTitleInstruction(input.externalContext)) {
      return {};
    }
    // Lightweight unit-test and offline clients intentionally do not carry a
    // resolved provider model. Do not turn title polish into a hard dependency
    // for an otherwise valid write/settlement run.
    if (!this.ctx.client._piModel) {
      return {};
    }

    const titleHistory = input.chapterSummaries
      .split(/\r?\n/)
      .filter((line) => line.includes("|"))
      .slice(-16)
      .join("\n")
      .slice(-1800);
    const content = input.content.slice(0, 12_000);
    const system = input.language === "en"
      ? "You are a chapter-title reviewer. Return exactly one final title and nothing else."
      : "你是章节标题复审编辑。只输出一个最终章节标题，不要解释、编号、引号或 Markdown。";
    const user = input.language === "en"
      ? [
          "Review the title after reading the completed chapter.",
          "The title and the ending hook have separate jobs: preserve the ending's question, but make the title carry an emotional afterimage.",
          "Prefer one of: a concrete emotional anchor, a relationship phrase, an irreversible time/place threshold, or a costly choice.",
          "Do not summarize the plot, spoil unrevealed facts, reuse recent title roots or high-frequency atmosphere words, or use generic words such as crisis, truth, fate, or story.",
          "The title must be grounded in at least two details from the chapter. Keep it concise.",
          "Draft title: " + input.title,
          "Recent title history:",
          titleHistory || "(none)",
          "Completed chapter:",
          content,
        ].join("\n\n")
      : [
          "请在读完完整正文后复审章节标题。",
          "标题和章末钩子职责不同：保留章末要追问的问题，但让标题承载本章结束后的情绪余韵。",
          "优先从情绪锚物、关系句、不可逆的时空门槛、代价性选择中选一种。",
          "不要复述剧情、剧透未揭示事实、复用近期标题词根或高频气氛词；不要使用危机、真相、命运、故事等万能词。",
          "标题必须能在正文中找到至少两处依据，且简洁。",
          "初稿标题：" + input.title,
          "近期标题历史：",
          titleHistory || "（无）",
          "完整正文：",
          content,
        ].join("\n\n");

    try {
      this.logInfo(input.language, {
        zh: "阶段 1.5：复审章节标题",
        en: "Phase 1.5: reviewing chapter title",
      });
      const response = await this.chat(
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        { temperature: 0.35 },
      );
      const title = this.parseReviewedTitle(response.content, input.language);
      return title ? { title, usage: response.usage } : { usage: response.usage };
    } catch (error) {
      this.logWarn(input.language, {
        zh: "标题复审失败，保留 Writer 初稿标题：" + String(error),
        en: "Title review failed; keeping the Writer draft title: " + String(error),
      });
      return {};
    }
  }

  private hasExplicitTitleInstruction(externalContext?: string): boolean {
    if (!externalContext) return false;
    return /(?:章节标题|本章标题|CHAPTER_TITLE|chapter title|title)\s*(?:是|为|:|：|is)\s*\S+/i.test(externalContext);
  }

  private parseReviewedTitle(raw: string, language: "zh" | "en"): string | undefined {
    const firstLine = raw
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.replace(/^(?:章节标题|CHAPTER_TITLE|title)\s*[：:]\s*/i, "")
      .replace(/^["'“”]/, "")
      .replace(/["'“”]$/, "")
      .trim();
    if (!firstLine) return undefined;
    const maxLength = language === "en" ? 100 : 32;
    if (firstLine.length < 2 || firstLine.length > maxLength) return undefined;
    if (/^[#>*\x60]/.test(firstLine) || /^(?:第\d+章|chapter\s+\d+)$/i.test(firstLine)) return undefined;
    return firstLine;
  }

  async settleChapterState(input: SettleChapterStateInput): Promise<WriteChapterOutput> {
    const [
      currentState,
      ledger,
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
    ] = await Promise.all([
      // Phase 5 consolidation fallback: derive initial state when only seed on disk.
      readCurrentStateWithFallback(input.bookDir, "(文件尚未创建)"),
      this.readFileOrDefault(join(input.bookDir, "story/particle_ledger.md")),
      this.readFileOrDefault(join(input.bookDir, "story/pending_hooks.md")),
      this.readFileOrDefault(join(input.bookDir, "story/chapter_summaries.md")),
      this.readFileOrDefault(join(input.bookDir, "story/subplot_board.md")),
      this.readFileOrDefault(join(input.bookDir, "story/emotional_arcs.md")),
      readCharacterContext(input.bookDir, "(文件尚未创建)"),
      readVolumeMap(input.bookDir, "(文件尚未创建)"),
    ]);

    const { profile: genreProfile } = await readGenreProfile(this.ctx.projectRoot, input.book.genre);
    const parsedBookRules = await readBookRules(input.bookDir);
    const bookRules = parsedBookRules?.rules ?? null;
    const resolvedLanguage = input.book.language ?? genreProfile.language;
    const governedMemoryBlocks = input.contextPackage
      ? buildGovernedMemoryEvidenceBlocks(input.contextPackage, resolvedLanguage)
      : undefined;

    const settleResult = await this.settle({
      book: input.book,
      genreProfile,
      bookRules,
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      currentState,
      ledger: genreProfile.numericalSystem ? ledger : "",
      hooks,
      chapterSummaries,
      subplotBoard,
      emotionalArcs,
      characterMatrix,
      volumeOutline,
      selectedEvidenceBlock: governedMemoryBlocks
        ? this.joinGovernedEvidenceBlocks(governedMemoryBlocks)
        : undefined,
      chapterIntent: input.chapterIntent,
      contextPackage: input.contextPackage,
      ruleStack: input.ruleStack,
      validationFeedback: input.validationFeedback,
      originalHooks: hooks,
      originalSubplots: subplotBoard,
      originalEmotionalArcs: emotionalArcs,
      originalCharacterMatrix: characterMatrix,
    });
    const settlement = settleResult.settlement;
    const runtimeStateArtifacts = await this.buildRuntimeStateArtifactsIfPresent(
      input.bookDir,
      settlement.runtimeStateDelta,
      resolvedLanguage,
      input.chapterNumber,
      input.allowReapply,
    );

    return {
      chapterNumber: input.chapterNumber,
      title: input.title,
      content: input.content,
      wordCount: countChapterLength(
        input.content,
        resolvedLanguage === "en" ? "en_words" : "zh_chars",
      ),
      preWriteCheck: "",
      postSettlement: settlement.postSettlement,
      runtimeStateDelta: runtimeStateArtifacts?.resolvedDelta ?? settlement.runtimeStateDelta,
      runtimeStateSnapshot: runtimeStateArtifacts?.snapshot ?? settlement.runtimeStateSnapshot,
      updatedState: runtimeStateArtifacts?.currentStateMarkdown ?? settlement.updatedState,
      updatedLedger: settlement.updatedLedger,
      updatedHooks: runtimeStateArtifacts?.hooksMarkdown ?? settlement.updatedHooks,
      chapterSummary: settlement.runtimeStateDelta
        ? this.renderDeltaSummaryRow(settlement.runtimeStateDelta)
        : settlement.chapterSummary,
      updatedChapterSummaries: runtimeStateArtifacts?.chapterSummariesMarkdown,
      updatedSubplots: settlement.updatedSubplots,
      updatedEmotionalArcs: settlement.updatedEmotionalArcs,
      updatedCharacterMatrix: settlement.updatedCharacterMatrix,
      postWriteErrors: [],
      postWriteWarnings: [],
      tokenUsage: settleResult.usage,
    };
  }

  private async settle(params: {
    readonly book: BookConfig;
    readonly genreProfile: GenreProfile;
    readonly bookRules: BookRules | null;
    readonly chapterNumber: number;
    readonly title: string;
    readonly content: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly volumeOutline: string;
    readonly selectedEvidenceBlock?: string;
    readonly chapterIntent?: string;
    readonly contextPackage?: ContextPackage;
    readonly ruleStack?: RuleStack;
    readonly validationFeedback?: string;
    readonly originalHooks: string;
    readonly originalSubplots: string;
    readonly originalEmotionalArcs: string;
    readonly originalCharacterMatrix: string;
  }): Promise<{
    settlement: ReturnType<typeof parseSettlementOutput> & {
      runtimeStateDelta?: RuntimeStateDelta;
      runtimeStateSnapshot?: RuntimeStateSnapshot;
    };
    usage: TokenUsage;
  }> {
    // Phase 2a: Observer — extract all facts from the chapter
    const resolvedLang = params.book.language ?? params.genreProfile.language;
    const observerSystem = buildObserverSystemPrompt(params.book, params.genreProfile, resolvedLang);
    const observerUser = buildObserverUserPrompt(params.chapterNumber, params.title, params.content, resolvedLang);

    this.logInfo(resolvedLang, {
      zh: `阶段 2a：提取第${params.chapterNumber}章事实`,
      en: `Phase 2a: observing facts for chapter ${params.chapterNumber}`,
    });
    const observerResponse = await this.chat(
      [
        { role: "system", content: observerSystem },
        { role: "user", content: observerUser },
      ],
      { temperature: 0.5 },
    );
    const observations = observerResponse.content;

    // Phase 2b: Reflector — merge observations into truth files
    this.logInfo(resolvedLang, {
      zh: "阶段 2b：把观察结果回写到真相文件",
      en: "Phase 2b: reflecting observations into truth files",
    });
    const settlerSystem = buildSettlerSystemPrompt(
      params.book, params.genreProfile, params.bookRules, resolvedLang,
    );
    const governedControlBlock = params.chapterIntent && params.contextPackage && params.ruleStack
      ? this.buildSettlerGovernedControlBlock(
          params.chapterIntent,
          params.contextPackage,
          params.ruleStack,
          resolvedLang,
        )
      : undefined;

    const settlerUser = buildSettlerUserPrompt({
      chapterNumber: params.chapterNumber,
      title: params.title,
      content: params.content,
      currentState: this.capLegacyContext("current_state", params.currentState, LEGACY_WRITER_CONTEXT_BUDGET.currentState),
      ledger: this.capLegacyContext("particle_ledger", params.ledger, LEGACY_WRITER_CONTEXT_BUDGET.ledger),
      hooks: this.capLegacyContext("pending_hooks", params.hooks, LEGACY_WRITER_CONTEXT_BUDGET.hooks),
      chapterSummaries: this.capLegacyContext(
        "chapter_summaries",
        params.chapterSummaries,
        LEGACY_WRITER_CONTEXT_BUDGET.chapterSummaries,
      ),
      subplotBoard: this.capLegacyContext("subplot_board", params.subplotBoard, LEGACY_WRITER_CONTEXT_BUDGET.subplotBoard),
      emotionalArcs: this.capLegacyContext("emotional_arcs", params.emotionalArcs, LEGACY_WRITER_CONTEXT_BUDGET.emotionalArcs),
      characterMatrix: this.capLegacyContext(
        "character_matrix",
        params.characterMatrix,
        LEGACY_WRITER_CONTEXT_BUDGET.characterMatrix,
      ),
      volumeOutline: this.capLegacyContext("volume_outline", params.volumeOutline, LEGACY_WRITER_CONTEXT_BUDGET.volumeOutline),
      observations,
      selectedEvidenceBlock: params.selectedEvidenceBlock,
      governedControlBlock,
      validationFeedback: params.validationFeedback,
    });

    const response = await this.chat(
      [
        { role: "system", content: settlerSystem },
        { role: "user", content: settlerUser },
      ],
      { temperature: 0.3 },
    );

    let mergedSettlement: ReturnType<typeof parseSettlementOutput> & {
      runtimeStateDelta?: RuntimeStateDelta;
      runtimeStateSnapshot?: RuntimeStateSnapshot;
    };
    try {
      const deltaOutput = parseSettlerDeltaOutput(response.content);
      mergedSettlement = {
        postSettlement: deltaOutput.postSettlement,
        runtimeStateDelta: deltaOutput.runtimeStateDelta,
        updatedState: "",
        updatedLedger: "",
        updatedHooks: "",
        chapterSummary: "",
        updatedSubplots: "",
        updatedEmotionalArcs: "",
        updatedCharacterMatrix: "",
      };
    } catch {
      const settlement = parseSettlementOutput(response.content, params.genreProfile);
      mergedSettlement = governedControlBlock
        ? {
            ...settlement,
            updatedHooks: mergeTableMarkdownByKey(params.originalHooks, settlement.updatedHooks, [0]),
            updatedSubplots: settlement.updatedSubplots
              ? mergeTableMarkdownByKey(params.originalSubplots, settlement.updatedSubplots, [0])
              : settlement.updatedSubplots,
            updatedEmotionalArcs: settlement.updatedEmotionalArcs
              ? mergeTableMarkdownByKey(params.originalEmotionalArcs, settlement.updatedEmotionalArcs, [0, 1])
              : settlement.updatedEmotionalArcs,
            updatedCharacterMatrix: settlement.updatedCharacterMatrix
              ? mergeCharacterMatrixMarkdown(params.originalCharacterMatrix, settlement.updatedCharacterMatrix)
              : settlement.updatedCharacterMatrix,
          }
        : settlement;
    }

    return {
      settlement: mergedSettlement,
      usage: response.usage,
    };
  }

  async saveChapter(
    _bookDir: string,
    _output: WriteChapterOutput,
    _numericalSystem: boolean = true,
    _language: "zh" | "en" = "zh",
  ): Promise<void> {
    throw new Error(
      "WriterAgent.saveChapter() is no longer a persistence API. Finalize the chapter through PipelineRunner so ProseQualityGate, ChapterCommit, and projections run atomically.",
    );
  }

  private buildUserPrompt(params: {
    readonly chapterNumber: number;
    readonly storyBible: string;
    readonly currentState: string;
    readonly ledger: string;
    readonly hooks: string;
    readonly recentChapters: string;
    readonly lengthSpec: LengthSpec;
    readonly externalContext?: string;
    readonly chapterSummaries: string;
    readonly subplotBoard: string;
    readonly emotionalArcs: string;
    readonly characterMatrix: string;
    readonly dialogueFingerprints?: string;
    readonly relevantSummaries?: string;
    readonly parentCanon?: string;
    readonly language?: "zh" | "en";
  }): string {
    const currentState = this.capLegacyContext("current_state", params.currentState, LEGACY_WRITER_CONTEXT_BUDGET.currentState);
    const ledger = this.capLegacyContext("particle_ledger", params.ledger, LEGACY_WRITER_CONTEXT_BUDGET.ledger);
    const hooks = this.capLegacyContext("pending_hooks", params.hooks, LEGACY_WRITER_CONTEXT_BUDGET.hooks);
    const chapterSummaries = this.capLegacyContext(
      "chapter_summaries",
      params.chapterSummaries,
      LEGACY_WRITER_CONTEXT_BUDGET.chapterSummaries,
    );
    const subplotBoard = this.capLegacyContext("subplot_board", params.subplotBoard, LEGACY_WRITER_CONTEXT_BUDGET.subplotBoard);
    const emotionalArcs = this.capLegacyContext("emotional_arcs", params.emotionalArcs, LEGACY_WRITER_CONTEXT_BUDGET.emotionalArcs);
    const characterMatrix = this.capLegacyContext(
      "character_matrix",
      params.characterMatrix,
      LEGACY_WRITER_CONTEXT_BUDGET.characterMatrix,
    );
    const storyBible = this.capLegacyContext("story_bible", params.storyBible, LEGACY_WRITER_CONTEXT_BUDGET.storyBible);
    const parentCanon = params.parentCanon
      ? this.capLegacyContext("parent_canon", params.parentCanon, LEGACY_WRITER_CONTEXT_BUDGET.parentCanon)
      : undefined;
    const contextBlock = params.externalContext
      ? `\n## 外部指令\n以下是来自外部系统的创作指令，请在本章中融入：\n\n${params.externalContext}\n`
      : "";

    const ledgerBlock = ledger
      ? `\n## 资源账本\n${ledger}\n`
      : "";

    const summariesBlock = chapterSummaries !== "(文件尚未创建)"
      ? `\n## 章节摘要（全部历史章节压缩上下文）\n${chapterSummaries}\n`
      : "";

    const subplotBlock = subplotBoard !== "(文件尚未创建)"
      ? `\n## 支线进度板\n${subplotBoard}\n`
      : "";

    const emotionalBlock = emotionalArcs !== "(文件尚未创建)"
      ? `\n## 情感弧线\n${emotionalArcs}\n`
      : "";

    const matrixBlock = characterMatrix !== "(文件尚未创建)"
      ? `\n## 角色交互矩阵\n${characterMatrix}\n`
      : "";

    const fingerprintBlock = params.dialogueFingerprints
      ? `\n## 角色对话指纹\n${params.dialogueFingerprints}\n`
      : "";

    const relevantBlock = params.relevantSummaries
      ? `\n## 相关历史章节摘要\n${params.relevantSummaries}\n`
      : "";

    const canonBlock = parentCanon
      ? `\n## 正传正典参照（番外写作专用）
本书是番外作品。以下正典约束不可违反，角色不得引用超出其信息边界的信息。
${parentCanon}\n`
      : "";
    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.
${contextBlock}
## Current State
${currentState}
${ledgerBlock}
## Plot Threads
${hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
## Recent Chapters
${params.recentChapters || "(This is the first chapter, no previous text)"}

## Worldbuilding
${storyBible}

${lengthRequirementBlock}
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

    return `请续写第${params.chapterNumber}章。
${contextBlock}
## 当前状态卡
${currentState}
${ledgerBlock}
## 伏笔池
${hooks}
${summariesBlock}${subplotBlock}${emotionalBlock}${matrixBlock}${fingerprintBlock}${relevantBlock}${canonBlock}
## 最近章节
${params.recentChapters || "(这是第一章，无前文)"}

## 世界观设定
${storyBible}

${lengthRequirementBlock}
- 先输出写作自检表，再写正文
      - 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }

  private capLegacyContext(label: string, content: string, maxChars: number): string {
    return capContextBlock(content, { label, maxChars });
  }

  private buildGovernedUserPrompt(params: {
    readonly chapterNumber: number;
    readonly chapterMemo: ChapterMemo;
    readonly chapterIntentData?: ChapterIntent;
    readonly contextPackage: ContextPackage;
    readonly ruleStack: RuleStack;
    readonly externalContext?: string;
    readonly lengthSpec: LengthSpec;
    readonly language?: "zh" | "en";
    readonly varianceBrief?: string;
    readonly selectedEvidenceBlock?: string;
  }): string {
    const language = params.language ?? "zh";
    // The user's steering docs (author_intent = long-term direction, current_focus =
    // short-term focus) must land as a prominent, binding block near the top — not
    // buried among generic "evidence" entries where the model treats them as optional.
    const DIRECTION_SOURCES = new Set(["story/author_intent.md", "story/current_focus.md"]);
    const directionEntries = params.contextPackage.selectedContext.filter((entry) =>
      DIRECTION_SOURCES.has(entry.source),
    );
    const otherEntries = params.contextPackage.selectedContext.filter((entry) =>
      !DIRECTION_SOURCES.has(entry.source),
    );
    const contextSections = renderNarrativeSelectedContext(otherEntries, language);
    const userDirectionBlock = directionEntries.length > 0
      ? (language === "en"
          ? `## User direction (overrides model defaults — must follow)\n${renderNarrativeSelectedContext(directionEntries, language)}\n`
          : `## 用户方向（优先于模型默认，必须遵循）\n${renderNarrativeSelectedContext(directionEntries, language)}\n`)
      : "";

    const diagnosticLines = params.ruleStack.sections.diagnostic.length > 0
      ? params.ruleStack.sections.diagnostic.join(", ")
      : "none";

    const lengthRequirementBlock = this.buildLengthRequirementBlock(params.lengthSpec, params.language ?? "zh");
    const varianceBlock = params.varianceBrief
      ? `\n${params.varianceBrief}\n`
      : "";
    const selectedEvidenceBlock = params.selectedEvidenceBlock
      ? `\n${sanitizeNarrativeEvidenceBlock(params.selectedEvidenceBlock, language)}\n`
      : "";
    const chapterContextBlock = this.buildChapterContextBlock(params.externalContext, language);
    const briefNarrative = renderMemoAsNarrativeBlock(params.chapterMemo, params.chapterIntentData, language);

    if (params.language === "en") {
      return `Write chapter ${params.chapterNumber}.

${chapterContextBlock}

${userDirectionBlock}
${briefNarrative}

## Selected Context
${contextSections || "(none)"}
${selectedEvidenceBlock}

## Rule Stack
- Hard: ${params.ruleStack.sections.hard.join(", ") || "(none)"}
- Soft: ${params.ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic: ${diagnosticLines}

${varianceBlock}
${lengthRequirementBlock}
- Output PRE_WRITE_CHECK first, then the chapter
- Output only PRE_WRITE_CHECK, CHAPTER_TITLE, and CHAPTER_CONTENT blocks`;
    }

    return `请续写第${params.chapterNumber}章。

${chapterContextBlock}

${userDirectionBlock}
${briefNarrative}

## 已选上下文
${contextSections || "(无)"}
${selectedEvidenceBlock}

## 规则栈
- 硬护栏：${params.ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${params.ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${diagnosticLines}

${varianceBlock}
${lengthRequirementBlock}
- 先输出写作自检表，再写正文
- 只需输出 PRE_WRITE_CHECK、CHAPTER_TITLE、CHAPTER_CONTENT 三个区块`;
  }

  private buildChapterContextBlock(externalContext: string | undefined, language: "zh" | "en"): string {
    const trimmed = externalContext?.trim();
    if (!trimmed) return "";
    if (language === "en") {
      return `## Per-chapter user instruction (highest priority)
${trimmed}

Obey this direct instruction for the current chapter. If it specifies a chapter title, use that title exactly in CHAPTER_TITLE. Keep continuity, but do not replace this instruction with the outline fallback.`;
    }
    return `## 本章用户指令（最高优先级）
${trimmed}

这是用户对当前章节的直接指令。若其中指定章节标题，CHAPTER_TITLE 必须原样使用该标题。保持连续性，但不要用卷纲兜底替换这条指令。`;
  }

  private joinGovernedEvidenceBlocks(blocks: ReturnType<typeof buildGovernedMemoryEvidenceBlocks> | undefined): string | undefined {
    if (!blocks) {
      return undefined;
    }

    const joined = [
      blocks.titleHistoryBlock,
      blocks.moodTrailBlock,
      blocks.canonBlock,
      blocks.hookDebtBlock,
      blocks.hooksBlock,
      blocks.summariesBlock,
      blocks.volumeSummariesBlock,
    ]
      .filter((block): block is string => Boolean(block))
      .join("\n");

    return joined || undefined;
  }

  private buildSettlerGovernedControlBlock(
    chapterIntent: string,
    contextPackage: ContextPackage,
    ruleStack: RuleStack,
    language: "zh" | "en",
  ): string {
    const selectedContext = renderNarrativeSelectedContext(contextPackage.selectedContext, language)
      .replace(/^### /gm, "- ");
    const overrides = ruleStack.activeOverrides.length > 0
      ? ruleStack.activeOverrides
        .map((override) => `- ${override.from} -> ${override.to}: ${override.reason} (${override.target})`)
        .join("\n")
      : "- none";
    const narrativeIntent = buildNarrativeIntentBrief(chapterIntent, language);

    if (language === "en") {
      return `\n## Chapter Control Inputs
${narrativeIntent || "(none)"}

### Selected Context
${selectedContext || "- none"}

### Rule Stack
- Hard guardrails: ${ruleStack.sections.hard.join(", ") || "(none)"}
- Soft constraints: ${ruleStack.sections.soft.join(", ") || "(none)"}
- Diagnostic rules: ${ruleStack.sections.diagnostic.join(", ") || "(none)"}

### Active Overrides
${overrides}\n`;
    }

    return `\n## 本章控制输入
${narrativeIntent || "(无)"}

### 已选上下文
${selectedContext || "- none"}

### 规则栈
- 硬护栏：${ruleStack.sections.hard.join("、") || "(无)"}
- 软约束：${ruleStack.sections.soft.join("、") || "(无)"}
- 诊断规则：${ruleStack.sections.diagnostic.join("、") || "(无)"}

### 当前覆盖
${overrides}\n`;
  }

  /**
   * Soft-check that the LLM's PRE_WRITE_CHECK output references the three
   * non-negotiable memo sections: 当前任务, 不要做, 章尾必须发生的改变.
   *
   * This is NOT a hard gate — the memo was already parse-validated in the
   * planner, and the writer prompt already tells the LLM to align to memo.
   * We only warn when the LLM skipped a section, so the chapter still ships.
   */
  private verifyPreWriteCheckAlignsWithMemo(
    preWriteCheck: string,
    chapterNumber: number,
    language: "zh" | "en",
  ): void {
    if (!preWriteCheck || preWriteCheck.trim().length === 0) {
      this.logWarn(language, {
        zh: `第${chapterNumber}章 PRE_WRITE_CHECK 为空，无法对齐 chapter_memo`,
        en: `Chapter ${chapterNumber} PRE_WRITE_CHECK is empty; cannot verify memo alignment`,
      });
      return;
    }

    const required = language === "en"
      ? [
          { needle: "Current task", label: "Current task" },
          { needle: "Do not", label: "Do not" },
          { needle: "end-of-chapter", label: "Required end-of-chapter change" },
        ]
      : [
          { needle: "当前任务", label: "当前任务" },
          { needle: "不要做", label: "不要做" },
          { needle: "章尾", label: "章尾必须发生的改变" },
        ];
    const missing = required.filter((r) => !preWriteCheck.includes(r.needle)).map((r) => r.label);

    if (missing.length > 0) {
      this.logWarn(language, {
        zh: `第${chapterNumber}章 PRE_WRITE_CHECK 缺少 memo 章节检查：${missing.join("、")}`,
        en: `Chapter ${chapterNumber} PRE_WRITE_CHECK missing memo sections: ${missing.join(", ")}`,
      });
    }
  }

  private buildLengthRequirementBlock(lengthSpec: LengthSpec, language: "zh" | "en"): string {
    if (language === "en") {
      return `Requirements:
- Target length: ${lengthSpec.target} words
- Acceptable range: ${lengthSpec.softMin}-${lengthSpec.softMax} words`;
    }

    return `要求：
- 目标字数：${lengthSpec.target}字
- 允许区间：${lengthSpec.softMin}-${lengthSpec.softMax}字`;
  }

  private async loadRecentChapters(
    bookDir: string,
    currentChapter: number,
    count = 1,
  ): Promise<string> {
    const chaptersDir = join(bookDir, "chapters");
    try {
      const files = await readdir(chaptersDir);
      const mdFiles = files
        .filter((f) => f.endsWith(".md") && !f.startsWith("index"))
        .sort()
        .slice(-count);

      if (mdFiles.length === 0) return "";

      const contents = await Promise.all(
        mdFiles.map(async (f) => {
          const content = await readFile(join(chaptersDir, f), "utf-8");
          return content;
        }),
      );

      return contents.join("\n\n---\n\n");
    } catch {
      return "";
    }
  }

  private async readFileOrDefault(path: string): Promise<string> {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return "(文件尚未创建)";
    }
  }

  /** Save new truth files (summaries, subplots, emotional arcs, character matrix). */
  async saveNewTruthFiles(
    _bookDir: string,
    _output: WriteChapterOutput,
    _language: "zh" | "en" = "zh",
  ): Promise<void> {
    throw new Error(
      "WriterAgent.saveNewTruthFiles() is disabled. Truth files are read-only projections of accepted ChapterCommit records.",
    );
  }

  private renderDeltaSummaryRow(delta: RuntimeStateDelta): string {
    if (!delta.chapterSummary) return "";
    const summary = delta.chapterSummary;
    const row = [
      summary.chapter,
      summary.title,
      summary.characters,
      summary.events,
      summary.stateChanges,
      summary.hookActivity,
      summary.mood,
      summary.chapterType,
    ].map((value) => String(value).replace(/\|/g, "\\|").trim()).join(" | ");

    return `| ${row} |`;
  }

  private normalizeRuntimeStateDeltaChapter(
    delta: RuntimeStateDelta,
    authoritativeChapterNumber: number,
  ): RuntimeStateDelta {
    const hookOps = delta.hookOps ?? {
      upsert: [],
      mention: [],
      resolve: [],
      defer: [],
    };
    let changed = delta.chapter !== authoritativeChapterNumber;
    const normalizedUpserts = hookOps.upsert.map((hook) => {
      const startChapter = Math.min(hook.startChapter, authoritativeChapterNumber);
      const lastAdvancedChapter = Math.min(hook.lastAdvancedChapter, authoritativeChapterNumber);
      if (startChapter !== hook.startChapter || lastAdvancedChapter !== hook.lastAdvancedChapter) {
        changed = true;
      }
      if (startChapter === hook.startChapter && lastAdvancedChapter === hook.lastAdvancedChapter) {
        return hook;
      }
      return {
        ...hook,
        startChapter,
        lastAdvancedChapter,
      };
    });

    if (delta.chapterSummary?.chapter !== undefined && delta.chapterSummary.chapter !== authoritativeChapterNumber) {
      changed = true;
    }
    if (!changed) {
      return delta;
    }

    return {
      ...delta,
      chapter: authoritativeChapterNumber,
      hookOps: {
        ...hookOps,
        upsert: normalizedUpserts,
      },
      chapterSummary: delta.chapterSummary
        ? {
            ...delta.chapterSummary,
            chapter: authoritativeChapterNumber,
          }
        : undefined,
    };
  }

  private async buildRuntimeStateArtifactsIfPresent(
    bookDir: string,
    delta: RuntimeStateDelta | undefined,
    language: "zh" | "en",
    authoritativeChapterNumber?: number,
    allowReapply?: boolean,
  ): Promise<RuntimeStateArtifacts | null> {
    if (!delta) return null;
    const safeDelta = authoritativeChapterNumber === undefined
      ? delta
      : this.normalizeRuntimeStateDeltaChapter(delta, authoritativeChapterNumber);
    return buildRuntimeStateArtifacts({
      bookDir,
      delta: safeDelta,
      language,
      allowReapply,
    });
  }

  private buildStyleFingerprint(styleProfileRaw: string): string | undefined {
    if (!styleProfileRaw || styleProfileRaw === "(文件尚未创建)") return undefined;
    try {
      const profile = JSON.parse(styleProfileRaw);
      const lines: string[] = [];
      if (profile.avgSentenceLength) lines.push(`- 平均句长：${profile.avgSentenceLength}字`);
      if (profile.sentenceLengthStdDev) lines.push(`- 句长标准差：${profile.sentenceLengthStdDev}`);
      if (profile.avgParagraphLength) lines.push(`- 平均段落长度：${profile.avgParagraphLength}字`);
      if (profile.paragraphLengthRange) lines.push(`- 段落长度范围：${profile.paragraphLengthRange.min}-${profile.paragraphLengthRange.max}字`);
      if (profile.vocabularyDiversity) lines.push(`- 词汇多样性(TTR)：${profile.vocabularyDiversity}`);
      if (profile.topPatterns?.length > 0) lines.push(`- 高频句式：${profile.topPatterns.join("、")}`);
      if (profile.rhetoricalFeatures?.length > 0) lines.push(`- 修辞特征：${profile.rhetoricalFeatures.join("、")}`);
      return lines.length > 0 ? lines.join("\n") : undefined;
    } catch {
      return undefined;
    }
  }


  /**
   * Extract dialogue fingerprints from recent chapters.
   * For each character with multiple dialogue lines, compute speaking style markers.
   */
  private extractDialogueFingerprints(recentChapters: string, _storyBible: string): string {
    if (!recentChapters) return "";

    // Match dialogue patterns:
    // Chinese: "speaker说道：" or dialogue in ""「」
    // English: "dialogue," speaker said. or "dialogue."
    const dialogueRegex = /(?:(.{1,6})(?:说道|道|喝道|冷声道|笑道|怒道|低声道|大声道|喝骂道|冷笑道|沉声道|喊道|叫道|问道|答道)\s*[：:]\s*["""「]([^"""」]+)["""」])|["""「]([^"""」]{2,})["""」]|"([^"]{2,})"/g;

    const characterDialogues = new Map<string, string[]>();
    let match: RegExpExecArray | null;

    while ((match = dialogueRegex.exec(recentChapters)) !== null) {
      const speaker = match[1]?.trim();
      const line = match[2] ?? match[3] ?? "";
      if (speaker && line.length > 1) {
        const existing = characterDialogues.get(speaker) ?? [];
        characterDialogues.set(speaker, [...existing, line]);
      }
    }

    // Only include characters with >=2 dialogue lines
    const fingerprints: string[] = [];
    for (const [character, lines] of characterDialogues) {
      if (lines.length < 2) continue;

      const avgLen = Math.round(lines.reduce((sum, l) => sum + l.length, 0) / lines.length);
      const isShort = avgLen < 15;

      // Find frequent words/phrases (2+ occurrences)
      const wordCounts = new Map<string, number>();
      for (const line of lines) {
        // Extract 2-3 char segments as "words"
        for (let i = 0; i < line.length - 1; i++) {
          const bigram = line.slice(i, i + 2);
          wordCounts.set(bigram, (wordCounts.get(bigram) ?? 0) + 1);
        }
      }
      const frequentWords = [...wordCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([w]) => `「${w}」`);

      // Detect style markers
      const markers: string[] = [];
      if (isShort) markers.push("短句为主");
      else markers.push("长句为主");

      const questionCount = lines.filter((l) => l.includes("？") || l.includes("?")).length;
      if (questionCount > lines.length * 0.3) markers.push("反问多");

      if (frequentWords.length > 0) markers.push(`常用${frequentWords.join("")}`);

      fingerprints.push(`${character}：${markers.join("，")}`);
    }

    return fingerprints.length > 0 ? fingerprints.join("；") : "";
  }

  /**
   * Find relevant chapter summaries based on volume outline context.
   * Extracts character names and hook IDs from the current volume's outline,
   * then searches chapter summaries for matching entries.
   */
  private findRelevantSummaries(
    chapterSummaries: string,
    volumeOutline: string,
    chapterNumber: number,
  ): string {
    if (!chapterSummaries || chapterSummaries === "(文件尚未创建)") return "";
    if (!volumeOutline || volumeOutline === "(文件尚未创建)") return "";

    // Extract character names from volume outline (Chinese name patterns)
    const nameRegex = /[\u4e00-\u9fff]{2,4}(?=[，、。：]|$)/g;
    const outlineNames = new Set<string>();
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = nameRegex.exec(volumeOutline)) !== null) {
      outlineNames.add(nameMatch[0]);
    }

    // Extract hook IDs from volume outline
    const hookRegex = /H\d{2,}/g;
    const hookIds = new Set<string>();
    let hookMatch: RegExpExecArray | null;
    while ((hookMatch = hookRegex.exec(volumeOutline)) !== null) {
      hookIds.add(hookMatch[0]);
    }

    if (outlineNames.size === 0 && hookIds.size === 0) return "";

    // Search chapter summaries for matching rows
    const rows = chapterSummaries.split("\n").filter((line) =>
      line.startsWith("|") && !line.startsWith("| 章节") && !line.startsWith("|--") && !line.startsWith("| -"),
    );

    const matchedRows = rows.filter((row) => {
      for (const name of outlineNames) {
        if (row.includes(name)) return true;
      }
      for (const hookId of hookIds) {
        if (row.includes(hookId)) return true;
      }
      return false;
    });

    // Skip only the last chapter (its full text is already in context via loadRecentChapters)
    const filteredRows = matchedRows.filter((row) => {
      const chNumMatch = row.match(/\|\s*(\d+)\s*\|/);
      if (!chNumMatch) return true;
      const num = parseInt(chNumMatch[1]!, 10);
      return num < chapterNumber - 1;
    });

    return filteredRows.length > 0 ? filteredRows.join("\n") : "";
  }

}
