"use strict";

const HEADER_RE = /^(.+?)\s+\((\d+)\)\s+¤\s+Employer:\s+(.+?)\s+\((\d+)\)\s*$/;
const FOOTER_RE = /^(First Page|Previous Page|Next Page|Last Page|Records \d+|Return$|to Job Search$|Transparent Image$|\[ Resume|Release:|© )/;

const CSV_COLUMNS = [
  "record_index",
  "job_id",
  "job_title",
  "employer_id",
  "employer_name",
  "detailUrl",
  "general_job_location",
  "position_address",
  "city",
  "state",
  "zip",
  "work_arrangement",
  "isUnpaid",
  "search_result_summary",
  "source_file",
  "parser_confidence",
  "parser_warnings",
  "raw_text_block"
];

const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "DrexelCoopJob",
  type: "object",
  additionalProperties: true,
  required: [
    "record_index",
    "job_id",
    "job_title",
    "employer_id",
    "employer_name",
    "isUnpaid",
    "source_file",
    "raw_text_block",
    "parser_confidence",
    "parser_warnings"
  ],
  properties: {
    record_index: { type: "integer" },
    job_id: { type: ["string", "null"], description: "Numeric job/posting id from the search result header." },
    job_title: { type: ["string", "null"] },
    employer_id: { type: ["string", "null"], description: "Numeric employer id from the search result header." },
    employer_name: { type: ["string", "null"] },
    detailUrl: { type: ["string", "null"], description: "Full posting URL when present in rich copied content or RTFD input." },
    general_job_location: { type: ["string", "null"] },
    position_address: { type: ["string", "null"] },
    position_address_lines: { type: "array", items: { type: "string" } },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    zip: { type: ["string", "null"] },
    work_arrangement: { enum: ["remote", "hybrid", "in_person", "unknown"] },
    work_arrangement_confidence: { type: "string" },
    isUnpaid: { type: "boolean", description: "True only when the search result explicitly marks the posting as unpaid." },
    search_result_summary: { type: ["string", "null"], description: "Short summary text visible on the search results page, not a guaranteed full job description." },
    source_file: { type: "string" },
    raw_text_block: { type: "string" },
    parser_confidence: { type: "number", minimum: 0, maximum: 1 },
    parser_warnings: { type: "array", items: { type: "string" } },
    parsed_fields: { type: "array", items: { type: "string" } },
    extra_labeled_fields: { type: "object" }
  }
};

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u202f]/g, " ");
}

function normalizeSegments(segments) {
  return segments
    .map((segment) => ({ text: normalizeText(segment.text), href: cleanUrl(segment.href || null) }))
    .filter((segment) => segment.text);
}

function splitSegmentsIntoLines(segments) {
  const lines = [{ text: "", hrefs: [] }];
  for (const segment of segments) {
    const parts = segment.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push({ text: "", hrefs: [] });
      const current = lines[lines.length - 1];
      current.text += part;
      if (part.trim() && segment.href && !current.hrefs.includes(segment.href)) current.hrefs.push(segment.href);
    });
  }
  return lines;
}

function coalesceSearchResultLines(lines) {
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    const splitHeaderEnd = /^\(\d+\)$/.test(current.text.trim()) && /^¤\s*$/.test((next && next.text.trim()) || "")
      ? { text: `${current.text.trim()} ${next.text.trim()}`, hrefs: uniqueStrings([...(current.hrefs || []), ...((next && next.hrefs) || [])]) }
      : null;
    const candidateInput = splitHeaderEnd || current;
    const candidate = /^\(\d+\)\s*¤\s*$/.test(candidateInput.text.trim()) ? rebuildWrappedTitleHeader(output, candidateInput) : candidateInput;
    if (/\(\d+\)\s*¤\s*$/.test(candidate.text.trim())) {
      let employerLabelIndex = index + (splitHeaderEnd ? 2 : 1);
      while (employerLabelIndex < lines.length && !lines[employerLabelIndex].text.trim()) employerLabelIndex += 1;
      let employerValueIndex = employerLabelIndex + 1;
      while (employerValueIndex < lines.length && !lines[employerValueIndex].text.trim()) employerValueIndex += 1;
      const employerLabel = (lines[employerLabelIndex] && lines[employerLabelIndex].text.trim()) || "";
      const employerValue = (lines[employerValueIndex] && lines[employerValueIndex].text.trim()) || "";
      if (/^Employer:\s*$/i.test(employerLabel) && /^.+\(\d+\)$/.test(employerValue)) {
        output.push({
          text: `${candidate.text.trim()} Employer: ${employerValue}`,
          hrefs: uniqueStrings([...(candidate.hrefs || []), ...((lines[employerLabelIndex] && lines[employerLabelIndex].hrefs) || []), ...((lines[employerValueIndex] && lines[employerValueIndex].hrefs) || [])])
        });
        index = employerValueIndex;
        continue;
      }
    }
    output.push(current);
  }
  return output;
}

