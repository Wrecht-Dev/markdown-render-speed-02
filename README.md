# markdown-render-speed-02

A fast, dependency-free drop-in replacement for
[marked](https://github.com/markedjs/marked) 18.1.3, written from scratch
for the make.fun `markdown-render-speed-02` bounty.

## API

`parse.js` is a dependency-free ES module:

```js
import { parse } from './parse.js';
parse('# Hello\n\nSome *emphasis*.');
// '<h1>Hello</h1>\n<p>Some <em>emphasis</em>.</p>\n'
```

`parse(markdown)` returns exactly the HTML that `marked.parse(markdown)`
returns with the default options (`gfm: true, breaks: false,
pedantic: false, async: false`).

`main.ts` is the competition driver: it reads `/input/cases.json`
(or `$MAKEFUN_INPUT_DIR/cases.json`), renders each case alone with `parse`,
and writes `/output/html.json` (or `$MAKEFUN_OUTPUT_DIR/html.json`).

## Design

- **Block parser**: a line-array + container-stack algorithm in the style
  of the CommonMark reference (block quotes, list items, lazy paragraph
  continuation, leaf finalisation), with column-aware tab handling.
- **Inline parser**: a single left-to-right scan into a linked list of
  nodes (text, delimiter runs, brackets, code spans, autolinks, raw HTML),
  then emphasis resolution per CommonMark Appendix A phase 2, then render.
- **Link reference definitions** are collected during block parsing
  (whole-document scope, first definition wins) and consumed at block
  level before a paragraph starts.
- No dependencies, no WASM, no native code. Node 22.

## Testing

The kit's practice set (680 CommonMark/GFM spec examples + 40 generated
READMEs, 720 cases) is the oracle:

```
# from the kit directory
node program/scorer/main.ts   # via the work/run.sh harness in the
                              # development checkout
```

Current status (practice set): 643/720 byte-identical
(40 spec examples + 37 generated docs still differ — see the development
notes in the repository for the known open divergences).

## License

MIT.
