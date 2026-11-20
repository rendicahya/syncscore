# CLAUDE.md — SyncScore

Permanent development instructions for Claude Code when building and maintaining **SyncScore — Smart Grade Synchronization**.

SyncScore is a browser-based application that helps university lecturers synchronize student grades from one or more Source spreadsheets into a Target SIADO spreadsheet template, matching students by identity (NIM), never by row position.

Treat SyncScore as a complete, reliable grade-management utility, not a prototype. **Data integrity, predictable synchronization, privacy, and a high-quality spreadsheet experience are the highest priorities.**

---

## 1. Project Identity

| Item | Value |
| --- | --- |
| Name | SyncScore |
| Tagline | Smart Grade Synchronization |
| Type | Client-side web application (no backend) |
| Primary users | University lecturers |
| Primary purpose | Synchronize grades between spreadsheets using NIM, not row position |
| Hosting | GitHub Pages (static files only) |
| Repository | `rendicahya/syncscore`, branch `main` |

The application must work entirely in the browser.

## 2. Development Philosophy

1. Build the complete application described here, not a simplified MVP.
2. Prioritize correctness and data integrity over implementation shortcuts.
3. Never silently discard, overwrite, or corrupt student data.
4. Keep the code maintainable, modular, and easy to extend.
5. Prefer simple, well-structured solutions over unnecessary complexity.
6. Add dependencies only when they provide meaningful value.
7. Never implement features that contradict the business rules in this document.
8. When requirements are ambiguous, inspect the existing implementation and documentation first. Ask the user only when a decision is genuinely necessary.
9. Never remove existing working features while implementing new requests.
10. Keep backward compatibility with locally saved projects whenever the data model changes.

## 3. Technology Stack

Use this stack unless the user explicitly approves a change:

- **Svelte 5** (runes: `$state`, `$derived`, `$effect`, `$props`) with **TypeScript strict mode**
- **Vite** (not SvelteKit, unless the user explicitly requests it)
- **Tailwind CSS 4**
- **shadcn-svelte** for UI primitives
- **Tabulator 6.x** with Spreadsheet, Range Selection, Editing, and Clipboard modules
- **SheetJS (`xlsx`)** for Excel import/export
- **Dexie.js** on IndexedDB for local persistence
- **Lucide Svelte** for icons
- **Vitest** for unit tests
- **GitHub Actions** for automated deployment to **GitHub Pages**

Because the site is served from `https://<user>.github.io/syncscore/`, the Vite `base` must be configured accordingly (`/syncscore/`).

## 4. Commands

Expected `package.json` scripts (create them if missing, keep them working):

| Command | Purpose |
| --- | --- |
| `npm run check` | Type checking (`svelte-check` + `tsc`) |
| `npm test` | Unit tests (`vitest run`) |
| `npm run build` | Production build |

- Run all three before considering any task complete.
- **Do not run `npm run dev` or any local dev server** unless the user explicitly asks for it.

## 5. Core Business Rules — Must Always Be Preserved

These rules are critical. Never change them without explicit user approval.

### 5.1 Student Identification

- NIM is the primary student identifier.
- NIM matching must be exact. Only leading/trailing whitespace may be trimmed; any other normalization requires user approval.
- Never match students by row position.
- Student name is used for validation only, never as the primary identifier.
- If the NIM matches but the student name differs, the record requires manual review.
- Duplicate NIMs are never processed automatically. If a NIM appears more than once in either dataset, flag every affected record and exclude it from automatic matching.
- NIM is always a string. Preserve leading zeros. Never silently convert a NIM into a number.

### 5.2 Unmatched Students

- Show students that exist only in a Source dataset.
- Show students that exist only in the Target dataset.
- Provide manual matching that supports:
  - Pairing a Source row directly with a Target row.
  - Editing a NIM or student name and rerunning matching.
- Clearly mark manual matches and require explicit user confirmation for them.

### 5.3 Multiple Source Datasets

- A project contains one or more Source datasets.
- Each Source dataset is imported independently and has its own column mapping configuration.
- All Source datasets synchronize into the single Target dataset.
- Never assume different Source datasets share the same student row order.

### 5.4 Grade Synchronization

- Support single-column and multiple-column mappings (Source column → Target column pairs).
- Empty Source cells (`null`, `undefined`, empty or whitespace-only string) are skipped.
- Numeric zero (`0`, and the string `"0"`) is a valid grade and must never be treated as empty.
- Never overwrite an existing non-empty Target value without explicit user confirmation.
- Always show a preview before applying. The preview must distinguish:
  - New values to be filled.
  - Existing values that would be overwritten.
  - Empty Source values that will be skipped.
  - Unmatched students.
  - Duplicate NIM records.
  - Name mismatches requiring review.
- Synchronization is atomic: compute the full change set first, then apply it in one step. Cancellation or failure must leave no partial changes.
- Never reorder Target rows.
- Update only the selected Target cells.

