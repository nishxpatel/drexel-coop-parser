import { useEffect, useMemo, useState } from "react";
import type { ClipboardEvent, FormEvent } from "react";
import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  FileJson,
  Filter,
  Heart,
  Home,
  Import,
  Moon,
  RotateCcw,
  Save,
  Search,
  Shield,
  SlidersHorizontal,
  SkipForward,
  Sun,
  TableProperties,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import type { JobRecord, ParserSummary, WorkArrangement } from "./types";
import { parseClipboardDocument, toCsv } from "./lib/parser";

type View = "home" | "dashboard" | "import" | "privacy" | "swipe";
type Theme = "dark" | "light";
type SortKey = "job_title" | "employer_name" | "general_job_location" | "work_arrangement" | "isUnpaid" | "job_id" | "record_index";
type SortDir = "asc" | "desc";
type TriState = "any" | "yes" | "no";
type SwipeChoice = "like" | "dislike" | "skip";

interface SwipeHistoryItem {
  jobKey: string;
  previousChoice?: SwipeChoice;
}

interface Filters {
  query: string;
  exact: boolean;
  includeRaw: boolean;
  locations: string[];
  states: string[];
  arrangements: WorkArrangement[];
  employer: string;
  unpaid: TriState;
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
  unpaid: "any"
};

const COLUMNS: ColumnDef[] = [
  { key: "job_id", label: "Posting ID", defaultVisible: true },
  { key: "job_title", label: "Title", defaultVisible: true },
  { key: "detailUrl", label: "Full Posting", defaultVisible: true },
  { key: "employer_name", label: "Employer", defaultVisible: true },
  { key: "general_job_location", label: "Location", defaultVisible: true },
  { key: "work_arrangement", label: "Mode", defaultVisible: true },
  { key: "isUnpaid", label: "Unpaid Status", defaultVisible: true },
  { key: "city", label: "City", defaultVisible: false },
  { key: "state", label: "State", defaultVisible: false },
  { key: "search_result_summary", label: "Summary Text", defaultVisible: false }
];

const DEFAULT_COLUMNS = Object.fromEntries(COLUMNS.map((column) => [column.key, column.defaultVisible])) as Record<string, boolean>;
const DEFAULT_SOURCE_NAME = "safe demo data";

