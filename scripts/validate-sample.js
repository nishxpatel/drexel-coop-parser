"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { parseDocument, parseHtmlDocument, parseRtfDocument } = require("../src/parser");

const samplePath = process.argv[2] || "fixtures/sample-search-results.txt";
const absoluteSamplePath = path.resolve(samplePath);

if (!fs.existsSync(absoluteSamplePath)) {
  console.error(`Sample file not found: ${absoluteSamplePath}`);
  process.exit(1);
}

const rawText = fs.readFileSync(absoluteSamplePath, "utf8");
const parsed = parseDocument(rawText, { sourceFile: path.basename(samplePath) });
const jobs = parsed.jobs;

assert.ok(jobs.length > 0, "sample should parse into at least one job record");
if (parsed.metadata.listed_record_range) {
  const expectedVisibleCount = parsed.metadata.listed_record_range.to - parsed.metadata.listed_record_range.from + 1;
  assert.strictEqual(jobs.length, expectedVisibleCount, "parsed count should match the visible source listing range");
}
assert.ok(jobs.every((job) => job.raw_text_block && job.raw_text_block.includes(job.job_id)), "every record should preserve a raw text block");
assert.ok(jobs.every((job) => job.job_title && job.employer_name), "every record should include title and employer");
assert.ok(jobs.every((job) => !job.raw_text_block.includes("First Page Previous Page")), "pagination text should not be part of raw job blocks");
assert.ok(jobs.every((job) => job.general_job_location), "every fixture record should have a location");
assert.ok(jobs.every((job) => typeof job.isUnpaid === "boolean"), "every fixture record should have a simple unpaid flag");
assert.ok(jobs.some((job) => job.isUnpaid), "fixture should include at least one unpaid posting");

const richHtmlPath = path.resolve("fixtures/sample-search-results-rich.html");
const richHtml = parseHtmlDocument(fs.readFileSync(richHtmlPath, "utf8"), { sourceFile: path.basename(richHtmlPath) });
assert.strictEqual(richHtml.jobs.length, 2, "rich HTML fixture should parse two records");
assert.ok(richHtml.jobs.every((job) => job.detailUrl), "rich HTML fixture should preserve full-posting links");

const richRtfPath = path.resolve("fixtures/sample-search-results-rich.rtf");
const richRtf = parseRtfDocument(fs.readFileSync(richRtfPath, "utf8"), { sourceFile: path.basename(richRtfPath) });
assert.strictEqual(richRtf.jobs.length, 2, "rich RTF fixture should parse two records");
assert.ok(richRtf.jobs.every((job) => job.detailUrl), "rich RTF fixture should preserve full-posting links");

assert.ok(jobs.every((job) => !job.detailUrl), "plain text fixture should still parse without links");

console.log("Sample validation passed.");
console.log(`Parsed records: ${jobs.length}`);
console.log(`First record: ${jobs[0].job_title} / ${jobs[0].employer_name}`);
console.log(`Warnings emitted: ${jobs.reduce((sum, job) => sum + job.parser_warnings.length, 0)}`);
console.log(`Rich HTML links: ${richHtml.jobs.filter((job) => job.detailUrl).length}`);
console.log(`Rich RTF links: ${richRtf.jobs.filter((job) => job.detailUrl).length}`);
