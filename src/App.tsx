import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  FileJson,
  Filter,
  Import,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  TableProperties,
  Trash2,
  X
} from "lucide-react";
import type { JobRecord, ParserSummary, WorkArrangement } from "./types";
import { parseDocument, toCsv } from "./lib/parser";

type View = "dashboard" | "import";
type SortKey = "job_title" | "employer_name" | "general_job_location" | "application_deadline" | "compensation" | "parser_confidence" | "record_index";
type SortDir = "asc" | "desc";
type TriState = "any" | "yes" | "no";

interface Filters {
  query: string;
  exact: boolean;
  includeRaw: boolean;
  locations: string[];
  states: string[];
  arrangements: WorkArrangement[];
  employer: string;
  unpaid: TriState;
  research: TriState;
  warningsOnly: boolean;
  minConfidence: number;
}

interface SavedSearch {
  name: string;
  filters: Filters;
  sortKey: SortKey;
  sortDir: SortDir;
}

interface ColumnDef {
  key: keyof JobRecord;
  label: string;
  defaultVisible: boolean;
}

const DEFAULT_FILTERS: Filters = {
  query: "",
  exact: false,
  includeRaw: true,
  locations: [],
  states: [],
  arrangements: [],
  employer: "",
  unpaid: "any",
  research: "any",
  warningsOnly: false,
  minConfidence: 0
};

const COLUMNS: ColumnDef[] = [
  { key: "job_title", label: "Title", defaultVisible: true },
  { key: "employer_name", label: "Employer", defaultVisible: true },
  { key: "general_job_location", label: "Location", defaultVisible: true },
  { key: "city", label: "City", defaultVisible: false },
  { key: "state", label: "State", defaultVisible: false },
  { key: "work_arrangement", label: "Mode", defaultVisible: true },
  { key: "application_deadline", label: "Deadline", defaultVisible: true },
  { key: "compensation", label: "Pay", defaultVisible: true },
  { key: "unpaid_position", label: "Unpaid", defaultVisible: false },
  { key: "research_position", label: "Research", defaultVisible: false },
  { key: "parser_confidence", label: "Confidence", defaultVisible: true },
  { key: "parser_warnings", label: "Warnings", defaultVisible: true }
];

