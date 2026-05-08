import type { JobRecord, ParserSummary } from "../types";

const HEADER_RE = /^(.+?)\s+\((\d+)\)\s+¤\s+Employer:\s+(.+?)\s+\((\d+)\)\s*$/;
const FOOTER_RE = /^(First Page|Previous Page|Next Page|Last Page|Records \d+|Return$|to Job Search$|Transparent Image$|\[ Resume|Release:|© )/;

export const CSV_COLUMNS = [
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
  "application_deadline",
  "compensation",
  "unpaid_position",
  "research_position",
  "job_description",
  "responsibilities",
  "qualifications",
  "required_skills",
  "source_file",
  "parser_confidence",
  "parser_warnings",
  "raw_text_block"
] as const;

interface SearchMetadata {
  source_file: string | null;
  advisor_name: string | null;
  advisor_phone: string | null;
  advisor_email: string | null;
  coop_terms: string[];
  service_type: string | null;
  search_criteria: Record<string, string[]>;
  interview_request_deadline: string | null;
  listed_record_count: number | null;
  listed_record_range: { from: number; to: number } | null;
}

export interface ParsedDocument {
  metadata: SearchMetadata;
  jobs: JobRecord[];
  summary: ParserSummary;
}

export function parseDocument(text: string, options: { sourceFile?: string } = {}): ParsedDocument {
  const sourceFile = options.sourceFile ?? null;
  const normalized = normalizeText(text);
  const lines = normalized.split("\n");
  const metadata = parseSearchMetadata(normalized, sourceFile);
  const headerIndexes: number[] = [];

  lines.forEach((line, index) => {
    if (HEADER_RE.test(line.trim())) headerIndexes.push(index);
  });

  const jobs = headerIndexes.map((start, index) => {
    const end = index + 1 < headerIndexes.length ? headerIndexes[index + 1] : lines.length;
    return parseJobBlock(stripFooter(lines.slice(start, end)), index + 1, sourceFile, metadata);
  });

  return {
    metadata,
    jobs,
    summary: buildSummary(jobs, metadata, headerIndexes.length)
  };
}

export function toCsv(records: JobRecord[], columns: readonly string[] = CSV_COLUMNS): string {
  return [
    columns.join(","),
    ...records.map((record) => columns.map((column) => csvEscape(formatCsvValue(record[column as keyof JobRecord]))).join(","))
  ].join("\n") + "\n";
}

function parseSearchMetadata(text: string, sourceFile: string | null): SearchMetadata {
  const lines = normalizeText(text).split("\n");
  const metadata: SearchMetadata = {
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

  lines.forEach((rawLine) => {
    const line = rawLine.trim();
    let match = line.match(/^Co-op Advisor:\s*(.+)$/);
    if (match) metadata.advisor_name = match[1].trim();
    if (!metadata.advisor_phone && /^\d{3}-\d{3}-\d{4}$/.test(line)) metadata.advisor_phone = line;
    if (!metadata.advisor_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) metadata.advisor_email = line;
    match = line.match(/^Service Type:\s*(.+)$/);
    if (match) metadata.service_type = match[1].trim();
    match = line.match(/^Major\(s\)\s*-\s*(.+)$/);
    if (match) metadata.search_criteria.majors = splitList(match[1], "¤");
    match = line.match(/^For .+ last day interviews may be requested is:\s*(.+)$/i);
    if (match) metadata.interview_request_deadline = match[1].trim();
    match = line.match(/^Records\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+shown$/i);
    if (match && metadata.listed_record_count === null) {
      metadata.listed_record_range = { from: Number(match[1]), to: Number(match[2]) };
      metadata.listed_record_count = Number(match[3]);
    }
  });

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

function parseJobBlock(blockLines: string[], recordIndex: number, sourceFile: string | null, metadata: SearchMetadata): JobRecord {
  const cleanLines = trimOuterBlankLines(blockLines);
  const warnings: string[] = [];
  const rawTextBlock = cleanLines.join("\n").trim();
  const header = (cleanLines[0] ?? "").trim().match(HEADER_RE);

  const record: JobRecord = {
    record_index: recordIndex,
    job_id: header?.[2]?.trim() ?? null,
    job_title: header?.[1]?.trim() ?? null,
    employer_id: header?.[4]?.trim() ?? null,
    employer_name: header?.[3]?.trim() ?? null,
    general_job_location: null,
    position_address: null,
    position_address_lines: [],
    city: null,
    state: null,
    zip: null,
    work_arrangement: "unknown",
    work_arrangement_confidence: "low",
    coop_terms: metadata.coop_terms,
    application_deadline: metadata.interview_request_deadline,
    application_deadline_source: metadata.interview_request_deadline ? "search_page_header" : null,
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
    source_file: sourceFile ?? "",
    raw_text_block: rawTextBlock,
    parser_confidence: 1,
    parser_warnings: warnings,
    parsed_fields: [],
    extra_labeled_fields: {}
  };

  if (!header) warnings.push("Could not parse job header.");

  const bodyLines = cleanLines.slice(1);
  record.general_job_location = cleanValue(findInlineLabel(bodyLines, "General Job Location"));
  record.position_address_lines = extractMultilineLabel(bodyLines, "Position Address", [
    "General Job Location",
    "Job Description",
    "Unpaid Position",
    "Research Position"
  ]).filter((line) => line !== "-- None --");
  record.position_address = record.position_address_lines.length ? record.position_address_lines.join("\n") : null;
  Object.assign(record, parseAddress(record.position_address_lines));

  record.job_description = extractJobDescription(bodyLines);
  if (!record.job_description) warnings.push("Job description is missing or blank.");
  if (record.job_description && /\.\.\.\s*$/.test(record.job_description.trim())) {
    warnings.push("Job description appears truncated in the source export.");
  }

  const unpaid = findInlineLabel(bodyLines, "Unpaid Position");
  if (unpaid !== null) record.unpaid_position = parseBoolean(unpaid);
  const research = findInlineLabel(bodyLines, "Research Position");
  if (research !== null) record.research_position = parseBoolean(research);

  record.compensation_mentions = extractCompensationMentions(rawTextBlock);
  if (record.unpaid_position === true) record.compensation = "Unpaid";
  if (!record.compensation && record.compensation_mentions.length) record.compensation = record.compensation_mentions.join("; ");

  Object.assign(record, inferWorkArrangement(record));
  Object.assign(record, extractDescriptionSections(record.job_description ?? ""));
  Object.assign(record, extractRequirementMentions(rawTextBlock));
  record.contact_information = extractContacts(rawTextBlock);
  record.application_links = extractLinks(rawTextBlock);
  record.extra_labeled_fields = extractExtraLabeledFields(bodyLines);

  if (!record.majors_accepted.length) {
    warnings.push("Majors accepted are not present per posting in this search-result export.");
  }

  record.parser_confidence = calculateConfidence(record);
  record.parsed_fields = Object.keys(record).filter((field) => field !== "parsed_fields" && hasValue(record[field as keyof JobRecord]));
  return record;
}

function normalizeText(text: string): string {
  return String(text || "").replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
}

function stripFooter(lines: string[]): string[] {
  const footerIndex = lines.findIndex((line, index) => index > 0 && FOOTER_RE.test(line.trim()));
  return footerIndex === -1 ? lines : lines.slice(0, footerIndex);
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function findInlineLabel(lines: string[], label: string): string | null {
  const prefix = `${label}:`;
  const line = lines.find((candidate) => candidate.trim().startsWith(prefix));
  return line ? line.trim().slice(prefix.length).trim() : null;
}

function extractMultilineLabel(lines: string[], label: string, stopLabels: string[]): string[] {
  const prefix = `${label}:`;
  const start = lines.findIndex((line) => line.trim().startsWith(prefix));
  if (start === -1) return [];
  const firstValue = lines[start].trim().slice(prefix.length).trim();
  const values = firstValue ? [firstValue] : [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (stopLabels.some((stopLabel) => trimmed.startsWith(`${stopLabel}:`))) break;
    if (trimmed) values.push(trimmed);
  }
  return values;
}

function extractJobDescription(lines: string[]): string | null {
  const start = lines.findIndex((line) => line.trim().startsWith("Job Description:"));
  if (start === -1) return null;
  const firstValue = lines[start].trim().slice("Job Description:".length).trim();
  const values = firstValue ? [firstValue] : [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("Unpaid Position:") || trimmed.startsWith("Research Position:")) break;
    if (trimmed) values.push(trimmed);
  }
  return values.length ? values.join("\n").trim() : null;
}

function parseAddress(addressLines: string[]): Pick<JobRecord, "city" | "state" | "zip"> {
  const result = { city: null, state: null, zip: null };
  for (let i = addressLines.length - 1; i >= 0; i -= 1) {
    const match = addressLines[i].match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (match) return { city: match[1].trim(), state: match[2].toUpperCase(), zip: match[3] };
  }
  return result;
}

function parseBoolean(value: string): boolean | null {
  if (/^yes$/i.test(value.trim())) return true;
  if (/^no$/i.test(value.trim())) return false;
  return null;
}

function inferWorkArrangement(record: JobRecord): Pick<JobRecord, "work_arrangement" | "work_arrangement_confidence"> {
  const haystack = `${record.general_job_location ?? ""}\n${record.position_address ?? ""}\n${record.job_description ?? ""}`;
  if (/remote position/i.test(record.general_job_location ?? "") || /Position Address:\s*-- None --/i.test(record.raw_text_block)) {
    return { work_arrangement: "remote", work_arrangement_confidence: "high" };
  }
  if (/\bhybrid\b/i.test(haystack)) return { work_arrangement: "hybrid", work_arrangement_confidence: "medium" };
  if (/\b(remote|work from home|telework)\b/i.test(record.job_description ?? "")) {
    return { work_arrangement: "remote", work_arrangement_confidence: "medium" };
  }
  if (record.position_address || record.general_job_location) return { work_arrangement: "in_person", work_arrangement_confidence: "medium" };
  return { work_arrangement: "unknown", work_arrangement_confidence: "low" };
}

function extractDescriptionSections(description: string): Partial<JobRecord> {
  const buckets: Record<string, string[]> = {
    responsibilities: [],
    qualifications: [],
    required_skills: [],
    preferred_skills: []
  };
  let current: keyof typeof buckets | null = null;
  description.split("\n").forEach((line) => {
    const trimmed = line.trim();
    const heading = classifyHeading(trimmed);
    if (heading) {
      current = heading;
      const inline = trimmed.includes(":") ? trimmed.slice(trimmed.indexOf(":") + 1).trim() : "";
      if (inline) buckets[current].push(inline);
    } else if (current && trimmed) {
      buckets[current].push(trimmed);
    }
  });
  return Object.fromEntries(Object.entries(buckets).map(([key, lines]) => [key, lines.length ? lines.join("\n") : null])) as Partial<JobRecord>;
}

function classifyHeading(line: string): keyof Pick<JobRecord, "responsibilities" | "qualifications" | "required_skills" | "preferred_skills"> | null {
  const normalized = line.toLowerCase().replace(/[']/g, "'");
  if (!line || line.length > 90) return null;
  if (/preferred/.test(normalized) && /(skill|qualification|requirement)/.test(normalized)) return "preferred_skills";
  if (/(technical skills|required skills|skills required|requirements include)/.test(normalized)) return "required_skills";
  if (/(qualification|requirement|candidate profile)/.test(normalized)) return "qualifications";
  if (/(responsibilit|duties|what you'll do|what you will do|key tasks|job responsibilities)/.test(normalized)) return "responsibilities";
  return null;
}

function extractRequirementMentions(text: string): Partial<JobRecord> {
  return {
    gpa_requirements: firstMatch(text, /\b(?:minimum\s+)?GPA(?:\s+of)?\s*(?:requirement)?[:\s-]*([0-9]\.[0-9]{1,2}(?:\s*(?:or|\/)\s*[0-9]\.[0-9]{1,2})?)/i),
    work_authorization_requirements: firstSentenceLike(text, /\b(work authorization|authorized to work|visa sponsorship|sponsor(?:ship)?|US citizen|U\.S\. citizen|permanent resident)\b/i),
    student_level: firstSentenceLike(text, /\b(freshman|sophomore|pre-junior|junior|senior|graduate student|undergraduate|master'?s|phd)\b/i)
  };
}

function extractCompensationMentions(text: string): string[] {
  const mentions = new Set<string>();
  for (const match of text.matchAll(/\$\s?\d+(?:,\d{3})*(?:\.\d{2})?(?:\s?(?:-|to)\s?\$?\s?\d+(?:,\d{3})*(?:\.\d{2})?)?(?:\s?\/?\s?(?:hour|hr|year|yr|week))?/gi)) {
    mentions.add(match[0].replace(/\s+/g, " ").trim());
  }
  if (/\bstipend\b/i.test(text)) mentions.add("Stipend mentioned");
  if (/\bunpaid\b/i.test(text)) mentions.add("Unpaid mentioned");
  return Array.from(mentions);
}

function extractContacts(text: string): string[] {
  const contacts = new Set<string>();
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) contacts.add(match[0]);
  for (const match of text.matchAll(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g)) contacts.add(match[0]);
  return Array.from(contacts);
}

function extractLinks(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/https?:\/\/[^\s)]+/gi), (match) => match[0])));
}

function extractExtraLabeledFields(lines: string[]): Record<string, string[]> {
  const known = new Set(["General Job Location", "Position Address", "Job Description", "Unpaid Position", "Research Position"]);
  const fields: Record<string, string[]> = {};
  lines.forEach((line) => {
    const match = line.trim().match(/^([A-Z][A-Za-z /&+().,'\-]{2,50}):\s*(.+)$/);
    if (!match || known.has(match[1])) return;
    fields[match[1]] = [...(fields[match[1]] ?? []), match[2].trim()];
  });
  return fields;
}

function calculateConfidence(record: JobRecord): number {
  let score = 1;
  if (!record.job_id || !record.job_title || !record.employer_id || !record.employer_name) score -= 0.35;
  if (!record.general_job_location) score -= 0.12;
  if (!record.job_description) score -= 0.15;
  if (!record.position_address && record.work_arrangement !== "remote") score -= 0.08;
  if (record.job_description && /\.\.\.\s*$/.test(record.job_description)) score -= 0.08;
  if (record.work_arrangement_confidence === "low") score -= 0.05;
  return Number(Math.max(0, Math.min(1, score)).toFixed(2));
}

function buildSummary(jobs: JobRecord[], metadata: SearchMetadata, headerCount: number): ParserSummary {
  const warningCounts: Record<string, number> = {};
  jobs.forEach((job) => {
    job.parser_warnings.forEach((warning) => {
      warningCounts[warning] = (warningCounts[warning] ?? 0) + 1;
    });
  });
  return {
    parser_version: "browser",
    source_file: metadata.source_file,
    listed_record_count: metadata.listed_record_count,
    detected_record_headers: headerCount,
    parsed_record_count: jobs.length,
    record_count_matches_listing: metadata.listed_record_count === null ? null : jobs.length === metadata.listed_record_count,
    warning_counts: warningCounts,
    global_metadata: sanitizeMetadataForPublicSummary(metadata)
  };
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function splitList(value: string, separator: string): string[] {
  return value.split(separator).map((item) => item.trim()).filter(Boolean);
}

function cleanValue(value: string | null): string | null {
  const cleaned = String(value ?? "").trim();
  return !cleaned || cleaned === "-- None --" ? null : cleaned;
}

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "" && value !== "unknown";
}

function firstMatch(text: string, regex: RegExp): string | null {
  const match = text.match(regex);
  return match ? match[1].trim() : null;
}

function firstSentenceLike(text: string, regex: RegExp): string | null {
  const normalized = text.replace(/\s+/g, " ");
  const match = normalized.match(new RegExp(`[^.\\n;]*${regex.source}[^.\\n;]*`, regex.flags));
  return match ? match[0].trim() : null;
}

function sanitizeMetadataForPublicSummary(metadata: SearchMetadata): Record<string, unknown> {
  const { advisor_name, advisor_phone, advisor_email, ...safeMetadata } = metadata;
  void advisor_name;
  void advisor_phone;
  void advisor_email;
  return {
    ...safeMetadata,
    redacted_fields: ["advisor_name", "advisor_phone", "advisor_email"]
  };
}
