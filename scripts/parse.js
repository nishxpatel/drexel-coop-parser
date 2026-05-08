"use strict";

const fs = require("fs");
const path = require("path");
const { SCHEMA, parseDocument, toCsv } = require("../src/parser");

const inputPath = process.argv[2] || "all.txt";
const outputDir = process.argv[3] || "data";
const absoluteInputPath = path.resolve(inputPath);
const absoluteOutputDir = path.resolve(outputDir);

if (!fs.existsSync(absoluteInputPath)) {
  console.error(`Input file not found: ${absoluteInputPath}`);
  process.exit(1);
}

const rawText = fs.readFileSync(absoluteInputPath, "utf8");
const parsed = parseDocument(rawText, { sourceFile: path.basename(inputPath) });

fs.mkdirSync(absoluteOutputDir, { recursive: true });
fs.writeFileSync(path.join(absoluteOutputDir, "jobs.json"), `${JSON.stringify(parsed.jobs, null, 2)}\n`);
fs.writeFileSync(path.join(absoluteOutputDir, "jobs.csv"), toCsv(parsed.jobs));
fs.writeFileSync(path.join(absoluteOutputDir, "schema.json"), `${JSON.stringify(SCHEMA, null, 2)}\n`);
fs.writeFileSync(path.join(absoluteOutputDir, "parser-summary.json"), `${JSON.stringify(parsed.summary, null, 2)}\n`);

console.log(`Parsed ${parsed.jobs.length} job records from ${absoluteInputPath}`);
console.log(`Wrote ${path.join(absoluteOutputDir, "jobs.json")}`);
console.log(`Wrote ${path.join(absoluteOutputDir, "jobs.csv")}`);
console.log(`Wrote ${path.join(absoluteOutputDir, "schema.json")}`);
console.log(`Wrote ${path.join(absoluteOutputDir, "parser-summary.json")}`);

if (parsed.summary.record_count_matches_listing === false) {
  console.warn(`Warning: parsed ${parsed.jobs.length} records, but source listing says ${parsed.metadata.listed_record_count}.`);
}