function App() {
  const [view, setView] = useState<View>("home");
  const [theme, setTheme] = useState<Theme>(() => readTheme());
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
  const [importHtml, setImportHtml] = useState("");
  const [imported, setImported] = useState<{ jobs: JobRecord[]; summary: ParserSummary } | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>(() => readSavedSearches());
  const [swipeChoices, setSwipeChoices] = useState<Record<string, SwipeChoice>>(() => readSwipeChoices());
  const [swipeHistory, setSwipeHistory] = useState<SwipeHistoryItem[]>([]);
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
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("coop-dashboard-theme", theme);
    } catch {
      // Theme still applies for the current tab if browser storage is unavailable.
    }
  }, [theme]);

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
    if (sortKey !== "record_index") params.set("sort", sortKey);
    if (sortDir !== "asc") params.set("dir", sortDir);
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [filters, sortKey, sortDir]);

  useEffect(() => {
    localStorage.setItem("coop-dashboard-columns", JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    localStorage.setItem("coop-dashboard-swipe-choices", JSON.stringify(swipeChoices));
  }, [swipeChoices]);

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
  const likedJobs = jobs.filter((job) => swipeChoices[stableJobKey(job)] === "like");
  const dislikedJobs = jobs.filter((job) => swipeChoices[stableJobKey(job)] === "dislike");
  const swipeDeck = filteredJobs.filter((job) => !swipeChoices[stableJobKey(job)]);

  useEffect(() => {
    if (view !== "swipe") return;
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        chooseSwipe("like");
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        chooseSwipe("dislike");
      } else if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") {
        event.preventDefault();
        chooseSwipe("skip");
      } else if (event.key === "Backspace" || event.key.toLowerCase() === "u") {
        event.preventDefault();
        undoSwipe();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, swipeDeck, swipeChoices, swipeHistory]);

  function chooseSwipe(choice: SwipeChoice) {
    const job = swipeDeck[0];
    if (!job) return;
    const jobKey = stableJobKey(job);
    setSwipeHistory((current) => [...current, { jobKey, previousChoice: swipeChoices[jobKey] }]);
    setSwipeChoices((current) => ({ ...current, [jobKey]: choice }));
  }

  function undoSwipe() {
    const last = swipeHistory.at(-1);
    if (!last) return;
    setSwipeHistory((current) => current.slice(0, -1));
    setSwipeChoices((current) => {
      const next = { ...current };
      if (last.previousChoice) next[last.jobKey] = last.previousChoice;
      else delete next[last.jobKey];
      return next;
    });
  }

  function setSwipeChoice(job: JobRecord, choice: SwipeChoice) {
    const jobKey = stableJobKey(job);
    setSwipeHistory((current) => [...current, { jobKey, previousChoice: swipeChoices[jobKey] }]);
    setSwipeChoices((current) => ({ ...current, [jobKey]: choice }));
  }

  function removeSwipeChoice(job: JobRecord) {
    const jobKey = stableJobKey(job);
    setSwipeHistory((current) => [...current, { jobKey, previousChoice: swipeChoices[jobKey] }]);
    setSwipeChoices((current) => {
      const next = { ...current };
      delete next[jobKey];
      return next;
    });
  }

  function resetFilteredSwipeChoices() {
    if (!window.confirm("Reset swipe choices for the currently filtered jobs?")) return;
    const filteredKeys = new Set(filteredJobs.map(stableJobKey));
    setSwipeChoices((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !filteredKeys.has(key))));
    setSwipeHistory([]);
    flash("Filtered swipe choices reset");
  }

  function resetAllSwipeChoices() {
    if (!window.confirm("Clear all liked, disliked, and skipped jobs saved in this browser?")) return;
    setSwipeChoices({});
    setSwipeHistory([]);
    flash("All swipe choices cleared");
  }
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
    const parsed = parseClipboardDocument({ text: importText, html: importHtml }, { sourceFile: "browser-paste" });
    const linkCount = parsed.jobs.filter((job) => job.detailUrl).length;
    setImported({ jobs: parsed.jobs, summary: parsed.summary });
    setJobs(parsed.jobs);
    setSummary(parsed.summary);
    setSourceName("browser paste");
    setView("dashboard");
    resetFilters();
    flash(linkCount ? `Parsed ${parsed.jobs.length.toLocaleString()} records with ${linkCount.toLocaleString()} posting links` : `Parsed ${parsed.jobs.length.toLocaleString()} records; no posting links detected`);
  }

  function clearImportedData() {
    setImportText("");
    setImportHtml("");
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

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  async function copyRecords(records: JobRecord[], label: string) {
    await navigator.clipboard.writeText(JSON.stringify(records, null, 2));
    flash(`${label} copied`);
  }

  async function copyReadableRecords(records: JobRecord[], label: string) {
    await navigator.clipboard.writeText(formatReadableJobList(records));
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
          <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>
            <Home size={17} /> Home
          </button>
          <button className={view === "import" ? "active" : ""} onClick={() => setView("import")}>
            <Import size={17} /> Import
          </button>
          <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
            <TableProperties size={17} /> Dashboard
          </button>
          <button className={view === "swipe" ? "active" : ""} onClick={() => setView("swipe")}>
            <Heart size={17} /> Swipe Mode
          </button>
          <button className={view === "privacy" ? "active" : ""} onClick={() => setView("privacy")}>
            <Shield size={17} /> Privacy
          </button>
          <button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </nav>
      </header>

      {view === "home" ? (
        <HomeView
          jobCount={jobs.length}
          onImport={() => setView("import")}
          onDashboard={() => setView("dashboard")}
          onPrivacy={() => setView("privacy")}
        />
      ) : view === "dashboard" ? (
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
                placeholder="Title, employer, location, posting text"
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
              <legend>Unpaid Status</legend>
              {(["any", "no", "yes"] as TriState[]).map((value) => (
                <button key={value} className={filters.unpaid === value ? "active" : ""} onClick={() => updateFilter("unpaid", value)}>
                  {value === "any" ? "All" : value === "yes" ? "Unpaid" : "Paid or not marked unpaid"}
                </button>
              ))}
            </fieldset>

            <button className="secondary wide" onClick={resetFilters}><RotateCcw size={16} /> Reset Filters</button>
          </aside>

          <section className="results-panel">
            <div className="toolbar">
              <div>
                <strong>{filteredJobs.length.toLocaleString()}</strong> results
                <span className="toolbar-subtext"> / {selectedIds.size} selected</span>
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
            {summary && <ParsingDetails summary={summary} jobs={jobs} />}
          </section>
        </main>
      ) : view === "swipe" ? (
        <SwipeView
          filteredJobs={filteredJobs}
          deck={swipeDeck}
          likedJobs={likedJobs}
          dislikedJobs={dislikedJobs}
          choices={swipeChoices}
          activeChips={activeChips}
          canUndo={swipeHistory.length > 0}
          onLike={() => chooseSwipe("like")}
          onDislike={() => chooseSwipe("dislike")}
          onSkip={() => chooseSwipe("skip")}
          onUndo={undoSwipe}
          onResetFiltered={resetFilteredSwipeChoices}
          onResetAll={resetAllSwipeChoices}
          onMove={setSwipeChoice}
          onRemove={removeSwipeChoice}
          onDashboard={() => setView("dashboard")}
          onOpenJob={setActiveJob}
          onCopyReadable={(records, label) => copyReadableRecords(records, label)}
        />
      ) : view === "import" ? (
        <ImportView
          importText={importText}
          setImportText={setImportText}
          importHtml={importHtml}
          setImportHtml={setImportHtml}
          imported={imported}
          parseImportText={parseImportText}
          clearImportedData={clearImportedData}
          clearBrowserStorage={clearBrowserStorage}
        />
      ) : (
        <PrivacyView onImport={() => setView("import")} />
      )}

      {notice && <div className="toast"><Check size={16} /> {notice}</div>}
      {activeJob && <JobDrawer job={activeJob} onClose={() => setActiveJob(null)} onCopy={() => copyRecords([activeJob], "Record")} />}
    </div>
  );
}