function rebuildWrappedTitleHeader(output, current) {
  const titleLines = [];
  let firstTitleIndex = output.length;
  let blankCountAfterTitle = 0;
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (output[index].text.trim()) {
      titleLines.unshift(output[index]);
      firstTitleIndex = index;
      blankCountAfterTitle = 0;
      continue;
    }
    if (titleLines.length > 0) {
      blankCountAfterTitle += 1;
      if (blankCountAfterTitle >= 2) break;
    }
  }
  if (!titleLines.length) return current;
  output.splice(firstTitleIndex);
  return {
    text: `${titleLines.map((line) => line.text.trim()).join(" ")} ${current.text.trim()}`,
    hrefs: uniqueStrings([...titleLines.flatMap((line) => line.hrefs || []), ...(current.hrefs || [])])
  };
}

function uniqueStrings(values) {
  return Array.from(new Set(values));
}

function findDetailUrl(hrefs, jobId) {
  const urls = hrefs.map(cleanUrl).filter((href) => href && /^https?:\/\//i.test(href));
  return urls.find((href) => new RegExp(`[?&]i_job_num=${escapeRegExp(jobId)}(?:&|$)`, "i").test(href))
    || urls.find((href) => /P_StudentJobDisplay/i.test(href))
    || urls[0]
    || null;
}

function cleanUrl(url) {
  const cleaned = String(url || "").trim();
  return cleaned || null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseHtmlSegments(html) {
  const segments = [];
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let lastIndex = 0;
  let match;
  while ((match = anchorRe.exec(html))) {
    if (match.index > lastIndex) segments.push({ text: htmlToText(html.slice(lastIndex, match.index)) });
    segments.push({ text: htmlToText(match[2]), href: extractHref(match[1]) });
    lastIndex = anchorRe.lastIndex;
  }
  if (lastIndex < html.length) segments.push({ text: htmlToText(html.slice(lastIndex)) });
  return segments.filter((segment) => segment.text);
}

function extractHref(attributes) {
  const match = String(attributes || "").match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return decodeHtmlEntities((match && (match[1] || match[2] || match[3])) || "");
}

function htmlToText(html) {
  return decodeHtmlEntities(
    String(html || "")
      .replace(/<(br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi, "\n")
      .replace(/<\s*(p|div|tr|li|table|tbody|thead|section|article)\b[^>]*>/gi, "\n")
      .replace(/<t[dh]\b[^>]*>/gi, "")
      .replace(/<\/t[dh]>/gi, " ")
      .replace(/<[^>]+>/g, "")
  );
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", curren: "¤" };
  return String(value || "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_entity, body) => {
    const lower = body.toLowerCase();
    if (lower[0] === "#") {
      const code = lower[1] === "x" ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[lower] || "";
  });
}

function parseRtfSegments(rtf) {
  const segments = [];
  let index = 0;
  while (index < rtf.length) {
    const fieldStart = rtf.indexOf("{\\field", index);
    if (fieldStart === -1) {
      segments.push({ text: rtfToText(rtf.slice(index)) });
      break;
    }
    if (fieldStart > index) segments.push({ text: rtfToText(rtf.slice(index, fieldStart)) });
    const fieldEnd = findBalancedGroupEnd(rtf, fieldStart);
    if (fieldEnd === -1) {
      segments.push({ text: rtfToText(rtf.slice(fieldStart)) });
      break;
    }
    const field = rtf.slice(fieldStart, fieldEnd + 1);
    const urlMatch = field.match(/HYPERLINK\s+"([^"]+)"/);
    const result = extractRtfFieldResult(field);
    segments.push({ text: rtfToText(result || field), href: urlMatch ? urlMatch[1] : null });
    index = fieldEnd + 1;
  }
  return segments.filter((segment) => segment.text);
}

function extractRtfFieldResult(field) {
  const marker = field.indexOf("{\\fldrslt");
  if (marker === -1) return "";
  const end = findBalancedGroupEnd(field, marker);
  return end === -1 ? field.slice(marker) : field.slice(marker, end + 1);
}

function findBalancedGroupEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 1;
      continue;
    }
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function rtfToText(rtf) {
  let output = "";
  const stack = [{ skip: false }];
  let unicodeSkip = 1;
  for (let i = 0; i < rtf.length; i += 1) {
    const char = rtf[i];
    const current = stack[stack.length - 1];
    if (char === "{") {
      stack.push({ skip: current.skip });
      continue;
    }
    if (char === "}") {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (char !== "\\") {
      if (!current.skip) output += char;
      continue;
    }

    const next = rtf[i + 1];
    if (next === "'") {
      const hex = rtf.slice(i + 2, i + 4);
      if (!current.skip && /^[0-9a-f]{2}$/i.test(hex)) output += decodeRtfHex(hex);
      i += 3;
      continue;
    }
    if (next === "\\") {
      if (!current.skip) output += "\\";
      i += 1;
      continue;
    }
    if (next === "{") {
      if (!current.skip) output += "{";
      i += 1;
      continue;
    }
    if (next === "}") {
      if (!current.skip) output += "}";
      i += 1;
      continue;
    }
    if (next === "*") {
      stack[stack.length - 1].skip = true;
      i += 1;
      continue;
    }

    const control = rtf.slice(i + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
    if (!control) {
      if (!current.skip && next === "~") output += " ";
      i += 1;
      continue;
    }
    const word = control[1];
    const arg = control[2] ? Number(control[2]) : null;
    i += control[0].length;
    if (current.skip) continue;

    if (word === "uc" && arg !== null) unicodeSkip = arg;
    else if (word === "u" && arg !== null) {
      const code = arg < 0 ? arg + 65536 : arg;
      output += String.fromCharCode(code);
      i += unicodeSkip;
    } else if (["par", "line", "row"].includes(word)) output += "\n";
    else if (word === "cell") output += "\n";
    else if (word === "tab") output += "\t";
  }
  return output.replace(/\r\n?/g, "\n");
}

function decodeRtfHex(hex) {
  const value = Number.parseInt(hex, 16);
  const cp1252 = {
    0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰",
    0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "'", 0x92: "'", 0x93: "\"", 0x94: "\"", 0x95: "•",
    0x96: "-", 0x97: "-", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ"
  };
  return cp1252[value] || String.fromCharCode(value);
}

function parseSearchMetadata(text, sourceFile = null) {
  const lines = normalizeText(text).split("\n");
  const metadata = {
    source_file: sourceFile,
    advisor_name: null,
    advisor_phone: null,
    advisor_email: null,
    coop_terms: [],
    service_type: null,
    search_criteria: {},
    interview_request_deadline: null,
    listed_record_count: null,
    listed_record_range: null
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    let match = line.match(/^Co-op Advisor:\s*(.+)$/);
    if (match) metadata.advisor_name = match[1].trim();

    if (!metadata.advisor_phone && /^\d{3}-\d{3}-\d{4}$/.test(line)) {
      metadata.advisor_phone = line;
    }

    if (!metadata.advisor_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) {
      metadata.advisor_email = line;
    }

    match = line.match(/^Service Type:\s*(.+)$/);
    if (match) metadata.service_type = match[1].trim();

    match = line.match(/^Major\(s\)\s*-\s*(.+)$/);
    if (match) {
      metadata.search_criteria.majors = splitList(match[1], "¤");
    }

    match = line.match(/^For .+ last day interviews may be requested is:\s*(.+)$/i);
    if (match) metadata.interview_request_deadline = match[1].trim();

    match = line.match(/^Records\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+shown$/i);
    if (match && metadata.listed_record_count === null) {
      metadata.listed_record_range = { from: Number(match[1]), to: Number(match[2]) };
      metadata.listed_record_count = Number(match[3]);
    }
  }

  const termsStart = lines.findIndex((line) => line.trim() === "Your coop term(s) by academic year are:");
  if (termsStart !== -1) {
    for (let i = termsStart + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) break;
      metadata.coop_terms.push(...splitList(line, ","));
    }
  }

  return metadata;
}

function parseDocument(text, options = {}) {
  return parseRichTextSegments([{ text }], options);
}

function parseClipboardDocument(input, options = {}) {
  if (input && input.html && input.html.trim()) {
    const rich = parseRichTextSegments(parseHtmlSegments(input.html), options);
    if (rich.jobs.length > 0) return rich;
  }
  return parseDocument((input && input.text) || "", options);
}

function parseHtmlDocument(html, options = {}) {
  return parseRichTextSegments(parseHtmlSegments(html), options);
}

function parseRtfDocument(rtf, options = {}) {
  return parseRichTextSegments(parseRtfSegments(rtf), options);
}

function parseRichTextSegments(segments, options = {}) {
  const sourceFile = options.sourceFile || null;
  const normalizedSegments = normalizeSegments(segments);
  const normalized = normalizedSegments.map((segment) => segment.text).join("");
  const splitLines = splitSegmentsIntoLines(normalizedSegments);
  const coalesced = coalesceSearchResultLines(splitLines);
  const lines = coalesced.map((line) => line.text);
  const richLines = coalesced;
  const metadata = parseSearchMetadata(normalized, sourceFile);
  const headerIndexes = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (HEADER_RE.test(lines[i].trim())) headerIndexes.push(i);
  }

  const skippedSections = detectSkippedSections(lines, headerIndexes);
  const jobs = [];
  for (let i = 0; i < headerIndexes.length; i += 1) {
    const start = headerIndexes[i];
    const end = i + 1 < headerIndexes.length ? headerIndexes[i + 1] : lines.length;
    const blockLines = stripFooter(lines.slice(start, end));
    const header = lines[start].trim().match(HEADER_RE);
    const detailUrl = header ? findDetailUrl((richLines[start] && richLines[start].hrefs) || [], header[2]) : null;
    jobs.push(parseJobBlock(blockLines, {
      recordIndex: i + 1,
      sourceFile,
      metadata,
      detailUrl
    }));
  }

  return {
    metadata,
    jobs,
    summary: buildSummary(jobs, metadata, headerIndexes.length, skippedSections)
  };
}

function parseJobBlock(blockLines, context) {
  const warnings = [];
  const cleanLines = trimOuterBlankLines(blockLines);
  const rawTextBlock = cleanLines.join("\n").trim();
  const headerLine = (cleanLines[0] || "").trim();
  const header = headerLine.match(HEADER_RE);

  const record = {
    record_index: context.recordIndex,
    job_id: null,
    job_title: null,
    employer_id: null,
    employer_name: null,
    detailUrl: context.detailUrl || null,
    general_job_location: null,
    position_address: null,
    position_address_lines: [],
    city: null,
    state: null,
    zip: null,
    work_arrangement: "unknown",
    work_arrangement_confidence: "low",
    isUnpaid: false,
    search_result_summary: null,
    source_file: context.sourceFile || "",
    raw_text_block: rawTextBlock,
    parser_confidence: 1,
    parser_warnings: warnings,
    parsed_fields: [],
    extra_labeled_fields: {}
  };

  if (header) {
    record.job_title = header[1].trim();
    record.job_id = header[2].trim();
    record.employer_name = header[3].trim();
    record.employer_id = header[4].trim();
  } else {
    warnings.push("Could not parse job header.");
  }

  const bodyLines = cleanLines.slice(1);
  const generalLocation = findInlineLabel(bodyLines, "General Job Location");
  if (generalLocation !== null) record.general_job_location = cleanValue(generalLocation);

  record.position_address_lines = extractMultilineLabel(bodyLines, "Position Address", [
    "General Job Location",
    "Job Description",
    "Unpaid Position",
    "Research Position"
  ]);
  record.position_address_lines = record.position_address_lines.filter((line) => line !== "-- None --");
  record.position_address = record.position_address_lines.length ? record.position_address_lines.join("\n") : null;

  const addressParts = parseAddress(record.position_address_lines);
  Object.assign(record, addressParts);

  record.search_result_summary = extractSearchResultSummary(bodyLines);

  const unpaid = findInlineLabel(bodyLines, "Unpaid Position");
  record.isUnpaid = parseBoolean(unpaid) === true;

  Object.assign(record, inferWorkArrangement(record));

  record.extra_labeled_fields = extractExtraLabeledFields(bodyLines);
  record.parsed_fields = Object.keys(record).filter((key) => {
    if (["parser_warnings", "parsed_fields", "extra_labeled_fields"].includes(key)) return false;
    return hasValue(record[key]);
  });
  if (hasValue(record.extra_labeled_fields)) record.parsed_fields.push("extra_labeled_fields");

  addMissingWarnings(record);
  record.parser_confidence = calculateConfidence(record);
  return record;
}

function stripFooter(lines) {
  const footerIndex = lines.findIndex((line, index) => index > 0 && FOOTER_RE.test(line.trim()));
  return footerIndex === -1 ? lines : lines.slice(0, footerIndex);
}

function detectSkippedSections(lines, headerIndexes) {
  const firstHeader = headerIndexes[0] ?? lines.length;
  const headerLines = trimOuterBlankLines(lines.slice(0, firstHeader)).filter((line) => line.trim());
  let footerLines = [];

  if (headerIndexes.length > 0) {
    const lastBlock = lines.slice(headerIndexes[headerIndexes.length - 1]);
    const footerIndex = lastBlock.findIndex((line, index) => index > 0 && FOOTER_RE.test(line.trim()));
    if (footerIndex !== -1) {
      footerLines = trimOuterBlankLines(lastBlock.slice(footerIndex)).filter((line) => line.trim());
    }
  } else {
    footerLines = trimOuterBlankLines(lines).filter((line) => line.trim());
  }

  return {
    skipped_header_line_count: headerLines.length,
    skipped_footer_line_count: footerLines.length,
    skipped_non_job_line_count: headerLines.length + footerLines.length,
    skipped_header_preview: headerLines.slice(0, 12),
    skipped_footer_preview: footerLines.slice(0, 12)
  };
}

function trimOuterBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function findInlineLabel(lines, label) {
  const prefix = `${label}:`;
  const index = lines.findIndex((candidate) => candidate.trim().startsWith(prefix));
  if (index === -1) return null;
  const inline = lines[index].trim().slice(prefix.length).trim();
  if (inline) return inline;
  for (let i = index + 1; i < lines.length; i += 1) {
    const value = lines[i].trim();
    if (value) return value;
  }
  return null;
}

function extractMultilineLabel(lines, label, stopLabels) {
  const prefix = `${label}:`;
  const start = lines.findIndex((line) => line.trim().startsWith(prefix));
  if (start === -1) return [];

  const firstValue = lines[start].trim().slice(prefix.length).trim();
  const values = [];
  if (firstValue) values.push(firstValue);

  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (stopLabels.some((stopLabel) => trimmed.startsWith(`${stopLabel}:`))) break;
    if (trimmed) values.push(trimmed);
  }
  return values;
}

