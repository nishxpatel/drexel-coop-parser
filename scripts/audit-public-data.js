"use strict";

const fs = require("fs");
const path = require("path");

const targets = process.argv.slice(2);
const files = targets.length
  ? targets
  : [
      "public/data/jobs.json",
      "public/data/jobs.csv",
      "public/data/parser-summary.json",
      "public/data/schema.json",
      "data/jobs.json",
      "data/jobs.csv",
      "data/parser-summary.json",
      "data/schema.json"
    ];
const patterns = [
  { name: "email address", regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { name: "US phone number", regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g }
];

let findings = 0;

for (const file of files) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) continue;
  const text = fs.readFileSync(absolute, "utf8");
  const lines = text.split(/\r?\n/);

  for (const pattern of patterns) {
    for (let index = 0; index < lines.length; index += 1) {
      pattern.regex.lastIndex = 0;
      const matches = lines[index].match(pattern.regex);
      if (!matches) continue;
      findings += matches.length;
      console.log(`${file}:${index + 1}: possible ${pattern.name}: ${matches.join(", ")}`);
    }
  }
}

if (findings > 0) {
  console.log(`\nFound ${findings} possible public-data concern(s). Review before publishing.`);
  process.exitCode = 1;
} else {
  console.log("No email addresses or US phone numbers found in audited files.");
}