function HomeView(props: { jobCount: number; onImport: () => void; onDashboard: () => void; onPrivacy: () => void }) {
  return (
    <main className="home-page">
      <section className="hero-section">
        <div className="hero-copy">
          <span className="eyebrow">Browser-only co-op search helper</span>
          <h2>Turn copied co-op search results into a private searchable dashboard.</h2>
          <p>
            Paste the visible search results page from your school co-op system. This tool turns the messy page copy into a focused job list you can search, filter, sort, copy, and export. When rich clipboard links are available, it keeps links to full postings too.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={props.onImport}><Import size={17} /> Paste Results</button>
            <button onClick={props.onDashboard}><TableProperties size={17} /> View Demo Dashboard</button>
            <button onClick={props.onPrivacy}><Shield size={17} /> Privacy Details</button>
          </div>
        </div>
        <div className="hero-panel">
          <Metric label="Demo Records" value={props.jobCount} />
          <Metric label="Backend Servers" value="0" />
          <Metric label="Uploads" value="none" />
          <Metric label="Default Theme" value="dark" />
        </div>
      </section>

      <section className="info-grid" aria-label="Overview">
        <article>
          <h3>Who It Is For</h3>
          <p>Students comparing many co-op postings after running a search in the school co-op system.</p>
        </article>
        <article>
          <h3>What It Solves</h3>
          <p>Long copied result pages are hard to scan. The dashboard separates postings and makes them searchable.</p>
        </article>
        <article>
          <h3>What You Can Do</h3>
          <p>Search keywords, filter useful search-result fields, open captured full-posting links, inspect raw pasted text, copy records, and export JSON or CSV files.</p>
        </article>
      </section>

      <section className="content-band">
        <h2>How It Works</h2>
        <div className="steps-grid">
          <article>
            <span>1</span>
            <h3>Copy Results</h3>
            <p>Copy the search results page from the co-op system after increasing results per page.</p>
          </article>
          <article>
            <span>2</span>
            <h3>Paste Locally</h3>
            <p>Paste the copied page content into this website. Rich paste may preserve full-posting links when the browser includes them.</p>
          </article>
          <article>
            <span>3</span>
            <h3>Search Privately</h3>
            <p>Browse the parsed search-result rows, export files to your device, and clear imported data when done.</p>
          </article>
        </div>
      </section>

      <section className="content-band">
        <CopyInstructions />
      </section>

      <section className="content-band privacy-band">
        <h2>Privacy</h2>
        <p>Your pasted search results are processed locally in your browser. They are not uploaded, hosted, saved to GitHub, committed to the repository, or shared with anyone.</p>
        <p>Saved searches and column settings use browser localStorage only. They stay on your device and can be cleared from the Import page.</p>
        <button className="primary" onClick={props.onImport}><Import size={17} /> Start With Your Results</button>
      </section>
    </main>
  );
}

