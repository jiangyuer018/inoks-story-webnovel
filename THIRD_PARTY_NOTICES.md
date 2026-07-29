# Third-Party Notices

Inoks Story Webnovel is licensed under the GNU Affero General Public License v3.0. It is an
independent project that includes AGPL-licensed portions originating from the InkOS source
distribution. The following notices preserve required source attribution and cover third-party
material or design references used by the prose-quality and long-form Story System implementation.

## Upstream AGPL source attribution

- Project: `Narcooo/inkos`
- Source: https://github.com/Narcooo/inkos
- License: GNU Affero General Public License v3.0

The source-derived portions remain available under AGPL-3.0-only. This repository has its own
release history, package identifiers, configuration namespace, documentation, and product identity.

## oh-story-claudecode `story-deslop`

- Project: `worldwonderer/oh-story-claudecode`
- Source: https://github.com/worldwonderer/oh-story-claudecode
- License: MIT
- Copyright: Copyright (c) 2025-2026 oh-story-claudecode
- Adapted Inoks Story Webnovel files:
  - `packages/core/src/prose-quality/rules-zh.ts`
  - `packages/core/src/prose-quality/scanner.ts`

The rule expressions and implementation were narrowed, reorganized, and ported
to native TypeScript for Inoks Story Webnovel. Inoks Story Webnovel does not load or execute the source
repository at runtime.

MIT License

Copyright (c) 2025-2026 oh-story-claudecode

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## webnovel-writer

- Project: `lingfengQAQ/webnovel-writer`
- Source: https://github.com/lingfengQAQ/webnovel-writer
- License: GNU General Public License v3.0

Inoks Story Webnovel studied its chapter-commit, event-log, projection, recovery, and layered
memory concepts. The Story System in `packages/core/src/story-system/` is an
independent native TypeScript implementation built on Inoks Story Webnovel's existing state
manager and SQLite memory database. No Python module is loaded, invoked, or
shipped as a runtime dependency, and no Python source file was translated
line-by-line.

## Narrative research references

The Story Spec, causal/temporal audits, emotion trajectory, missing-logic checks, reader
contracts, and ablation protocol apply general ideas described in publicly available narrative
planning research. No paper implementation, dataset, model weights, or source code is bundled.
All schemas, thresholds, prompts, recovery behavior, and TypeScript code were independently
implemented for this repository.

## Studio UI boundary

The V2 controls are integrated into the existing Inoks Story Webnovel Studio shell and reuse its
repository-owned Sidebar, logo, theme tokens, typography, and UI components. No UI code or branded
asset was copied from an external prototype.