### 5.5 Mapping History, Undo and Redo

- Record every synchronization operation with: timestamp, Source datasets, Source columns, Target columns, processed records, newly filled cells, overwritten cells (with previous values), skipped cells, and unmatched records.
- Support undo and redo.
- Undo reverses only the relevant operation and must not destroy unrelated subsequent edits. Store per-cell `before`/`after` values; when undoing, if a cell was changed again after the operation, do not blindly revert it — report the conflict and let the user decide.
- Repeating a mapping that was already applied requires confirmation and is recorded in history as a new operation.

## 6. Spreadsheet Requirements

The spreadsheet experience is a central feature. Use Tabulator's Spreadsheet functionality; never replace it with a basic HTML table.

The spreadsheet must support:

- Excel-like column letters and numbered rows.
- Direct cell editing and keyboard navigation.
- Multi-cell selection and range selection by mouse drag.
- Copying and pasting multiple cells using TSV-compatible clipboard data.
- Copy/paste between Source and Target, and pasting from Excel and Google Sheets.
- Whole-table copy buttons.
- Column resizing, search/filtering, and sorting.
- Adding and deleting rows and columns.
- Frozen headers.
- Visual highlighting of matched, unmatched, and changed cells.

Rules:

- Tabulator's data format is **not** the application's data model. Keep explicit adapters between them (`src/lib/spreadsheet/`).
- Sorting and filtering in the view must never change the stored row order of a dataset.
- Test clipboard parsing and multi-cell paste with realistic data (quoted fields, embedded tabs/newlines, trailing empty rows, CRLF line endings).

## 7. Excel Import and Export

Use SheetJS.

**Import**

- Accept XLSX files.
- When a workbook contains multiple sheets, list the worksheet names and let the user choose.
- The first row is always the header.
- Allow data to be pasted directly, and support combining pasted data with imported files.

**Export**

- Export the final Target dataset to XLSX.
- Allow copying the final Target dataset to the clipboard.
- Preserve column headers and cell values exactly.
- Write NIM cells as text (cell type `s`).
- Never silently alter grades or any other cell content.

**NIM and number formats:** Excel may store NIMs as numbers with custom formats (e.g. `0000000000`). Read the formatted text (`cell.w`) where appropriate to recover leading zeros. If leading zeros cannot be recovered reliably, or a NIM is stored in scientific notation / exceeds safe-integer precision, **warn the user** instead of producing a possibly incorrect NIM.

## 8. Project Persistence

Use Dexie.js on IndexedDB and auto-save project changes.

A project preserves:

- Source datasets and the Target dataset.
- Selected worksheets and imported data.
- Column configurations and mapping configurations.
- Manual matching records.
- Synchronization history and undo/redo state.
- Other relevant project settings.

Project management features:

- Create, open, rename, and delete projects.
- Export a project backup (JSON file) and import a project backup (validated before import).
- Delete all locally stored SyncScore data (with confirmation).

The UI must explain that projects are stored only in the current browser on the current device, and encourage exporting backups.

**Schema changes:** bump the Dexie version and write an explicit `upgrade()` migration. Backup files carry a `schemaVersion` and are migrated on import. Never silently discard existing projects. Add a test for every migration.

## 9. User Interface and Experience

Modern, minimal, professional, suitable for university lecturers.

**Visual direction:** clean and uncluttered; neutral background; indigo/blue primary accent; subtle borders and shadows; rounded corners; consistent spacing and typography; light and dark themes; Lucide icons; responsive.

**Layout:**

- Source panel on the left, Target panel on the right (side by side on desktop).
- Multiple Source datasets via tabs or a dataset selector.
- One active Target dataset representing the SIADO template.
- On mobile, tabs switch between Source and Target.

**Clear visual feedback for:** matched students, unmatched students, duplicate NIMs, name mismatches, manual matches, modified cells, synchronization results, and validation errors. Do not rely on color alone — pair colors with icons, labels, or legends.

**Accessibility:** accessible labels, keyboard-friendly controls, visible focus states, and clear confirmation dialogs for destructive or irreversible actions.

**UI language:** Bahasa Indonesia for user-facing text in the application, unless the user requests otherwise.

## 10. Privacy and Security (Mandatory)

Student data is sensitive.

- All spreadsheet processing happens locally in the browser.
- Never send student data to a backend, external API, or external service.
- No analytics or tracking that collects student data.
- **Never log NIMs, names, grades, or spreadsheet contents** to the console — including in debug code and error handlers.
- Never put student data in URLs (query strings, hashes, routes).
- Never expose student data through error reporting or error messages sent anywhere.
- Persist only to IndexedDB, and provide a clear way to delete it.
- Never commit real student data to the repository. Test fixtures must use synthetic data.
- GitHub Pages serves only the static application files.

