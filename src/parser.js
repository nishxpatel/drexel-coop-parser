"use strict";

const HEADER_RE = /^(.+?)\s+\((\d+)\)\s+¤\s+Employer:\s+(.+?)\s+\((\d+)\)\s*$/;
const FOOTER_RE = /^(First Page|Previous Page|Next Page|Last Page|Records \d+|Return$|to Job Search$|Transparent Image$|\[ Resume|Release:|© )/;

const CSV_COLUMNS = [
  "record_index",
  "job_id",
  "job_title",
  "employer_id",
  "employer_name",
  "general_job_location",
  "position_address",
  "city",
  "state",
  "zip",
  "work_arrangement",
  "work_arrangement_confidence",
  "coop_terms",
  "application_deadline",
  "application_deadline_source",
  "compensation",
  "compensation_mentions",
  "unpaid_position",
  "research_position",
  "job_description",
  "responsibilities",
  "qualifications",
  "required_skills",
  "preferred_skills",
  "contact_information",
  "application_links",
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
    general_job_location: { type: ["string", "null"] },
    position_address: { type: ["string", "null"] },
    position_address_lines: { type: "array", items: { type: "string" } },
    city: { type: ["string", "null"] },
    state: { type: ["string", "null"] },
    zip: { type: ["string", "null"] },
    work_arrangement: { enum: ["remote", "hybrid", "in_person", "unknown"] },
    work_arrangement_confidence: { type: "string" },
    coop_terms: { type: "array", items: { type: "string" } },
    application_deadline: { type: ["string", "null"] },
    application_deadline_source: { type: ["string", "null"] },
    compensation: { type: ["string", "null"] },
    compensation_mentions: { type: "array", items: { type: "string" } },
    unpaid_position: { type: ["boolean", "null"] },
    research_position: { type: ["boolean", "null"] },
    majors_accepted: { type: "array", items: { type: "string" } },
    student_level: { type: ["string", "null"] },
    gpa_requirements: { type: ["string", "null"] },
    work_authorization_requirements: { type: ["string", "null"] },
    job_description: { type: ["string", "null"] },
    responsibilities: { type: ["string", "null"] },
    qualifications: { type: ["string", "null"] },
    required_skills: { type: ["string", "null"] },
    preferred_skills: { type: ["string", "null"] },
    industry: { type: ["string", "null"] },
    contact_information: { type: "array", items: { type: "string" } },
    application_method: { type: ["string", "null"] },
    application_links: { type: "array", items: { type: "string" } },
    number_of_positions: { type: ["string", "null"] },
    status: { type: ["string", "null"] },
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
    .replace(/\u00a0/g, " ");
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
  const sourceFile = options.sourceFile || null;
  const normalized = normalizeText(text);
  const lines = normalized.split("\n");
  const metadata = parseSearchMetadata(normalized, sourceFile);
  const headerIndexes = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (HEADER_RE.test(lines[i].trim())) headerIndexes.push(i);
  }

  const jobs = [];
  for (let i = 0; i < headerIndexes.length; i += 1) {
    const start = headerIndexes[i];
    const end = i + 1 < headerIndexes.length ? headerIndexes[i + 1] : lines.length;
    const blockLines = stripFooter(lines.slice(start, end));
    jobs.push(parseJobBlock(blockLines, {
      recordIndex: i + 1,
      sourceFile,
      metadata
    }));
  }

  return {
    metadata,
    jobs,
    summary: buildSummary(jobs, metadata, headerIndexes.length)
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
    general_job_location: null,
    position_address: null,
    position_address_lines: [],
    city: null,
    state: null,
    zip: null,
    work_arrangement: "unknown",
    work_arrangement_confidence: "low",
    coop_terms: context.metadata.coop_terms || [],
    application_deadline: context.metadata.interview_request_deadline || null,
    application_deadline_source: context.metadata.interview_request_deadline ? "search_page_header" : null,
    compensation: null,
    compensation_mentions: [],
    unpaid_position: null,
    research_position: null,
    majors_accepted: [],
    student_level: null,
    gpa_requirements: null,
    work_authorization_requirements: null,
    job_description: null,
    responsibilities: null,
    qualifications: null,
    required_skills: null,
    preferred_skills: null,
    industry: null,
    contact_information: [],
    application_method: null,
    application_links: [],
    number_of_positions: null,
    status: null,
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

  record.job_description = extractJobDescription(bodyLines);
  if (!record.job_description) warnings.push("Job description is missing or blank.");
  if (record.job_description && /\.\.\.\s*$/.test(record.job_description.trim())) {
    warnings.push("Job description appears truncated in the source export.");
  }

  const unpaid = findInlineLabel(bodyLines, "Unpaid Position");
  if (unpaid !== null) record.unpaid_position = parseBoolean(unpaid);
  const research = findInlineLabel(bodyLines, "Research Position");
  if (research !== null) record.research_position = parseBoolean(research);

  if (record.unpaid_position === true) record.compensation = "Unpaid";
  record.compensation_mentions = extractCompensationMentions(rawTextBlock);
  if (!record.compensation && record.compensation_mentions.length) {
    record.compensation = record.compensation_mentions.join("; ");
  }

  Object.assign(record, inferWorkArrangement(record));
  Object.assign(record, extractDescriptionSections(record.job_description || ""));
  Object.assign(record, extractRequirementMentions(rawTextBlock));
  record.contact_information = extractContacts(rawTextBlock);
  record.application_links = extractLinks(rawTextBlock);

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

function trimOuterBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function findInlineLabel(lines, label) {
  const prefix = `${label}:`;
  const line = lines.find((candidate) => candidate.trim().startsWith(prefix));
  if (!line) return null;
  return line.trim().slice(prefix.length).trim();
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

function extractJobDescription(lines) {
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
  const haystack = `${record.general_job_location || ""}\n${record.position_address || ""}\n${record.job_description || ""}`;
  if (/remote position/i.test(record.general_job_location || "") || /position address:\s*-- none --/i.test(record.raw_text_block)) {
    return { work_arrangement: "remote", work_arrangement_confidence: "high" };
  }
  if (/\bhybrid\b/i.test(haystack)) {
    return { work_arrangement: "hybrid", work_arrangement_confidence: "medium" };
  }
  if (/\b(remote|work from home|telework)\b/i.test(record.job_description || "")) {
    return { work_arrangement: "remote", work_arrangement_confidence: "medium" };
  }
  if (record.position_address || record.general_job_location) {
    return { work_arrangement: "in_person", work_arrangement_confidence: "medium" };
  }
  return { work_arrangement: "unknown", work_arrangement_confidence: "low" };
}

function extractDescriptionSections(description) {
  const output = {
    responsibilities: null,
    qualifications: null,
    required_skills: null,
    preferred_skills: null
  };
  if (!description) return output;

  const lines = description.split("\n");
  let current = null;
  const buckets = {
    responsibilities: [],
    qualifications: [],
    required_skills: [],
    preferred_skills: []
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const heading = classifyHeading(trimmed);
    if (heading) {
      current = heading;
      const inline = trimmed.includes(":") ? trimmed.slice(trimmed.indexOf(":") + 1).trim() : "";
      if (inline) buckets[current].push(inline);
      continue;
    }
    if (current && trimmed) buckets[current].push(trimmed);
  }

  for (const key of Object.keys(buckets)) {
    if (buckets[key].length) output[key] = buckets[key].join("\n").trim();
  }
  return output;
}

function classifyHeading(line) {
  const normalized = line.toLowerCase().replace(/[’']/g, "'");
  if (!line || line.length > 90) return null;
  if (/preferred/.test(normalized) && /(skill|qualification|requirement)/.test(normalized)) return "preferred_skills";
  if (/(technical skills|required skills|skills required|requirements include)/.test(normalized)) return "required_skills";
  if (/(qualification|requirement|candidate profile)/.test(normalized)) return "qualifications";
  if (/(responsibilit|duties|what you'll do|what you will do|key tasks|job responsibilities)/.test(normalized)) return "responsibilities";
  return null;
}

function extractRequirementMentions(text) {
  return {
    gpa_requirements: firstMatch(text, /\b(?:minimum\s+)?GPA(?:\s+of)?\s*(?:requirement)?[:\s-]*([0-9]\.[0-9]{1,2}(?:\s*(?:or|\/)\s*[0-9]\.[0-9]{1,2})?)/i),
    work_authorization_requirements: firstSentenceLike(text, /\b(work authorization|authorized to work|visa sponsorship|sponsor(?:ship)?|US citizen|U\.S\. citizen|permanent resident)\b/i),
    student_level: firstSentenceLike(text, /\b(freshman|sophomore|pre-junior|junior|senior|graduate student|undergraduate|master'?s|phd)\b/i)
  };
}

function extractCompensationMentions(text) {
  const mentions = new Set();
  const dollarRe = /\$\s?\d+(?:,\d{3})*(?:\.\d{2})?(?:\s?(?:-|to)\s?\$?\s?\d+(?:,\d{3})*(?:\.\d{2})?)?(?:\s?\/?\s?(?:hour|hr|year|yr|week))?/gi;
  for (const match of text.matchAll(dollarRe)) mentions.add(match[0].replace(/\s+/g, " ").trim());
  if (/\bstipend\b/i.test(text)) mentions.add("Stipend mentioned");
  if (/\bunpaid\b/i.test(text)) mentions.add("Unpaid mentioned");
  return Array.from(mentions);
}

function extractContacts(text) {
  const contacts = new Set();
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) contacts.add(match[0]);
  for (const match of text.matchAll(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g)) contacts.add(match[0]);
  return Array.from(contacts);
}

function extractLinks(text) {
  return Array.from(new Set(Array.from(text.matchAll(/https?:\/\/[^\s)]+/gi), (match) => match[0])));
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
  for (const field of ["general_job_location", "job_description"]) {
    if (!record[field]) missing.push(field);
  }
  if (!record.position_address && record.work_arrangement !== "remote") missing.push("position_address");
  if (missing.length) record.parser_warnings.push(`Missing expected field(s): ${missing.join(", ")}.`);
  if (!record.majors_accepted.length) {
    record.parser_warnings.push("Majors accepted are not present per posting in this search-result export.");
  }
}

function calculateConfidence(record) {
  let score = 1;
  if (!record.job_id || !record.job_title || !record.employer_id || !record.employer_name) score -= 0.35;
  if (!record.general_job_location) score -= 0.12;
  if (!record.job_description) score -= 0.15;
  if (!record.position_address && record.work_arrangement !== "remote") score -= 0.08;
  if (record.job_description && /\.\.\.\s*$/.test(record.job_description)) score -= 0.08;
  if (record.work_arrangement_confidence === "low") score -= 0.05;
  return Number(Math.max(0, Math.min(1, score)).toFixed(2));
}

function buildSummary(jobs, metadata, headerCount) {
  const missingFieldCounts = {};
  const extractedFieldCounts = {};
  const warningCounts = {};
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

  return {
    parser_version: "1.0.0",
    source_file: metadata.source_file,
    listed_record_count: metadata.listed_record_count,
    detected_record_headers: headerCount,
    parsed_record_count: jobs.length,
    record_count_matches_listing: metadata.listed_record_count === null ? null : jobs.length === metadata.listed_record_count,
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
  parseDocument,
  parseJobBlock,
  parseSearchMetadata,
  toCsv
};
