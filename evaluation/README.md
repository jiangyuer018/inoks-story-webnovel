# Human Scene Blind Evaluation

This directory is the fixed, auditable A/B/C scene evaluation kit for the V3 writing engine.
It does not contain fabricated ratings and does not treat automatic scores as human evidence.

## Variants

- `ai-baseline/`: the pre-realization full-chapter Writer path.
- `prompt-only/`: the same baseline with prose/human-feel instructions only.
- `realization-engine/`: concrete scene plan, character agendas, information carriers,
  interaction turns, narration permissions, semantic review, and repair.
- `human-reference/`: optional lawful human reference written for the same input; never
  exposed to any generation variant.

The fixed source set is [`scene-inputs/cases.json`](scene-inputs/cases.json). It contains
30 genres and conflict types. Every variant must use the same model and seed for a given
`sampleId`; its prompt version is recorded separately.

## Procedure

1. Generate all three outputs for every case and place only their files in the three
   variant directories.
2. Hash every output with SHA-256 and create artifact records containing `artifactId`,
   `sampleId`, internal `variant`, opaque `blindCode`, path, model, prompt version, and seed.
3. Give reviewers only shuffled `blindCode` packets. Do not expose variant or directory.
4. Reviewers score the ten required dimensions from 1–5: human likeness, character agency,
   interest-driven dialogue, mutual influence, natural information delivery, narration
   necessity, action consequence, psychology-to-strategy change, functional environment,
   and continuation intent.
5. Aggregate after all 90 artifacts have at least one human rating:

```bash
inoks-story eval scene-blind \
  --input evaluation/blind-review/review-input.json \
  --output evaluation/reports/scene-blind-report.json
```

The report remains `incomplete` unless it sees at least 30 unique cases, all three variants,
ratings for every artifact, unique blind codes per case, and no model/seed drift. Only a
complete human-rated report may state `realization-engine-preferred`; that statement is still
an experiment result, not proof of authorship or universal quality.