function SwipeView(props: {
  filteredJobs: JobRecord[];
  deck: JobRecord[];
  likedJobs: JobRecord[];
  dislikedJobs: JobRecord[];
  choices: Record<string, SwipeChoice>;
  activeChips: string[];
  canUndo: boolean;
  onLike: () => void;
  onDislike: () => void;
  onSkip: () => void;
  onUndo: () => void;
  onResetFiltered: () => void;
  onResetAll: () => void;
  onMove: (job: JobRecord, choice: SwipeChoice) => void;
  onRemove: (job: JobRecord) => void;
  onDashboard: () => void;
  onOpenJob: (job: JobRecord) => void;
  onCopyReadable: (records: JobRecord[], label: string) => void;
}) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragX, setDragX] = useState(0);
  const currentJob = props.deck[0] ?? null;
  const reviewedInFilter = props.filteredJobs.length - props.deck.length;
  const currentPosition = currentJob ? reviewedInFilter + 1 : props.filteredJobs.length;
  const skippedCount = props.filteredJobs.filter((job) => props.choices[stableJobKey(job)] === "skip").length;

  function finishDrag() {
    if (dragX > 110) props.onLike();
    else if (dragX < -110) props.onDislike();
    setDragStart(null);
    setDragX(0);
  }

  return (
    <main className="swipe-page">
      <section className="swipe-main">
        <div className="swipe-header">
          <div>
            <span className="eyebrow">Quick review</span>
            <h2>Swipe Mode</h2>
            <p>Showing {currentPosition.toLocaleString()} of {props.filteredJobs.length.toLocaleString()} filtered jobs / {props.deck.length.toLocaleString()} remaining</p>
          </div>
          <div className="toolbar-actions">
            <button onClick={props.onDashboard}><TableProperties size={16} /> Edit Filters</button>
            <button onClick={props.onUndo} disabled={!props.canUndo}><Undo2 size={16} /> Undo</button>
          </div>
        </div>

        {props.activeChips.length > 0 && (
          <div className="chips">
            {props.activeChips.map((chip) => <span className="chip-static" key={chip}>{chip}</span>)}
          </div>
        )}

        <div className="swipe-card-stage">
          {currentJob ? (
            <article
              className="swipe-card"
              style={{ transform: `translateX(${dragX}px) rotate(${dragX / 24}deg)` }}
              onPointerDown={(event) => setDragStart(event.clientX)}
              onPointerMove={(event) => {
                if (dragStart !== null) setDragX(event.clientX - dragStart);
              }}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              <div className="swipe-card-topline">
                <span>Posting {currentJob.job_id ?? currentJob.record_index}</span>
                {currentJob.detailUrl && <a className="inline-link" href={currentJob.detailUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>View full posting</a>}
              </div>
              <h3>{currentJob.job_title ?? "Untitled posting"}</h3>
              <h4>{currentJob.employer_name ?? "Unknown employer"}</h4>
              <div className="swipe-facts">
                <span>{formatUnpaidStatus(currentJob.isUnpaid)}</span>
                {currentJob.general_job_location && <span>{currentJob.general_job_location}</span>}
                {currentJob.work_arrangement !== "unknown" && <span>{formatValue(currentJob.work_arrangement)}</span>}
              </div>
              {currentJob.search_result_summary && <p>{currentJob.search_result_summary}</p>}
              <button className="secondary" onClick={() => props.onOpenJob(currentJob)}>Open Details</button>
            </article>
          ) : (
            <div className="swipe-empty">
              <h3>No more jobs to review</h3>
              <p>{props.filteredJobs.length ? "All currently filtered jobs have been liked, disliked, or skipped." : "No jobs match the current dashboard filters."}</p>
              <div className="toolbar-actions">
                <button onClick={props.onResetFiltered}><RotateCcw size={16} /> Reset Filtered Deck</button>
                <button onClick={props.onDashboard}><TableProperties size={16} /> Return to Dashboard</button>
              </div>
            </div>
          )}
        </div>

        <div className="swipe-actions" aria-label="Swipe actions">
          <button className="dislike-action" onClick={props.onDislike} disabled={!currentJob}><X size={18} /> Dislike</button>
          <button onClick={props.onSkip} disabled={!currentJob}><SkipForward size={18} /> Skip</button>
          <button className="like-action" onClick={props.onLike} disabled={!currentJob}><Heart size={18} /> Like</button>
        </div>
        <p className="privacy-note">Keyboard: Right arrow likes, left arrow dislikes, down arrow or S skips, U or Backspace undoes.</p>
        <p className="privacy-note">Your liked and disliked jobs are saved only in your browser and can be cleared at any time.</p>
      </section>

      <aside className="swipe-side">
        <div className="swipe-stats">
          <Metric label="Liked" value={props.likedJobs.length} />
          <Metric label="Disliked" value={props.dislikedJobs.length} />
          <Metric label="Skipped In Filter" value={skippedCount} />
        </div>
        <div className="toolbar-actions swipe-reset-actions">
          <button onClick={props.onResetFiltered}><RotateCcw size={16} /> Reset Filtered Deck</button>
          <button onClick={props.onResetAll}><Trash2 size={16} /> Clear All Choices</button>
        </div>

        <SwipeList
          title="Liked Jobs"
          jobs={props.likedJobs}
          emptyText="No liked jobs yet."
          otherActionLabel="Move to Dislike"
          otherChoice="dislike"
          onMove={props.onMove}
          onRemove={props.onRemove}
          onOpenJob={props.onOpenJob}
        />
        <div className="toolbar-actions swipe-export-actions">
          <button onClick={() => downloadFile("liked-jobs.json", JSON.stringify(props.likedJobs, null, 2), "application/json")} disabled={!props.likedJobs.length}><FileJson size={16} /> Liked JSON</button>
          <button onClick={() => downloadFile("liked-jobs.csv", toCsv(props.likedJobs), "text/csv")} disabled={!props.likedJobs.length}><Download size={16} /> Liked CSV</button>
          <button onClick={() => props.onCopyReadable(props.likedJobs, "Liked jobs")} disabled={!props.likedJobs.length}><Clipboard size={16} /> Copy Liked</button>
        </div>

        <SwipeList
          title="Disliked Jobs"
          jobs={props.dislikedJobs}
          emptyText="No disliked jobs yet."
          otherActionLabel="Move to Like"
          otherChoice="like"
          onMove={props.onMove}
          onRemove={props.onRemove}
          onOpenJob={props.onOpenJob}
        />
        <div className="toolbar-actions swipe-export-actions">
          <button onClick={() => downloadFile("disliked-jobs.json", JSON.stringify(props.dislikedJobs, null, 2), "application/json")} disabled={!props.dislikedJobs.length}><FileJson size={16} /> Disliked JSON</button>
          <button onClick={() => downloadFile("disliked-jobs.csv", toCsv(props.dislikedJobs), "text/csv")} disabled={!props.dislikedJobs.length}><Download size={16} /> Disliked CSV</button>
        </div>
      </aside>
    </main>
  );
}