function extractSearchResultSummary(lines) {
  const start = lines.findIndex((line) => line.trim().startsWith("Job Description:"));
  if (start === -1) return null;

  const firstValue = lines[start].trim().slice("Job Description:".length).trim();
  const values = [];
  if (firstValue) values.push(firstValue);

  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("Unpaid Position:") || trimmed.startsWith("Research Position:")) break;
    if (trimmed) values.push(trimmed);
  }

  return values.length ? values.join("\n").trim() : null;
}

function parseAddress(addressLines) {
  const result = { city: null, state: null, zip: null };
  for (let i = addressLines.length - 1; i >= 0; i -= 1) {
    const match = addressLines[i].match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) {
      result.city = match[1].trim();
      result.state = match[2].toUpperCase();
      result.zip = match[3];
      break;
    }
  }
  return result;
}

function parseBoolean(value) {
  if (/^yes$/i.test(String(value).trim())) return true;
  if (/^no$/i.test(String(value).trim())) return false;
  return null;
}

function inferWorkArrangement(record) {
  const haystack = `${record.general_job_location || ""}\n${record.position_address || ""}\n${record.search_result_summary || ""}`;
  if (/remote position/i.test(record.general_job_location || "") || /position address:\s*-- none --/i.test(record.raw_text_block)) {
    return { work_arrangement: "remote", work_arrangement_confidence: "high" };
  }
  if (/\bhybrid\b/i.test(haystack)) {
    return { work_arrangement: "hybrid", work_arrangement_confidence: "medium" };
  }
  if (/\b(remote|work from home|telework)\b/i.test(record.search_result_summary || "")) {
    return { work_arrangement: "remote", work_arrangement_confidence: "medium" };
  }
  if (record.position_address || record.general_job_location) {
    return { work_arrangement: "in_person", work_arrangement_confidence: "medium" };
  }
  return { work_arrangement: "unknown", work_arrangement_confidence: "low" };
}

