// Entry point for the markdown-render-speed-02 harness.
// Reads every case from /input/cases.json, renders each one with the
// dependency-free parser in ./parse.js, and writes the HTML strings,
// in the same order, to /output/html.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "./parse.js";

type Case = { id: string; markdown: string };

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
