"use strict";

const fs = require("fs");
const path = require("path");

const sourceDir = path.resolve("data");
const targetDir = path.resolve("dist", "data");

if (!fs.existsSync(sourceDir)) {
  console.warn("No data directory found; skipping data copy.");
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
for (const file of ["jobs.json", "jobs.csv", "schema.json", "parser-summary.json"]) {
  const source = path.join(sourceDir, file);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(targetDir, file));
  }
}

console.log(`Copied data files to ${targetDir}`);
