# Narrative Forecast Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render #342 narrative forecasts as an inline comparison board in Studio Chat and let authors save one non-canonical branch plan.

**Architecture:** Add one forecast-specific preview component that parses existing structured tool details. Wire its select/recheck callbacks through `ChatPage` to the existing Agent tools, preserving transcript history and the current non-canonical storage boundary.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, pi-agent tool details.

---

### Task 1: Parse forecast tool details

**Files:**
- Create: `packages/studio/src/components/chat/NarrativeForecastPreview.tsx`
- Create: `packages/studio/src/components/chat/__tests__/NarrativeForecastPreview.test.ts`

1. Write failing tests for valid create/get/select details, malformed details, and stale state.
2. Run `pnpm --filter @inoks-story-webnovel/studio test --run src/components/chat/__tests__/NarrativeForecastPreview.test.ts` and verify RED.
3. Implement narrow runtime guards and exported view types; do not duplicate the core schema package in Studio.
4. Re-run the test and verify GREEN.

### Task 2: Render the inline comparison board

**Files:**
- Modify: `packages/studio/src/components/chat/NarrativeForecastPreview.tsx`
- Modify: `packages/studio/src/components/chat/__tests__/NarrativeForecastPreview.test.ts`
- Modify: `packages/studio/src/components/chat/ToolExecutionSteps.tsx`

1. Add failing rendering tests for divergence metadata, branch scores, beats, risk labels, non-canonical copy, and stale-disabled controls.
2. Verify RED with the scoped Studio test command.
3. Implement the responsive branch rail and selected-result preview.
4. Register the three forecast tools as pipeline cards and render the preview before the generic result details.
5. Re-run scoped tests and verify GREEN.

### Task 3: Wire branch selection and recheck

**Files:**
- Modify: `packages/studio/src/components/chat/ToolExecutionSteps.tsx`
- Modify: `packages/studio/src/pages/ChatPage.tsx`
- Modify: `packages/studio/src/components/chat/__tests__/ToolExecutionSteps.test.ts`

1. Add failing tests proving the preview emits exact forecast/branch IDs and blocks stale selection.
2. Verify RED.
3. Add `onSelectNarrativeBranch` and `onRecheckNarrativeForecast` callbacks.
4. In `ChatPage`, send explicit button-origin instructions that call the existing forecast tools in the active book session.
5. Verify GREEN and run `pnpm --filter @inoks-story-webnovel/studio typecheck`.

### Task 4: Document the capability

**Files:**
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `README.ja.md`
- Modify: `skills/SKILL.md`

1. Add concise Chat and CLI examples, explicitly distinguishing forecast from Play.
2. Document that selection only writes `selected-branch-plan.md`.
3. Run README link checks if available and `git diff --check`.

### Task 5: End-to-end verification

**Files:**
- No production files.

1. Run scoped Studio and forecast core tests.
2. Run Studio typecheck and build.
3. Start latest Studio from this worktree.
4. Through the UI, create a three-branch forecast, expand details, save one branch, refresh the session, and verify the cards restore.
5. Hash canonical story inputs before and after selection and verify they are unchanged.
6. Commit the implementation in reviewable feature/docs commits; do not push without explicit user instruction.

