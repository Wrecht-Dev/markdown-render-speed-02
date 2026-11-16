// Driver for the markdown-render-speed-02 entry: read every case from
// /input/cases.json, render each one with our own parse(), and write the
// HTML strings, in order, to /output/html.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "./parse.js";

interface Case {
  id: string;
  markdown: string;
}

function main(): void {
  const raw = readFileSync("/input/cases.json", "utf8");
  const cases = JSON.parse(raw) as Case[];
  const out: string[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    out[i] = parse(cases[i].markdown);
  }
  mkdirSync("/output", { recursive: true });
  writeFileSync("/output/html.json", JSON.stringify(out));
}

main();