function extractExtraLabeledFields(lines) {
  const known = new Set(["General Job Location", "Position Address", "Job Description", "Unpaid Position", "Research Position"]);
  const fields = {};
  for (const line of lines) {
    const match = line.trim().match(/^([A-Z][A-Za-z /&+().,'’\-]{2,50}):\s*(.+)$/);
    if (!match || known.has(match[1])) continue;
    if (!fields[match[1]]) fields[match[1]] = [];
    fields[match[1]].push(match[2].trim());
  }
  return fields;
}

function addMissingWarnings(record) {
  const missing = [];
  for (const field of ["general_job_location"]) {
    if (!record[field]) missing.push(field);
  }
  if (!record.position_address && record.work_arrangement !== "remote") missing.push("position_address");
  if (missing.length) record.parser_warnings.push(`Missing expected field(s): ${missing.join(", ")}.`);
}

function calculateConfidence(record) {
  let score = 1;
  if (!record.job_id || !record.job_title || !record.employer_id || !record.employer_name) score -= 0.35;
  if (!record.general_job_location) score -= 0.12;
  if (!record.position_address && record.work_arrangement !== "remote") score -= 0.08;
  if (record.work_arrangement_confidence === "low") score -= 0.05;
  return Number(Math.max(0, Math.min(1, score)).toFixed(2));
}

function buildSummary(jobs, metadata, headerCount, skippedSections = {}) {
  const missingFieldCounts = {};
  const extractedFieldCounts = {};
  const warningCounts = {};
  const parserWarnings = [];
  const allFields = Object.keys(SCHEMA.properties).filter((field) => !["parser_warnings", "parsed_fields"].includes(field));

  for (const field of allFields) {
    missingFieldCounts[field] = 0;
    extractedFieldCounts[field] = 0;
  }

  for (const job of jobs) {
    for (const field of allFields) {
      if (hasValue(job[field])) extractedFieldCounts[field] += 1;
      else missingFieldCounts[field] += 1;
    }
    for (const warning of job.parser_warnings) {
      warningCounts[warning] = (warningCounts[warning] || 0) + 1;
    }
  }

  if (headerCount === 0) {
    parserWarnings.push("No job posting headers were detected. Check that the pasted text includes the search results list.");
  }
  if ((skippedSections.skipped_header_line_count || 0) > 0) {
    parserWarnings.push(`Skipped ${skippedSections.skipped_header_line_count} non-job header/interface line(s).`);
  }
  if ((skippedSections.skipped_footer_line_count || 0) > 0) {
    parserWarnings.push(`Skipped ${skippedSections.skipped_footer_line_count} non-job footer/interface line(s).`);
  }

  return {
    parser_version: "1.0.0",
    source_file: metadata.source_file,
    parser_warnings: parserWarnings,
    listed_record_count: metadata.listed_record_count,
    detected_record_headers: headerCount,
    parsed_record_count: jobs.length,
    record_count_matches_listing: metadata.listed_record_count === null ? null : jobs.length === metadata.listed_record_count,
    ...skippedSections,
    extracted_field_counts: extractedFieldCounts,
    missing_field_counts: missingFieldCounts,
    warning_counts: warningCounts,
    global_metadata: sanitizeMetadataForPublicSummary(metadata)
  };
}

function toCsv(records, columns = CSV_COLUMNS) {
  const rows = [columns.join(",")];
  for (const record of records) {
    rows.push(columns.map((column) => csvEscape(formatCsvValue(record[column]))).join(","));
  }
  return `${rows.join("\n")}\n`;
}

function formatCsvValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvEscape(value) {
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function splitList(value, separator) {
  return String(value || "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanValue(value) {
  const cleaned = String(value || "").trim();
  return cleaned === "-- None --" ? null : cleaned;
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "" && value !== "unknown";
}

function sanitizeMetadataForPublicSummary(metadata) {
  const sanitized = { ...metadata };
  delete sanitized.advisor_name;
  delete sanitized.advisor_phone;
  delete sanitized.advisor_email;
  sanitized.redacted_fields = ["advisor_name", "advisor_phone", "advisor_email"];
  return sanitized;
}

function firstMatch(text, regex) {
  const match = String(text || "").match(regex);
  return match ? match[1].trim() : null;
}

function firstSentenceLike(text, regex) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const match = normalized.match(new RegExp(`[^.\\n;]*${regex.source}[^.\\n;]*`, regex.flags));
  return match ? match[0].trim() : null;
}

module.exports = {
  CSV_COLUMNS,
  SCHEMA,
  parseClipboardDocument,
  parseDocument,
  parseHtmlDocument,
  parseJobBlock,
  parseRichTextSegments,
  parseRtfSegments,
  parseRtfDocument,
  _coalesceSearchResultLines: coalesceSearchResultLines,
  parseSearchMetadata,
  toCsv
};