## 11. Architecture and Code Quality

Business logic must be independent of Svelte components and Tabulator, and implemented as pure, independently testable TypeScript modules.

Intended structure (adapt as the project evolves, but keep the separation):

```
src/
  lib/
    domain/        # Core types: Dataset, Row, Column, Project, Mapping, ...
    matching/      # Student matching engine (NIM, duplicates, name checks, manual matches)
    sync/          # Grade synchronization engine (preview + atomic apply)
    history/       # Operation history, undo/redo
    validation/    # Data validation rules
    io/            # XLSX import/export, clipboard (TSV) parsing/serialization
    persistence/   # Dexie database, schema versions, migrations, backup import/export
    spreadsheet/   # Tabulator setup and adapters to/from the domain model
    state/         # Application state (Svelte 5 runes in .svelte.ts files)
    ui/            # Theme and UI utilities
    components/    # Svelte components (shadcn-svelte in components/ui/)
  App.svelte
  main.ts
tests/ or *.test.ts next to modules
```

Code rules:

- Explicit types; avoid `any` unless there is a documented technical reason.
- Handle errors gracefully with clear, user-friendly messages (in Bahasa Indonesia).
- Avoid duplication and oversized components; extract logic into modules.
- Prefer immutable updates in the domain layer so previews and undo are reliable.

## 12. Testing Requirements

Use Vitest. Prioritize tests for:

- Exact NIM matching and NIM leading zeros.
- Duplicate NIM detection.
- Name mismatch handling.
- Unmatched student detection and manual matching.
- Multiple Source datasets and multiple column mappings.
- Empty Source cells and zero-valued grades.
- Existing Target values and overwrite confirmation.
- Target row-order preservation.
- Atomic synchronization.
- Undo and redo (including conflicts with later edits).
- XLSX import and export (including numeric NIMs with custom formats).
- Project persistence and migrations.
- Clipboard parsing and multi-cell paste.

Every bug fix includes a regression test whenever practical.

Before considering a task complete, run **type checking, unit tests, and a production build**. Never claim tests passed unless they were actually executed successfully.

## 13. Git and Deployment

Deployment is automated by a GitHub Actions workflow that builds the app and deploys `dist/` to GitHub Pages on every push to `main`. The workflow must run the same checks as local validation (type check, tests, build) before deploying.

Workflow for every change:

1. Implement the change.
2. Run type checking, unit tests, and production build.
3. Fix any failures.
4. Commit with a clear message.
5. If the remote has new commits, rebase onto them and resolve conflicts.
6. Push to `main`.
7. Verify the GitHub Actions run (e.g. `gh run list` / `gh run watch`) and report the result.

Rules:

- Do not run a local dev server unless explicitly requested.
- Never force-push.
- Never overwrite unrelated user changes.
- Never commit secrets, tokens, credentials, or student data.
- Never claim deployment succeeded until it has been verified.
- If GitHub authentication, repository access, or Pages configuration is missing (e.g. Pages source not set to "GitHub Actions"), explain exactly what is missing and what the user must do.
- Never fabricate repository URLs or deployment status.

## 14. Working With Existing Code

At the start of every session:

1. Read this `CLAUDE.md`.
2. Inspect the repository structure and check `git status`.
3. Read relevant source files, tests, and documentation before modifying anything.
4. Understand existing functionality; avoid unnecessary rewrites.

Before modifying files: understand their purpose, identify dependents, consider regressions, and preserve working behavior.

After modifying files: run tests, type checking, and the production build; then summarize the changes and any limitations or outstanding issues.

## 15. User Communication — Bahasa Indonesia

**All direct communication with the user must be in natural, clear, professional Bahasa Indonesia**, unless the user explicitly requests another language. This applies to clarifying questions, requirement discussions, progress updates, technical explanations, implementation summaries, error explanations, test reports, Git/deployment reports, recommendations, and confirmation requests.

- Do not switch to English just because the topic is technical.
- Keep library names, framework names, APIs, code identifiers, and commands in their original form.
- Code, identifiers, and code comments stay in English. Technical documentation may be in English unless the user requests otherwise.
- When a tool or library reports an error in English, explain its meaning and implications in Bahasa Indonesia.

When reporting progress or completion:

- Summarize what was implemented and the important technical decisions.
- Report test results accurately.
- Report commit and push status, and deployment status only when verified.
- Clearly identify anything requiring user action.

Do not ask the user to repeat requirements already documented here or in project documentation.

## 16. Source of Truth

When requirements conflict, use this priority:

1. Explicit instructions from the user in the current conversation.
2. Explicit user-approved product requirement changes.
3. This `CLAUDE.md`.
4. Existing project documentation.
5. Existing implementation, as long as it does not contradict the above.

Never change core business rules, data integrity behavior, privacy guarantees, or deployment expectations without explicit user approval.
