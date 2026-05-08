export type WorkArrangement = "remote" | "hybrid" | "in_person" | "unknown";

export interface JobRecord {
  record_index: number;
  job_id: string | null;
  job_title: string | null;
  employer_id: string | null;
  employer_name: string | null;
  general_job_location: string | null;
  position_address: string | null;
  position_address_lines: string[];
  city: string | null;
  state: string | null;
  zip: string | null;
  work_arrangement: WorkArrangement;
  work_arrangement_confidence: string;
  coop_terms: string[];
  application_deadline: string | null;
  application_deadline_source: string | null;
  compensation: string | null;
  compensation_mentions: string[];
  unpaid_position: boolean | null;
  research_position: boolean | null;
  majors_accepted: string[];
  student_level: string | null;
  gpa_requirements: string | null;
  work_authorization_requirements: string | null;
  job_description: string | null;
  responsibilities: string | null;
  qualifications: string | null;
  required_skills: string | null;
  preferred_skills: string | null;
  industry: string | null;
  contact_information: string[];
  application_method: string | null;
  application_links: string[];
  number_of_positions: string | null;
  status: string | null;
  source_file: string;
  raw_text_block: string;
  parser_confidence: number;
  parser_warnings: string[];
  parsed_fields: string[];
  extra_labeled_fields: Record<string, string[]>;
}

export interface ParserSummary {
  parser_version?: string;
  source_file?: string | null;
  parser_warnings?: string[];
  listed_record_count?: number | null;
  detected_record_headers: number;
  parsed_record_count: number;
  record_count_matches_listing?: boolean | null;
  skipped_header_line_count?: number;
  skipped_footer_line_count?: number;
  skipped_non_job_line_count?: number;
  skipped_header_preview?: string[];
  skipped_footer_preview?: string[];
  extracted_field_counts?: Record<string, number>;
  missing_field_counts?: Record<string, number>;
  warning_counts?: Record<string, number>;
  global_metadata?: Record<string, unknown>;
}