function SwipeList(props: {
  title: string;
  jobs: JobRecord[];
  emptyText: string;
  otherActionLabel: string;
  otherChoice: SwipeChoice;
  onMove: (job: JobRecord, choice: SwipeChoice) => void;
  onRemove: (job: JobRecord) => void;
  onOpenJob: (job: JobRecord) => void;
}) {
  return (
    <section className="swipe-list">
      <h3>{props.title}</h3>
      {props.jobs.length ? props.jobs.map((job) => (
        <article key={stableJobKey(job)}>
          <button className="link-button" onClick={() => props.onOpenJob(job)}>{job.job_title ?? "Untitled posting"}</button>
          <p>{job.employer_name ?? "Unknown employer"} / {job.general_job_location ?? "No location"} / {job.job_id ?? "No ID"} / {formatUnpaidStatus(job.isUnpaid)}</p>
          <div className="toolbar-actions">
            {job.detailUrl && <a className="button-link" href={job.detailUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Posting</a>}
            <button onClick={() => props.onMove(job, props.otherChoice)}>{props.otherActionLabel}</button>
            <button onClick={() => props.onRemove(job)}><X size={15} /> Remove</button>
          </div>
        </article>
      )) : <p className="muted">{props.emptyText}</p>}
    </section>
  );
}

function ImportView(props: {
  importText: string;
  setImportText: (value: string) => void;
  importHtml: string;
  setImportHtml: (value: string) => void;
  imported: { jobs: JobRecord[]; summary: ParserSummary } | null;
  parseImportText: () => void;
  clearImportedData: () => void;
  clearBrowserStorage: () => void;
}) {
  const warnings = props.imported?.jobs.flatMap((job) => job.parser_warnings.map((warning) => `${job.job_id ?? job.record_index}: ${warning}`)) ?? [];
  const linkCount = props.imported?.jobs.filter((job) => job.detailUrl).length ?? 0;
  return (
    <main className="import-layout">
      <section className="import-editor">
        <div className="panel-heading">
          <Import size={18} />
          <h2>Paste Search Results</h2>
        </div>
        <div className="privacy-callout">
          <strong>Your data stays on your device.</strong>
          <p>Your pasted search results are processed locally in your browser. They are not uploaded, saved to a server, added to GitHub, or shared with anyone. If your browser includes rich clipboard data, the parser will also try to keep links to full postings.</p>
        </div>
        <div className="toolbar-actions import-actions-top">
          <button className="primary" onClick={props.parseImportText}>Parse Locally</button>
          <button onClick={props.clearImportedData}><Trash2 size={16} /> Clear Imported Data</button>
          <button onClick={props.clearBrowserStorage}><Trash2 size={16} /> Clear Saved Browser Settings</button>
        </div>
        <RichPasteBox
          text={props.importText}
          setText={props.setImportText}
          setHtml={props.setImportHtml}
        />
        <div className="toolbar-actions import-actions-bottom">
          <button className="primary" onClick={props.parseImportText}>Parse Locally</button>
          <button onClick={props.clearImportedData}><Trash2 size={16} /> Clear Imported Data</button>
          <button onClick={props.clearBrowserStorage}><Trash2 size={16} /> Clear Saved Browser Settings</button>
        </div>
        <p className="privacy-note">Exported JSON and CSV files are downloaded to your device only. They are not automatically published anywhere.</p>

        <CopyInstructions />
      </section>

      <section className="import-results">
        <h2>After Parsing</h2>
        {props.imported ? (
          <>
            <p className="muted">Parsed results open in the dashboard automatically. Use the export buttons here if you want a local copy.</p>
            <p className="privacy-note">{linkCount ? `${linkCount.toLocaleString()} full-posting link(s) were detected.` : "No full-posting links were detected. Link capture depends on whether the browser and source page include links in copied content."}</p>
            <div className="toolbar-actions">
              <button onClick={() => downloadFile("imported-jobs.json", JSON.stringify(props.imported?.jobs ?? [], null, 2), "application/json")}><FileJson size={16} /> JSON</button>
              <button onClick={() => downloadFile("imported-jobs.csv", toCsv(props.imported?.jobs ?? []), "text/csv")}><Download size={16} /> CSV</button>
            </div>
            <ParsingDetails summary={props.imported.summary} jobs={props.imported.jobs} warnings={warnings} />
          </>
        ) : (
          <p className="muted">Paste raw search-result text and click Parse Locally. Parsed records will open in the dashboard automatically.</p>
        )}
      </section>
    </main>
  );
}

function RichPasteBox(props: { text: string; setText: (value: string) => void; setHtml: (value: string) => void }) {
  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    if (!html && !text) return;
    event.preventDefault();
    props.setHtml(html);
    props.setText(text);
  }

  function handleInput(event: FormEvent<HTMLDivElement>) {
    props.setText(event.currentTarget.innerText);
    props.setHtml("");
  }

  return (
    <div
      className={`rich-paste-box ${props.text ? "" : "empty"}`}
      contentEditable
      data-placeholder="Paste copied co-op search results here. Rich paste may preserve full-posting links when your browser provides them."
      role="textbox"
      aria-label="Paste co-op search results"
      suppressContentEditableWarning
      onPaste={handlePaste}
      onInput={handleInput}
    >
      {props.text}
    </div>
  );
}

