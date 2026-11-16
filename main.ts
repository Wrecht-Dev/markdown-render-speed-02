import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse } from "./parse.js";

type Case = { id: string; markdown: string };

const cases = JSON.parse(readFileSync("/input/cases.json", "utf8")) as Case[];
const out: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  out[i] = parse(cases[i].markdown);
}
mkdirSync("/output", { recursive: true });
writeFileSync("/output/html.json", JSON.stringify(out));