const DEFAULT_COLUMNS = Object.fromEntries(COLUMNS.map((column) => [column.key, column.defaultVisible])) as Record<string, boolean>;
const DEFAULT_SOURCE_NAME = "safe demo data";

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [defaultJobs, setDefaultJobs] = useState<JobRecord[]>([]);
  const [summary, setSummary] = useState<ParserSummary | null>(null);
  const [sourceName, setSourceName] = useState(DEFAULT_SOURCE_NAME);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => readFiltersFromUrl());
  const [sortKey, setSortKey] = useState<SortKey>(() => (new URLSearchParams(window.location.search).get("sort") as SortKey) || "record_index");
  const [sortDir, setSortDir] = useState<SortDir>(() => (new URLSearchParams(window.location.search).get("dir") as SortDir) || "asc");
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const stored = localStorage.getItem("coop-dashboard-columns");
    return stored ? { ...DEFAULT_COLUMNS, ...JSON.parse(stored) } : DEFAULT_COLUMNS;
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null);
  const [importText, setImportText] = useState("");
  const [imported, setImported] = useState<{ jobs: JobRecord[]; summary: ParserSummary } | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => readSavedSearches());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    async function loadDefaultData() {
      try {
        const [jobsResponse, summaryResponse] = await Promise.all([
          fetch(`${import.meta.env.BASE_URL}data/jobs.json`),
          fetch(`${import.meta.env.BASE_URL}data/parser-summary.json`)
        ]);
        if (!jobsResponse.ok) throw new Error(`Unable to load data/jobs.json (${jobsResponse.status})`);
        const loadedJobs = (await jobsResponse.json()) as JobRecord[];
        const loadedSummary = summaryResponse.ok ? ((await summaryResponse.json()) as ParserSummary) : null;
        setJobs(loadedJobs);
        setDefaultJobs(loadedJobs);
        setSummary(loadedSummary);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Unable to load default data.");
      }
    }
    void loadDefaultData();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.query) params.set("q", filters.query);
    if (filters.exact) params.set("exact", "1");
    if (!filters.includeRaw) params.set("raw", "0");
    if (filters.locations.length) params.set("loc", filters.locations.join("|"));
    if (filters.states.length) params.set("state", filters.states.join("|"));
    if (filters.arrangements.length) params.set("mode", filters.arrangements.join("|"));
    if (filters.employer) params.set("employer", filters.employer);
    if (filters.unpaid !== "any") params.set("unpaid", filters.unpaid);
    if (filters.research !== "any") params.set("research", filters.research);
    if (filters.warningsOnly) params.set("warnings", "1");
    if (filters.minConfidence > 0) params.set("conf", String(filters.minConfidence));
    if (sortKey !== "record_index") params.set("sort", sortKey);
    if (sortDir !== "asc") params.set("dir", sortDir);
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [filters, sortKey, sortDir]);

  useEffect(() => {
    localStorage.setItem("coop-dashboard-columns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  const options = useMemo(() => {
    return {
      locations: unique(jobs.map((job) => job.general_job_location)),
      states: unique(jobs.map((job) => job.state)),
      employers: unique(jobs.map((job) => job.employer_name)).slice(0, 500)
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    return jobs
      .filter((job) => matchesFilters(job, filters))
      .sort((a, b) => compareJobs(a, b, sortKey, sortDir));
  }, [jobs, filters, sortKey, sortDir]);

  const activeChips = useMemo(() => buildFilterChips(filters), [filters]);
  const selectedJobs = filteredJobs.filter((job) => job.job_id && selectedIds.has(job.job_id));
  const visibleColumnDefs = COLUMNS.filter((column) => visibleColumns[column.key]);
  const warningCount = filteredJobs.filter((job) => job.parser_warnings.length > 0).length;

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedIds(new Set());
  }

  function toggleArrayFilter<K extends "locations" | "states" | "arrangements">(key: K, value: Filters[K][number]) {
    setFilters((current) => {
      const values = current[key] as string[];
      const next = values.includes(value as string) ? values.filter((item) => item !== value) : [...values, value as string];
      return { ...current, [key]: next };
    });
    setSelectedIds(new Set());
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setSortKey("record_index");
    setSortDir("asc");
    setSelectedIds(new Set());
  }

  function resetToDefaultData() {
    setJobs(defaultJobs);
    setSourceName(DEFAULT_SOURCE_NAME);
    setImported(null);
    setSummary(null);
    void fetch(`${import.meta.env.BASE_URL}data/parser-summary.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setSummary(data));
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function parseImportText() {
    if (!importText.trim()) {
      flash("Paste raw search result text first");
      return;
    }
    const parsed = parseDocument(importText, { sourceFile: "browser-paste" });
    setImported({ jobs: parsed.jobs, summary: parsed.summary });
  }

  function useImportedResults() {
    if (!imported) return;
    setJobs(imported.jobs);
    setSummary(imported.summary);
    setSourceName("browser paste");
    setView("dashboard");
    resetFilters();
  }

  function clearImportedData() {
    setImportText("");
    setImported(null);
    if (sourceName === "browser paste") {
      resetToDefaultData();
    }
    flash("Imported data cleared from this tab");
  }

  function saveSearch() {
    const name = window.prompt("Saved search name");
    if (!name) return;
    const next = [...savedSearches.filter((item) => item.name !== name), { name, filters, sortKey, sortDir }];
    setSavedSearches(next);
    localStorage.setItem("coop-dashboard-saved-searches", JSON.stringify(next));
  }

  function applySavedSearch(search: SavedSearch) {
    setFilters(search.filters);
    setSortKey(search.sortKey);
    setSortDir(search.sortDir);
  }

  function clearBrowserStorage() {
    localStorage.removeItem("coop-dashboard-columns");
    localStorage.removeItem("coop-dashboard-saved-searches");
    setVisibleColumns({ ...DEFAULT_COLUMNS });
    setSavedSearches([]);
    flash("Saved browser settings cleared");
  }

  async function copyRecords(records: JobRecord[], label: string) {
    await navigator.clipboard.writeText(JSON.stringify(records, null, 2));
    flash(`${label} copied`);
  }

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1800);
  }

  if (loadError) {
    return (
      <main className="empty-state">
        <AlertTriangle />
        <h1>Data could not be loaded</h1>
        <p>{loadError}</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>Drexel Co-op Search</h1>
          <p>{sourceName} / {jobs.length.toLocaleString()} records loaded</p>
        </div>
        <nav className="view-tabs" aria-label="Views">
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            <TableProperties size={17} /> Dashboard
          </button>
          <button className={view === "import" ? "active" : ""} onClick={() => setView("import")}>
            <Import size={17} /> Paste Import
          </button>
        </nav>
      </header>

      {view === "dashboard" ? (
        <main className="dashboard-layout">
          <aside className="filter-panel">
            <div className="panel-heading">
              <Filter size={18} />
              <h2>Filters</h2>
            </div>

            <label className="field-label" htmlFor="keyword">Keyword Search</label>
            <div className="search-input">
              <Search size={18} />
              <input
                id="keyword"
                value={filters.query}
                onChange={(event) => updateFilter("query", event.target.value)}
                placeholder="Title, employer, skills, raw text"
              />
            </div>

            <div className="inline-controls">
              <label><input type="checkbox" checked={filters.exact} onChange={(event) => updateFilter("exact", event.target.checked)} /> Exact phrase</label>
              <label><input type="checkbox" checked={filters.includeRaw} onChange={(event) => updateFilter("includeRaw", event.target.checked)} /> Raw text</label>
            </div>

            <label className="field-label" htmlFor="employer-filter">Employer Contains</label>
            <input
              id="employer-filter"
              className="text-field"
              value={filters.employer}
              list="employer-options"
              onChange={(event) => updateFilter("employer", event.target.value)}
              placeholder="Type employer"
            />
            <datalist id="employer-options">
              {options.employers.map((employer) => <option key={employer} value={employer} />)}
            </datalist>

            <MultiSelect title="Location" values={options.locations} selected={filters.locations} onToggle={(value) => toggleArrayFilter("locations", value)} />
            <MultiSelect title="State" values={options.states} selected={filters.states} onToggle={(value) => toggleArrayFilter("states", value)} compact />

            <fieldset className="filter-group">
              <legend>Work Mode</legend>
              {(["remote", "hybrid", "in_person"] as WorkArrangement[]).map((mode) => (
                <label key={mode}>
                  <input type="checkbox" checked={filters.arrangements.includes(mode)} onChange={() => toggleArrayFilter("arrangements", mode)} />
                  {formatValue(mode)}
                </label>
              ))}
            </fieldset>

            <fieldset className="filter-group segmented">
              <legend>Pay Flag</legend>
              {(["any", "no", "yes"] as TriState[]).map((value) => (
                <button key={value} className={filters.unpaid === value ? "active" : ""} onClick={() => updateFilter("unpaid", value)}>
                  {value === "any" ? "Any" : value === "yes" ? "Unpaid" : "Paid/Unknown"}
                </button>
              ))}
            </fieldset>

            <fieldset className="filter-group segmented">
              <legend>Research</legend>
              {(["any", "yes", "no"] as TriState[]).map((value) => (
                <button key={value} className={filters.research === value ? "active" : ""} onClick={() => updateFilter("research", value)}>
                  {formatValue(value)}
                </button>
              ))}
            </fieldset>

            <label className="range-label">
              Min Confidence <span>{filters.minConfidence.toFixed(2)}</span>
              <input type="range" min="0" max="1" step="0.01" value={filters.minConfidence} onChange={(event) => updateFilter("minConfidence", Number(event.target.value))} />
            </label>

            <label className="check-row">
              <input type="checkbox" checked={filters.warningsOnly} onChange={(event) => updateFilter("warningsOnly", event.target.checked)} />
              Records with parser warnings
            </label>

            <button className="secondary wide" onClick={resetFilters}><RotateCcw size={16} /> Reset Filters</button>
          </aside>

          <section className="results-panel">
            <div className="toolbar">
              <div>
                <strong>{filteredJobs.length.toLocaleString()}</strong> results
                <span className="toolbar-subtext"> / {warningCount.toLocaleString()} with warnings / {selectedIds.size} selected</span>
              </div>
              <div className="toolbar-actions">
                <button onClick={saveSearch}><Save size={16} /> Save</button>
                <button onClick={() => downloadFile("filtered-jobs.json", JSON.stringify(filteredJobs, null, 2), "application/json")}><FileJson size={16} /> JSON</button>
                <button onClick={() => downloadFile("filtered-jobs.csv", toCsv(filteredJobs), "text/csv")}><Download size={16} /> CSV</button>
                <button onClick={() => copyRecords(selectedJobs.length ? selectedJobs : filteredJobs, selectedJobs.length ? "Selected records" : "Filtered results")}><Clipboard size={16} /> Copy</button>
                {sourceName !== DEFAULT_SOURCE_NAME && <button onClick={resetToDefaultData}><RotateCcw size={16} /> Demo Data</button>}
              </div>
            </div>

            {activeChips.length > 0 && (
              <div className="chips">
                {activeChips.map((chip) => (
                  <button key={chip} onClick={() => removeChip(chip, filters, setFilters)}>
                    {chip} <X size={14} />
                  </button>
                ))}
              </div>
            )}

            <div className="saved-row">
              <label>
                Saved searches
                <select value="" onChange={(event) => {
                  const found = savedSearches.find((item) => item.name === event.target.value);
                  if (found) applySavedSearch(found);
                }}>
                  <option value="">Choose saved search</option>
                  {savedSearches.map((search) => <option key={search.name} value={search.name}>{search.name}</option>)}
                </select>
              </label>

              <details className="columns-menu">
                <summary><SlidersHorizontal size={16} /> Columns</summary>
                <div>
                  {COLUMNS.map((column) => (
                    <label key={column.key}>
                      <input
                        type="checkbox"
                        checked={visibleColumns[column.key]}
                        onChange={(event) => setVisibleColumns((current) => ({ ...current, [column.key]: event.target.checked }))}
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              </details>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="select-col">
                      <input
                        aria-label="Select all visible records"
                        type="checkbox"
                        checked={filteredJobs.length > 0 && filteredJobs.every((job) => job.job_id && selectedIds.has(job.job_id))}
                        onChange={(event) => setSelectedIds(event.target.checked ? new Set(filteredJobs.map((job) => job.job_id).filter(Boolean) as string[]) : new Set())}
                      />
                    </th>
                    {visibleColumnDefs.map((column) => (
                      <th key={column.key}>
                        <button className="sort-button" onClick={() => isSortable(column.key) && toggleSort(column.key as SortKey)}>
                          {column.label} {sortKey === column.key ? (sortDir === "asc" ? "^" : "v") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr key={job.job_id ?? job.record_index} onDoubleClick={() => setActiveJob(job)}>
                      <td className="select-col" onClick={(event) => event.stopPropagation()}>
                        <input
                          aria-label={`Select ${job.job_title}`}
                          type="checkbox"
                          checked={Boolean(job.job_id && selectedIds.has(job.job_id))}
                          onChange={(event) => {
                            const next = new Set(selectedIds);
                            if (job.job_id && event.target.checked) next.add(job.job_id);
                            if (job.job_id && !event.target.checked) next.delete(job.job_id);
                            setSelectedIds(next);
                          }}
                        />
                      </td>
                      {visibleColumnDefs.map((column) => (
                        <td key={column.key} onClick={() => setActiveJob(job)}>{renderCell(job, column.key)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      ) : (
        <ImportView
          importText={importText}
          setImportText={setImportText}
          imported={imported}
          parseImportText={parseImportText}
          useImportedResults={useImportedResults}
          clearImportedData={clearImportedData}
          clearBrowserStorage={clearBrowserStorage}
        />
      )}

      {summary && <SummaryStrip summary={summary} />}
      {notice && <div className="toast"><Check size={16} /> {notice}</div>}
      {activeJob && <JobDrawer job={activeJob} onClose={() => setActiveJob(null)} onCopy={() => copyRecords([activeJob], "Record")} />}
    </div>
  );
}

function ImportView(props: {
  importText: string;
  setImportText: (value: string) => void;
  imported: { jobs: JobRecord[]; summary: ParserSummary } | null;
  parseImportText: () => void;
  useImportedResults: () => void;
  clearImportedData: () => void;
  clearBrowserStorage: () => void;
}) {
  const warnings = props.imported?.jobs.flatMap((job) => job.parser_warnings.map((warning) => `${job.job_id ?? job.record_index}: ${warning}`)) ?? [];
  return (
    <main className="import-layout">
      <section className="import-editor">
        <div className="panel-heading">
          <Import size={18} />
          <h2>Paste Raw Results</h2>
        </div>
        <div className="privacy-callout">
          <strong>Your data stays on your device.</strong>
          <p>Your pasted search results are processed locally in your browser. They are not uploaded, saved to a server, added to GitHub, or shared with anyone. If you choose to save dashboard settings in your browser, they stay in your browser storage and can be cleared at any time.</p>
        </div>
        <textarea
          value={props.importText}
          onChange={(event) => props.setImportText(event.target.value)}
          placeholder="Paste the raw Drexel co-op search result text here."
        />
        <div className="toolbar-actions">
          <button className="primary" onClick={props.parseImportText}>Parse Locally</button>
          {props.imported && <button onClick={props.useImportedResults}>Browse Parsed Results</button>}
          <button onClick={props.clearImportedData}><Trash2 size={16} /> Clear Imported Data</button>
          <button onClick={props.clearBrowserStorage}><Trash2 size={16} /> Clear Saved Browser Settings</button>
        </div>
        <p className="privacy-note">Exported JSON and CSV files are downloaded to your device only. They are not automatically published anywhere.</p>

        <details className="copy-instructions" open>
          <summary>How to copy your search results</summary>
          <ol>
            <li>Run your co-op job search in the school co-op search system.</li>
            <li>After clicking Search, go to the results page.</li>
            <li>Click into any job posting from the results.</li>
            <li>Click the green Return button to return to the results page.</li>
            <li>In the browser address bar, find the part of the URL that says <code>&amp;i_recs_per_page=99</code>.</li>
            <li>Change it to <code>&amp;i_recs_per_page=999</code>.</li>
            <li>Press Enter to reload the page.</li>
            <li>This should place many more results on one page.</li>
            <li>Press Command + A on Mac or Control + A on Windows to select the page content.</li>
            <li>Press Command + C on Mac or Control + C on Windows to copy the page content.</li>
            <li>Paste that copied content into this dashboard's import box.</li>
            <li>Click Parse Locally.</li>
            <li>The dashboard will create a searchable local database from the pasted text.</li>
          </ol>
        </details>
      </section>

      <section className="import-results">
        <h2>Import Summary</h2>
        {props.imported ? (
          <>
            <div className="metric-grid">
              <Metric label="Parsed Records" value={props.imported.jobs.length} />
              <Metric label="Detected Headers" value={props.imported.summary.detected_record_headers} />
              <Metric label="Listed Count" value={props.imported.summary.listed_record_count ?? "n/a"} />
              <Metric label="Warnings" value={warnings.length} />
              <Metric label="Skipped Lines" value={props.imported.summary.skipped_non_job_line_count ?? 0} />
            </div>
            <div className="toolbar-actions">
              <button onClick={() => downloadFile("imported-jobs.json", JSON.stringify(props.imported?.jobs ?? [], null, 2), "application/json")}><FileJson size={16} /> JSON</button>
              <button onClick={() => downloadFile("imported-jobs.csv", toCsv(props.imported?.jobs ?? []), "text/csv")}><Download size={16} /> CSV</button>
            </div>
            {props.imported.summary.parser_warnings && props.imported.summary.parser_warnings.length > 0 && (
              <div className="warning-list">
                <h3>Parser Summary Notes</h3>
                {props.imported.summary.parser_warnings.map((warning) => <p key={warning}>{warning}</p>)}
              </div>
            )}
            <div className="warning-list">
              <h3>Parser Warnings</h3>
              {warnings.slice(0, 80).map((warning) => <p key={warning}>{warning}</p>)}
              {warnings.length > 80 && <p>{warnings.length - 80} more warnings hidden.</p>}
            </div>
          </>
        ) : (
          <p className="muted">Paste raw search-result text and parse it to inspect records, warnings, and exports.</p>
        )}
      </section>
    </main>
  );
}

function MultiSelect(props: { title: string; values: string[]; selected: string[]; onToggle: (value: string) => void; compact?: boolean }) {
  return (
    <fieldset className={`filter-group ${props.compact ? "compact-options" : ""}`}>
      <legend>{props.title}</legend>
      <div className="option-list">
        {props.values.map((value) => (
          <label key={value}>
            <input type="checkbox" checked={props.selected.includes(value)} onChange={() => props.onToggle(value)} />
            {value}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function JobDrawer(props: { job: JobRecord; onClose: () => void; onCopy: () => void }) {
  const job = props.job;
  const structured = Object.entries(job).filter(([key]) => !["raw_text_block", "parsed_fields"].includes(key));
  return (
    <div className="drawer-backdrop" onClick={props.onClose}>
      <aside className="job-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h2>{job.job_title}</h2>
            <p>{job.employer_name} / {job.general_job_location}</p>
          </div>
          <button aria-label="Close detail view" onClick={props.onClose}><X size={18} /></button>
        </div>
        <div className="drawer-actions">
          <button onClick={props.onCopy}><Clipboard size={16} /> Copy Record</button>
          <button onClick={() => downloadFile(`${job.job_id ?? "job"}.json`, JSON.stringify(job, null, 2), "application/json")}><FileJson size={16} /> Export JSON</button>
        </div>
        <section className="detail-section">
          <h3>Structured Fields</h3>
          <dl>
            {structured.map(([key, value]) => (
              <div key={key}>
                <dt>{labelize(key)}</dt>
                <dd>{renderDetailValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="detail-section">
          <h3>Raw Text</h3>
          <pre>{job.raw_text_block}</pre>
        </section>
      </aside>
    </div>
  );
}

function SummaryStrip({ summary }: { summary: ParserSummary }) {
  return (
    <footer className="summary-strip">
      <Metric label="Parsed" value={summary.parsed_record_count} />
      <Metric label="Detected Headers" value={summary.detected_record_headers} />
      <Metric label="Source Count" value={summary.listed_record_count ?? "n/a"} />
      <Metric label="Skipped Lines" value={summary.skipped_non_job_line_count ?? 0} />
      <Metric label="Count Match" value={summary.record_count_matches_listing === null ? "n/a" : summary.record_count_matches_listing ? "yes" : "no"} />
    </footer>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{typeof value === "number" ? value.toLocaleString() : value}</strong>
    </div>
  );
}

function matchesFilters(job: JobRecord, filters: Filters): boolean {
  if (filters.query) {
    const haystack = searchableText(job, filters.includeRaw);
    const needle = filters.query.trim().toLowerCase();
    if (filters.exact ? !haystack.includes(needle) : !needle.split(/\s+/).every((part) => haystack.includes(part))) return false;
  }
  if (filters.locations.length && !filters.locations.includes(job.general_job_location ?? "")) return false;
  if (filters.states.length && !filters.states.includes(job.state ?? "")) return false;
  if (filters.arrangements.length && !filters.arrangements.includes(job.work_arrangement)) return false;
  if (filters.employer && !(job.employer_name ?? "").toLowerCase().includes(filters.employer.toLowerCase())) return false;
  if (filters.unpaid === "yes" && job.unpaid_position !== true) return false;
  if (filters.unpaid === "no" && job.unpaid_position === true) return false;
  if (filters.research === "yes" && job.research_position !== true) return false;
  if (filters.research === "no" && job.research_position === true) return false;
  if (filters.warningsOnly && job.parser_warnings.length === 0) return false;
  if (job.parser_confidence < filters.minConfidence) return false;
  return true;
}

function searchableText(job: JobRecord, includeRaw: boolean): string {
  const clone = includeRaw ? job : { ...job, raw_text_block: "" };
  return JSON.stringify(clone).toLowerCase();
}

function compareJobs(a: JobRecord, b: JobRecord, key: SortKey, dir: SortDir): number {
  const left = a[key] ?? "";
  const right = b[key] ?? "";
  const multiplier = dir === "asc" ? 1 : -1;
  if (typeof left === "number" && typeof right === "number") return (left - right) * multiplier;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * multiplier;
}

function renderCell(job: JobRecord, key: keyof JobRecord) {
  const value = job[key];
  if (key === "job_title") return <span className="title-cell">{job.job_title}</span>;
  if (key === "work_arrangement") return <span className={`pill ${job.work_arrangement}`}>{formatValue(job.work_arrangement)}</span>;
  if (key === "parser_confidence") return <span>{Math.round(job.parser_confidence * 100)}%</span>;
  if (key === "parser_warnings") return job.parser_warnings.length ? <span className="warning-pill">{job.parser_warnings.length}</span> : <span className="muted">0</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join("; ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return value ? String(value) : <span className="muted">-</span>;
}

function renderDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return <span className="muted">Not available</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.join("\n") : <span className="muted">None</span>;
  if (typeof value === "object") return <pre>{JSON.stringify(value, null, 2)}</pre>;
  return String(value);
}

function isSortable(key: keyof JobRecord): boolean {
  return ["job_title", "employer_name", "general_job_location", "application_deadline", "compensation", "parser_confidence", "record_index"].includes(key);
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

function formatValue(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function labelize(value: string): string {
  return formatValue(value);
}

function buildFilterChips(filters: Filters): string[] {
  const chips: string[] = [];
  if (filters.query) chips.push(`Search: ${filters.query}`);
  if (filters.exact) chips.push("Exact phrase");
  if (!filters.includeRaw) chips.push("Raw text off");
  filters.locations.forEach((value) => chips.push(`Location: ${value}`));
  filters.states.forEach((value) => chips.push(`State: ${value}`));
  filters.arrangements.forEach((value) => chips.push(`Mode: ${formatValue(value)}`));
  if (filters.employer) chips.push(`Employer: ${filters.employer}`);
  if (filters.unpaid !== "any") chips.push(filters.unpaid === "yes" ? "Unpaid" : "Paid/Unknown");
  if (filters.research !== "any") chips.push(filters.research === "yes" ? "Research" : "Not research");
  if (filters.warningsOnly) chips.push("Warnings only");
  if (filters.minConfidence > 0) chips.push(`Confidence >= ${filters.minConfidence.toFixed(2)}`);
  return chips;
}

function removeChip(chip: string, filters: Filters, setFilters: (filters: Filters) => void) {
  const next = { ...filters };
  if (chip.startsWith("Search:")) next.query = "";
  else if (chip === "Exact phrase") next.exact = false;
  else if (chip === "Raw text off") next.includeRaw = true;
  else if (chip.startsWith("Location: ")) next.locations = next.locations.filter((value) => `Location: ${value}` !== chip);
  else if (chip.startsWith("State: ")) next.states = next.states.filter((value) => `State: ${value}` !== chip);
  else if (chip.startsWith("Mode: ")) next.arrangements = next.arrangements.filter((value) => `Mode: ${formatValue(value)}` !== chip);
  else if (chip.startsWith("Employer: ")) next.employer = "";
  else if (chip === "Unpaid" || chip === "Paid/Unknown") next.unpaid = "any";
  else if (chip === "Research" || chip === "Not research") next.research = "any";
  else if (chip === "Warnings only") next.warningsOnly = false;
  else if (chip.startsWith("Confidence")) next.minConfidence = 0;
  setFilters(next);
}

function readFiltersFromUrl(): Filters {
  const params = new URLSearchParams(window.location.search);
  return {
    ...DEFAULT_FILTERS,
    query: params.get("q") ?? "",
    exact: params.get("exact") === "1",
    includeRaw: params.get("raw") !== "0",
    locations: splitParam(params.get("loc")),
    states: splitParam(params.get("state")),
    arrangements: splitParam(params.get("mode")) as WorkArrangement[],
    employer: params.get("employer") ?? "",
    unpaid: (params.get("unpaid") as TriState) || "any",
    research: (params.get("research") as TriState) || "any",
    warningsOnly: params.get("warnings") === "1",
    minConfidence: Number(params.get("conf") ?? 0)
  };
}

function splitParam(value: string | null): string[] {
  return value ? value.split("|").filter(Boolean) : [];
}

function readSavedSearches(): SavedSearch[] {
  try {
    return JSON.parse(localStorage.getItem("coop-dashboard-saved-searches") ?? "[]") as SavedSearch[];
  } catch {
    return [];
  }
}

export default App;
