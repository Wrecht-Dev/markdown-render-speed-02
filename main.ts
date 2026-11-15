// Driver: reads every case from $MAKEFUN_INPUT_DIR/cases.json (or
// /input/cases.json), renders each one alone with parse() from parse.js,
// and writes $MAKEFUN_OUTPUT_DIR/html.json (or /output/html.json): a JSON
// array of the HTML strings, one per case, in the cases' order.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8'));
const html = [];
for (let i = 0; i < cases.length; i++) html.push(parse(cases[i].markdown));
writeFileSync(join(OUTPUT_DIR, 'html.json'), JSON.stringify(html));
