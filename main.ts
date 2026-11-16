// Entry point for the markdown-render-speed-02 harness.
// Reads every case from the input directory's cases.json, renders each
// one with the dependency-free parser in ./parse.js, and writes the
// HTML strings, in the same order, to the output directory's
// html.json. The harness mounts the input at /input and the output at
// /output; its process driver passes the same locations through the
// MAKEFUN_INPUT_DIR / MAKEFUN_OUTPUT_DIR environment variables, which
// take precedence when present.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "./parse.js";

type Case = { id: string; markdown: string };

function main(): void {
  const inputDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const raw = readFileSync(inputDir + "/cases.json", "utf8");
  const cases = JSON.parse(raw) as Case[];
  const out: string[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    out[i] = parse(cases[i].markdown);
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputDir + "/html.json", JSON.stringify(out));
}

main();
