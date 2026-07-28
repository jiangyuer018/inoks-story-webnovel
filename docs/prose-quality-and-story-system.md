# Prose Quality Gate and Story System

Inoks Story Webnovel long-form fiction uses one finalization chain:

```text
plan
→ retrieve protected/recent/historical/compressed memory
→ generate an in-memory draft
→ length governance
→ deterministic ProseQualityGate
→ continuity and plot review
→ final body selection
→ fact extraction and disambiguation
→ ChapterCommit validation
→ transactional chapter + Commit persistence
→ event/state/summary/hook/memory/retrieval projections
```

No official chapter or truth projection is written before the quality and
continuity gates finish. Only an accepted `ChapterCommit` can advance canon.
Writer and Reviser agents return text; their legacy direct-persistence methods
reject calls.

## Prose quality

The Chinese scanner is deterministic TypeScript. It does not call an external
AI detector and does not optimize for a detector score. Narrow, high-confidence
patterns can block; density and style tendencies remain advisory. English keeps
the existing advisory AI-tells profile.

Automatic naturalization runs only for a blocking issue, a `heavy` result, or a
score below the configured minimum. Clean prose is idempotent and does not call
the revision model. Each candidate is checked for:

- continuity regressions;
- net prose-quality improvement;
- empty or unchanged output;
- token-aware deletion ratio (15% light, 25% medium, 35% heavy);
- an overall automatic modification-ratio ceiling.

Strict failures keep the draft out of `chapters/` and save it under
`.inoks-story-webnovel/rejected-drafts/chapter-NNNN/`. Every run writes
`quality/prose/chapter-NNNN.json`.

Optional whitelist files are merged:

```text
<project>/.inoks-story-webnovel/prose-quality-whitelist.txt
<book>/story/prose_quality_whitelist.txt
```

Each UTF-8 line is a phrase, `#` begins a comment, and blank lines are ignored.
Neither file is required.

The Studio project settings explain the modes:

- `strict`: repair when configured, then block official persistence if a
  blocking issue remains;
- `balanced`: repair when configured and persist with a visible warning;
- `report-only`: scan and write the report without calling the naturalizer.

## Canonical Story System

The canonical source is:

```text
accepted ChapterCommits + normalized events
```

Everything below is a rebuildable projection:

- `story/current_state.md`
- `story/pending_hooks.md`
- `story/chapter_summaries.md`
- `story/memory.db`
- entity and relationship indexes
- chapter/sequence/arc/volume/book summaries
- retrieval indexes and Studio state views

Canonical files live under:

```text
<book>/.inoks-story-webnovel/story-system/
├── HEAD
├── commits/
├── events/
├── sources/
├── transactions/
├── projection-log.jsonl
├── rejected/
└── migrations/
```

Commit and event IDs derive from canonical hashes, so retrying an identical
chapter is idempotent. Source snapshots are immutable. An old chapter edit
creates an amendment Commit in the same hash chain; it does not silently
overwrite history.

The transaction manifest records `prepared`, `chapter_moved`, `commit_moved`,
`committed`, `projecting`, and `complete`. Staged files are hash-checked, moved
atomically, and HEAD is updated atomically. Preflight recovers an incomplete
transaction before the next chapter. A projection failure never deletes the
accepted Commit; it leaves the book in projection-pending state and blocks the
next strict write until repair succeeds.

MemoryDB stores temporal facts with source Commit/event provenance. A state
change closes the old validity interval and inserts a new fact rather than
deleting history. Retrieval always prioritizes current facts, active hooks,
character knowledge, and hard rules over summaries, BM25 history, or optional
embeddings. If SQLite FTS or an embedding provider is unavailable, retrieval
falls back locally.

## Configuration

Missing fields receive these defaults, so older project files remain valid:

```json
{
  "writing": {
    "proseQuality": {
      "enabled": true,
      "enforcement": "strict",
      "autoRepair": true,
      "maxRepairIterations": 2,
      "minimumScore": 80,
      "failOnUnresolvedBlocking": true,
      "saveRejectedDraft": true,
      "maxAutomaticModificationRatio": 0.45,
      "applyTo": ["chapter", "short-fiction", "continuation", "revision"]
    },
    "longFormMemory": {
      "enabled": true,
      "authority": "chapter-commit",
      "strictPreflight": true,
      "blockOnProjectionFailure": true,
      "generateSequenceSummaries": true,
      "sequenceSize": 8,
      "generateArcSummaries": true,
      "retrieval": {
        "recentChapterCount": 5,
        "maxHistoricalEvents": 20,
        "maxRelatedSummaries": 10,
        "useFts": true,
        "useEmbeddings": false,
        "protectedTokenRatio": 0.45,
        "retrievedTokenRatio": 0.30,
        "compressedTokenRatio": 0.25
      }
    }
  }
}
```

The gate is always invoked by fiction-body finalization; `enabled` and
`applyTo` are interpreted inside the gate rather than by scattered call sites.

## Verification, recovery, and migration

```bash
inoks-story story status <book-id>
inoks-story story verify <book-id>
inoks-story story repair <book-id>
inoks-story story replay <book-id> --from 1 --reset
inoks-story story rebuild-index <book-id>
inoks-story story migrate <book-id>          # dry-run and difference report
inoks-story story migrate <book-id> --apply  # backup, then enable authority
```

Migration is dry-run by default and does not overwrite an existing book.
`--apply` creates a backup before canonical history is installed. Migration
progress is checkpointed through analysis, backup, commit installation, replay,
and completion; rerunning the same deterministic migration resumes after an
interruption. The final report includes before/after projection hashes and does
not switch authority during a dry run. Studio shows HEAD, Commit count,
preflight state, projection failures, and a projection repair action on the
book page.

Preflight also compares the current Markdown projections with the payloads
derived from accepted commits. A direct edit is reported as `projection-drift`
and is repaired by replay. Legacy snapshot restore, chapter deletion, and
history rollback are disabled after HEAD exists; old chapter changes must use
an amendment.

## Manual verification

1. Create or open a Chinese long-form book and write one clean chapter. Confirm
   `quality/prose/chapter-0001.json`, the chapter file, Commit, event file, HEAD,
   and projections exist.
2. Use a deterministic blocking ending in a test chapter under `strict`. Confirm
   only `.inoks-story-webnovel/rejected-drafts/chapter-NNNN/` and the quality report are
   written; HEAD, truth files, and MemoryDB do not advance.
3. Temporarily make one projection path unwritable, commit a chapter, and
   confirm the Commit remains while preflight blocks the next write. Restore
   permissions and run `inoks-story story repair`.
4. Run `inoks-story story replay <book> --from 1 --reset`, then compare current state,
   hooks, summaries, MemoryDB facts, and indexes with their pre-replay values.
5. Edit an already committed chapter through Studio and confirm a
   `chapter-NNNN.amendment.*.commit.json` record is appended.

## Current boundaries

Deterministic entity/event IDs, temporal facts, epistemic status, projection
replay, and amendment audit are implemented. Fact extraction still depends on
the existing ChapterAnalyzer's structured output and conservative heuristics;
deep alias graphs and semantic pronoun resolution are not a substitute for
human review in ambiguous passages. Embeddings remain optional and are never
required for correctness. Legacy migration produces a difference report and
backup, but large migrations should still be run with a project-level backup
and reviewed before authority is switched.
