# Human Scene Realization Engine

The long-form Writer no longer receives only a chapter outline and permission to fill an
entire chapter. When concrete Story Spec enforcement is enabled (the default project
configuration), the pre-write chain is:

```text
approved Chapter Spec
→ RealizedScenePlan
→ CharacterAgenda
→ InformationUnit carrier selection
→ InteractionTurn stimulus/reaction chain
→ NarrationPermission
→ per-scene Writer
→ per-scene SemanticSceneReviewer
→ bounded HumanSceneRepair
→ scene assembly
```

## Scene contract

Every scene has a concrete location, time, POV, cast, immediate goal, opposing goal, stakes,
entry state, exit state, turning point, decision point, irreversible change, functions, and
Beat IDs. Placeholder phrases are deterministic blocking errors and return control to planning.

Each major character receives an agenda containing current desire and fear, hidden information,
what cannot be said directly, beliefs about other characters, tactic, leverage, success/retreat
conditions, and a three-part knowledge boundary. The Writer is instructed not to let a character
state facts outside that boundary.

## Information and narration

Information units choose from dialogue, action, object, reaction, observation, thought,
environment, and narration. Narration is allowed only with a typed reason and a maximum character
budget. It cannot explain an action that already expresses motive or emotion, summarize obvious
subtext, announce who is lying, replace an unfinished interaction, or preview author knowledge.

Interaction turns encode:

```text
previous stimulus
→ perception and interpretation
→ strategy change
→ outward action/dialogue
→ effect on the other character
```

This is why a list of independent lines cannot satisfy the scene contract even when every planned
fact appears somewhere in the prose.

## Semantic review and repair

The deterministic Human Feel audit remains a cheap pre-screen. The authoritative scene gate is
the structured semantic review: narration necessity, dialogue goal and response coupling, action
intent/effect, thought-to-decision changes, functional environment, information fulfillment,
interaction fulfillment, entry/exit state, and unintended facts.

Only `pass` advances. `repair` invokes the bounded scene repair mode and is reviewed again;
`repair` itself is never treated as a passing Commit gate. Repair may change the carrier or local
interaction but cannot change canon facts, knowledge boundaries, planned results, or scene states.

Reports are stored under the book quality/runtime directories and their final booleans are copied
into mandatory `ChapterCommit.validation` fields. Legacy accepted commits are normalized only when
read; newly produced commits cannot omit these gates.

## Human approval boundary

In `manual` or `review-first` production, successful automatic review creates a pending draft
outside canonical `chapters/` and enters `awaiting-human-approval`. Editing invalidates the approval
hash and moves it to `human-editing`; the complete quality, continuity, semantic, convergence,
similarity, fact-candidate, and Commit-draft checks run again before it may be approved. Only a
matching approved content hash can be upgraded to an accepted Commit and transactionally persisted.