function CopyInstructions() {
  return (
    <details className="copy-instructions" open>
      <summary>How to copy your search results</summary>
      <ol>
        <li>Run your co-op job search in the school co-op search system.</li>
        <li>After clicking Search, go to the results page.</li>
        <li>Click into any job posting from the results.</li>
        <li>Click the green Return button to return to the results page.</li>
        <li>In the browser address bar, look near the end of the URL for the part that says <code>&amp;i_recs_per_page=</code> followed by a number.</li>
        <li>It may say <code>&amp;i_recs_per_page=99</code>, but the number may be different.</li>
        <li>Change that part so it says <code>&amp;i_recs_per_page=999</code>, then press Enter to reload the page.</li>
        <li>This helps put more results on one page before copying.</li>
        <li>Press Command + A on Mac or Control + A on Windows to select the page content.</li>
        <li>Press Command + C on Mac or Control + C on Windows to copy the page content.</li>
        <li>Paste that copied content into the website's import box.</li>
        <li>If the browser provides rich clipboard data, the dashboard may also capture links to full postings.</li>
        <li>Click Parse Locally.</li>
        <li>The dashboard will create a searchable local database from the pasted content.</li>
      </ol>
    </details>
  );
}

function PrivacyView({ onImport }: { onImport: () => void }) {
  return (
    <main className="privacy-page">
      <section className="content-band privacy-band">
        <h2>Privacy Promise</h2>
        <p>Your pasted co-op search results are processed locally in your browser. This site does not upload your pasted text, parsed job records, exported files, or imported database to any server.</p>
        <p>The GitHub Pages site hosts only the static application code and fake demo data. Your imported data is not added to GitHub, not hosted on GitHub Pages, and not shared with anyone.</p>
        <p>Saved searches, column settings, and theme preference use localStorage. That storage belongs to your browser on your device and can be cleared from the Import page.</p>
        <button className="primary" onClick={onImport}><Import size={17} /> Go to Import</button>
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
  const structured = detailEntries(job);
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
          {job.detailUrl && <a className="button-link" href={job.detailUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> View Full Posting</a>}
          <button onClick={() => downloadFile(`${job.job_id ?? "job"}.json`, JSON.stringify(job, null, 2), "application/json")}><FileJson size={16} /> Export JSON</button>
        </div>
        <section className="detail-section">
          <h3>Available Fields</h3>
          <dl>
            {structured.map(([key, value]) => (
              <div key={key}>
                <dt>{labelize(key)}</dt>
                <dd>{key === "detailUrl" && typeof value === "string" ? <a className="inline-link" href={value} target="_blank" rel="noreferrer">View full posting</a> : renderDetailValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="detail-section">
          <details className="raw-text-details">
            <summary>Raw text from pasted results</summary>
            <pre>{job.raw_text_block}</pre>
          </details>
        </section>
        <section className="detail-section">
          <details className="raw-text-details">
            <summary>Parsing details</summary>
            <dl>
              <div>
                <dt>Parser Confidence</dt>
                <dd>{Math.round(job.parser_confidence * 100)}%</dd>
              </div>
              {job.parser_warnings.length > 0 && (
                <div>
                  <dt>Parser Warnings</dt>
                  <dd>{job.parser_warnings.join("\n")}</dd>
                </div>
              )}
            </dl>
          </details>
        </section>
      </aside>
    </div>
  );
}

function ParsingDetails({ summary, jobs, warnings }: { summary: ParserSummary; jobs: JobRecord[]; warnings?: string[] }) {
  const allWarnings = warnings ?? jobs.flatMap((job) => job.parser_warnings.map((warning) => `${job.job_id ?? job.record_index}: ${warning}`));
  const linkCount = jobs.filter((job) => job.detailUrl).length;
  return (
    <details className="parsing-details">
      <summary>Parsing details</summary>
      <div className="metric-grid">
        <Metric label="Parsed Records" value={summary.parsed_record_count} />
        <Metric label="Detected Headers" value={summary.detected_record_headers} />
        <Metric label="Source Count" value={summary.listed_record_count ?? "n/a"} />
        <Metric label="Posting Links" value={linkCount} />
        <Metric label="Skipped Lines" value={summary.skipped_non_job_line_count ?? 0} />
      </div>
      {summary.parser_warnings && summary.parser_warnings.length > 0 && (
        <div className="warning-list">
          <h3>Parser Summary Notes</h3>
          {summary.parser_warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}
      {allWarnings.length > 0 && (
        <div className="warning-list">
          <h3>Parser Warnings</h3>
          {allWarnings.slice(0, 80).map((warning) => <p key={warning}>{warning}</p>)}
          {allWarnings.length > 80 && <p>{allWarnings.length - 80} more warnings hidden.</p>}
        </div>
      )}
    </details>
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
  if (filters.unpaid === "yes" && !job.isUnpaid) return false;
  if (filters.unpaid === "no" && job.isUnpaid) return false;
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
  if (key === "detailUrl") {
    return job.detailUrl
      ? <a className="inline-link" href={job.detailUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>View full posting</a>
      : <span className="muted">-</span>;
  }
  if (key === "work_arrangement") return <span className={`pill ${job.work_arrangement}`}>{formatValue(job.work_arrangement)}</span>;
  if (key === "isUnpaid") return formatUnpaidStatus(job.isUnpaid);
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
  return ["job_title", "employer_name", "general_job_location", "work_arrangement", "isUnpaid", "job_id", "record_index"].includes(key);
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

function formatUnpaidStatus(isUnpaid: boolean): string {
  return isUnpaid ? "Unpaid" : "Paid or not marked unpaid";
}

function labelize(value: string): string {
  const labels: Record<string, string> = {
    job_id: "Posting ID",
    employer_id: "Employer ID",
    job_title: "Job Title",
    employer_name: "Employer",
    detailUrl: "Full Posting Link",
    general_job_location: "Location",
    work_arrangement: "Work Setting",
    isUnpaid: "Unpaid Status",
    search_result_summary: "Search Result Summary"
  };
  return labels[value] ?? formatValue(value);
}

function detailEntries(job: JobRecord): Array<[string, unknown]> {
  const keys: Array<keyof JobRecord> = [
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
    "extra_labeled_fields"
  ];
  return keys
    .map((key): [string, unknown] => [String(key), key === "isUnpaid" ? formatUnpaidStatus(job.isUnpaid) : job[key]])
    .filter(([, value]) => hasDisplayValue(value));
}

function hasDisplayValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "" && value !== "unknown";
}

function stableJobKey(job: JobRecord): string {
  const parts = [
    job.job_id,
    job.employer_id,
    job.job_title,
    job.employer_name,
    job.general_job_location
  ].map((value) => String(value ?? "").trim().toLowerCase());
  return parts.some(Boolean) ? parts.join("|") : `record:${job.record_index}`;
}

function formatReadableJobList(records: JobRecord[]): string {
  return records.map((job, index) => {
    const lines = [
      `${index + 1}. ${job.job_title ?? "Untitled posting"}`,
      `Employer: ${job.employer_name ?? "Unknown employer"}`,
      `Location: ${job.general_job_location ?? "Not listed"}`,
      `Posting ID: ${job.job_id ?? "Not listed"}`,
      `Pay status: ${formatUnpaidStatus(job.isUnpaid)}`
    ];
    if (job.detailUrl) lines.push(`Full posting: ${job.detailUrl}`);
    return lines.join("\n");
  }).join("\n\n");
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
  if (filters.unpaid !== "any") chips.push(filters.unpaid === "yes" ? "Unpaid" : "Paid or not marked unpaid");
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
  else if (chip === "Unpaid" || chip === "Paid or not marked unpaid") next.unpaid = "any";
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
    unpaid: (params.get("unpaid") as TriState) || "any"
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

function readSwipeChoices(): Record<string, SwipeChoice> {
  try {
    const parsed = JSON.parse(localStorage.getItem("coop-dashboard-swipe-choices") ?? "{}") as Record<string, SwipeChoice>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === "like" || value === "dislike" || value === "skip"));
  } catch {
    return {};
  }
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem("coop-dashboard-theme");
    return stored === "light" || stored === "dark" ? stored : "dark";
  } catch {
    return "dark";
  }
}

export default App;
