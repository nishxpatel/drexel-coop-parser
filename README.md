# Drexel Co-op Search Dashboard

Live Website: [Drexel Co-op Search Dashboard](https://nishxpatel.github.io/drexel-coop-parser/)

A static, browser-only dashboard for turning the visible Drexel SCDC co-op search results page into a searchable job list. Rich paste and local RTFD parsing can preserve links to full job postings when the source copy includes them.

The project has two parts:

- A reusable parser that converts raw copy-and-paste search results, rich copied HTML, or local RTFD/RTF files into focused JSON and CSV.
- A Vite + React dashboard that loads fake demo data from `public/data/jobs.json`, supports search/filter/export workflows, and can parse pasted results locally in the browser.

There is no backend server. The built site can be hosted on GitHub Pages.

## Features

- Parse raw SCDC search result text into structured job records.
- Preserve full-posting links when rich clipboard content or RTFD input includes them.
- Preserve each posting's original raw text block.
- Generate `jobs.json`, `jobs.csv`, `schema.json`, and `parser-summary.json`.
- Search across structured fields and optional raw text.
- Combine filters for location, state, employer, work mode, and unpaid status.
- Sort useful search-result columns and control visible columns.
- Open a detail drawer with available fields, full-posting links, raw pasted text, and collapsed parsing diagnostics.
- Review filtered jobs one at a time in Swipe Mode and save local Like/Dislike lists.
- Export filtered results as JSON or CSV.
- Copy selected records or all filtered records to the clipboard.
- Save searches locally in the browser.
- Paste/import new raw search result text directly in the dashboard.
- Landing page with plain-language instructions for users who received the link with no context.
- Dark mode enabled by default, with a light/dark toggle saved in browser localStorage.

## Project Structure

```text
.
├── .github/workflows/deploy.yml  # GitHub Pages deployment workflow
├── public/data/                  # Safe sample data bundled with Pages build
├── scripts/                      # Parser, validation, audit, and build helpers
├── src/
│   ├── App.tsx                   # Dashboard app
│   ├── lib/parser.ts             # Browser parser for pasted imports
│   ├── parser.js                 # Node parser used by CLI scripts
│   └── styles.css                # Dashboard styles
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

Raw exports such as `all.txt`, `test.txt`, `.rtf`, and `.rtfd` files, plus the full generated `data/` directory, are intentionally ignored by git. Keep them local unless you have reviewed them and have permission to publish them.

## Setup

Requirements:

- Node.js 22 or newer is recommended for parity with the GitHub Actions workflow.
- npm.

Install dependencies:

```sh
npm install
```

Start the local dashboard:

```sh
npm run dev
```

Build the static site:

```sh
npm run build
```

Preview the production build:

```sh
npm run preview
```

## Parser Workflow

The repository includes a synthetic fixture at `fixtures/sample-search-results.txt` so CI can validate parsing without committing private raw exports.

For your own exports, place raw SCDC search result files in the project root as local files:

```text
all.txt
test.txt
all.rtfd
```

Validate the parser against the synthetic fixture:

```sh
npm run validate
```

Validate against your local raw sample, if present:

```sh
node scripts/validate-sample.js test.txt
```

Generate a private local database from the full export:

```sh
npm run parse
```

The default parser command reads `all.txt`. You can parse a local RTFD package or RTF file directly:

```sh
node scripts/parse.js all.rtfd data
node scripts/parse.js saved-results.rtf data
```

This writes:

- `data/jobs.json`
- `data/jobs.csv`
- `data/schema.json`
- `data/parser-summary.json`

Run the public-data audit before publishing:

```sh
npm run audit:data
```

The audit checks generated data files for obvious email addresses and US phone numbers. It is not a complete privacy or licensing review.

The deployed GitHub Pages demo uses a safe synthetic rich-text sample committed in `public/data/`. Do not copy real parsed co-op data into `public/data/` or commit it unless you have explicit approval and are certain it is safe to publish.

## Dashboard Usage

Open the dashboard with `npm run dev` or the live GitHub Pages URL above.

The site opens on a Home page that explains what the tool does, how to copy results, and how privacy works. Use the header links to switch between:

- `Home`: overview, copy instructions, and privacy summary.
- `Import`: paste raw results, parse locally, clear imported data, and open parsing details when needed.
- `Dashboard`: search, filter, sort, copy, and export parsed records.
- `Swipe Mode`: quickly review the currently filtered jobs and save local Like/Dislike choices.
- `Privacy`: detailed privacy promise.

The dashboard is based on the information visible on the pasted search results page. It does not assume full detail-page content such as full descriptions, qualifications, detailed pay, majors accepted, or application instructions. If the copied rich content includes links, the dashboard shows a `View full posting` action.

The dashboard loads fake demo records from `public/data/jobs.json` by default and provides:

- Keyword search across job records.
- Exact phrase toggle.
- Raw text search toggle.
- Structured filters for fields that are useful in search-result data.
- Active filter chips.
- Sortable result table.
- Column visibility controls.
- Detail drawer on row click.
- `View full posting` links when rich paste or RTFD parsing captured them.
- Swipe Mode with like, dislike, skip, undo, reset, export, and readable copy actions.
- Filtered JSON/CSV export.
- Copy-to-clipboard for selected or filtered records.
- Local saved searches.

Search state is stored in the URL query string where practical, so a filtered view can be reopened or shared. Swipe Mode uses the same active filters as the dashboard, and liked/disliked choices are stored only in the user's browser localStorage.

## Paste Import

Use the `Import` tab to process your own raw co-op search result text.

Recommended copy workflow:

1. Run your co-op job search in the school co-op search system.
2. After clicking Search, go to the results page.
3. Click into any job posting from the results.
4. Click the green Return button to return to the results page.
5. In the browser address bar, look near the end of the URL for the part that says `&i_recs_per_page=` followed by a number.
6. It may say `&i_recs_per_page=99`, but the number may be different.
7. Change that part so it says `&i_recs_per_page=999`, then press Enter to reload the page.
8. This helps put more results on one page before copying.
9. Press Command + A on Mac or Control + A on Windows to select the page content.
10. Press Command + C on Mac or Control + C on Windows to copy the page content.
11. Paste that copied content into this dashboard's import box.
12. If the browser provides rich clipboard data, the dashboard may also capture links to full postings.
13. Click `Parse Locally`.
14. The dashboard will create a searchable local database from the pasted content.

Link extraction depends on the browser and source page. If the clipboard only contains plain text, the parser still creates searchable records but full-posting links will be blank.

After parsing:

- The app automatically opens the dashboard with your parsed records.
- Open `Parsing details` only if you need counts, skipped-line notes, or warnings for troubleshooting.
- Check the `Posting Links` count in `Parsing details` to confirm whether full-posting links were captured.
- Export imported results as JSON or CSV if needed.
- Use `Clear Imported Data` to remove pasted text and parsed records from the current browser tab.
- Use `Clear Saved Browser Settings` to remove saved searches and column preferences from local browser storage.

Pasted data is processed entirely in your browser tab. It is not uploaded anywhere by this app. Parsed records stay in the current tab unless you export them. Saved searches, column settings, and theme preference use `localStorage`, which means they stay in that user's browser storage and can be cleared from the Import screen.

## GitHub Pages Deployment

The repository includes `.github/workflows/deploy.yml`, which builds the static site and deploys `dist/` to GitHub Pages.

The Vite config uses a relative base path by default:

```ts
base: process.env.VITE_BASE_PATH || "./"
```

That makes bundled assets and `data/jobs.json` work from a GitHub Pages project path such as:

```text
https://USERNAME.github.io/REPOSITORY/
```

To enable GitHub Pages:

1. Push this repository to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. Under `Build and deployment`, set `Source` to `GitHub Actions`.
5. Push to the `main` branch, or run the `Deploy GitHub Pages` workflow manually from the `Actions` tab.
6. After the workflow completes, GitHub will show the live Pages URL in `Settings` -> `Pages`.

## Public Data And Privacy

Important: raw SCDC exports may contain private or sensitive information, including advisor contact details, search criteria, logged-in-system context, and job listings that may not be intended for public redistribution.

Current safeguards:

- `all.txt`, `test.txt`, `text.txt`, `.rtf`, `.rtfd`, `raw/`, `raw-data/`, `private-data/`, `user-data/`, and `*.raw.txt` are ignored by git.
- `data/` is ignored by git because it may contain the full private export.
- `public/data/` contains only a synthetic sample dataset by default.
- `npm run build` uses only committed `public/data` demo files. It does not copy private root `data/` outputs into the deploy build.
- Generated `parser-summary.json` redacts advisor name, phone, and email.
- `npm run audit:data` checks generated data for obvious emails and phone numbers.
- The browser import workflow does not upload pasted text.

Before publishing to a public GitHub repository or GitHub Pages site, manually review:

- `data/jobs.json`
- `data/jobs.csv`
- `data/parser-summary.json`
- Any screenshots
- Any raw exports accidentally staged for commit

Developer warning: never commit raw co-op search files, RTFD/RTF exports, parsed private outputs, exported user JSON/CSV files, screenshots showing real records, or any other user-provided data. The MIT license in this repository applies to the project code. It does not grant rights to redistribute Drexel, SCDC, employer, or third-party job posting content.

## Screenshots

Screenshots are not included yet. Suggested screenshots for the GitHub README:

- Main dashboard with filters and result table.
- Job detail drawer showing structured fields and raw text.
- Paste Import panel after parsing a sample.

Review screenshots for private data before committing them.

## Scripts

```sh
npm run dev          # Start Vite dev server
npm run build        # Type-check and build static site with fake public demo data
npm run preview      # Preview production build locally
npm run parse        # Parse all.txt into data/
npm run parse:sample # Parse the synthetic fixture into data-sample/
npm run validate     # Validate parser behavior on the synthetic fixture
npm run audit:data   # Scan generated data for obvious public-data concerns
npm run clean        # Remove build and sample output
```

## License

Code is licensed under the MIT License. Data files and raw job posting content may have separate ownership or access restrictions; review before publishing.
