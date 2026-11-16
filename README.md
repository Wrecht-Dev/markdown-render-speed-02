# markdown-render-speed-02 — a fast drop-in replacement for marked

A dependency-free JavaScript Markdown renderer that produces, for every
input, exactly the HTML that `marked` 18.1.3's `marked.parse` produces with
default options (GFM on, `breaks: false`, `pedantic: false`) — including the
places where marked departs from the CommonMark/GFM specifications, because
marked's output is the target.

Entry for the make.fun bounty
[markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02).

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Wrecht-Dev/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Wrecht-Dev/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

## Files

- `parse.js` — the renderer. An ES module exporting `parse(markdown)`,
  which returns the rendered HTML string. No imports, no dependencies,
  no Node built-ins: it renders anywhere JavaScript runs.
- `main.ts` — the harness driver. The grader runs it as
  `node /bot/main.ts` (Node 22, native TypeScript type-stripping, so the
  file uses erasable syntax only). It reads every case from
  `/input/cases.json` (a JSON array of `{"id", "markdown"}` objects),
  renders each one with `parse`, and writes `/output/html.json` (a JSON
  array of the HTML strings, in the cases' order).

## How it works

`parse.js` is built in two classic phases, tuned to mirror marked's
observable behavior rather than the letter of the spec:

- **Block phase.** The source is split into lines and consumed with an
  explicit container stack (document / blockquote / list / list item) and
  at most one open leaf block (paragraph, fenced or indented code, HTML
  block, or table). Container matching is column-based: indentation is
  measured in tab-aware columns, and each container type reproduces
  marked's quirks — e.g. a fenced block directly inside a list item keeps
  consuming lines that leave the item once it is under way, HTML blocks of
  the "terminator" kinds keep their trailing newline unless a spaces-only
  line follows, list looseness is tracked from raw blank lines, and
  tables accept whitespace-only lines containing a tab as empty rows.
  Link reference definitions are extracted from paragraphs before setext
  or table reinterpretation, with marked's exact label normalization
  (whitespace collapsing, case folding, ß → ss, ς → σ) and its
  raw-label comparison on both the definition and the use side.
- **Inline phase.** Each text run is scanned into nodes (text, code spans,
  raw HTML, autolinks, link/image bracket openers, delimiter runs).
  Links are resolved with a bracket stack: when a link or image forms,
  bare extended autolinks (www/http/email) among its children revert to
  plain text while `<...>` autolinks stay links, exactly as marked
  behaves. Emphasis is resolved with a delimiter-stack pass per node
  list, with marked's variations on the rule of three, its reluctance to
  span an intraword strong pair with a single-character pair, and its
  handling of partially consumed delimiter runs. GFM extras are covered:
  tables with per-cell alignment, task list checkboxes, strikethrough
  (including single `~`), and extended autolinks with marked's trimming
  rules and its case-sensitive `www.` versus case-insensitive scheme.

Rendering is a single pass over the block tree with string concatenation
and precompiled regular expressions; nothing is recompiled per call and
there are fast paths for the common block and inline shapes.

## Running it

```sh
node -e "import('./parse.js').then(m => console.log(m.parse('# hi')))"
```

or through the driver contract described above (`main.ts` with
`/input/cases.json` → `/output/html.json`).
