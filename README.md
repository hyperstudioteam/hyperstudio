<h1 align="center">HyperStudio</h1>

<p align="center">
  A fast, open-source desktop database client for PostgreSQL and MySQL.<br/>
  Built with Rust, Tauri 2, and React.
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg" />
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB.svg" />
  <img alt="React 19" src="https://img.shields.io/badge/React-19-61DAFB.svg" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-CE422B.svg" />
  <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-orange.svg" />
</p>

---

HyperStudio is a native desktop client for people who live in SQL. It aims to give you the
day-to-day ergonomics of a commercial tool — a real data editor, spreadsheet-style cell
selection, and clipboard extractors — in a small, auditable, MIT-licensed app.

**Why it exists**

- **Native and light.** A Rust backend with `sqlx` connection pools instead of a bundled browser runtime doing the querying.
- **Offline-friendly.** Schemas are cached locally, so browsing your tree does not require an open connection. HyperStudio connects lazily, the first time you actually run something.
- **Your credentials stay yours.** Passwords are never stored unless you ask. When you do, you choose between plain local storage or an encrypted vault sealed with a master password.

> **Status:** alpha. The core workflow (browse → query → edit → copy) works end to end, but
> expect rough edges and breaking changes to local storage formats before `v1.0`.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Using HyperStudio](#using-hyperstudio)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Security model](#security-model)
- [Architecture](#architecture)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Features

### Connections

- [x] PostgreSQL and MySQL drivers backed by `sqlx` pools
- [x] Connection profiles with host, port, database, user, and SSL mode
- [x] Nested folders with drag-and-drop reordering
- [x] Test a connection and load its schema list before saving
- [x] Per-connection schema filters (all schemas, or an explicit allowlist)
- [x] Lazy connect — cached connections open a pool only when you run something
- [x] External driver plugins (JSON-RPC over stdin/stdout) with local folder/zip install
- [ ] SSH tunnels
- [x] Connection colour coding and read-only / production guards

### Password storage

- [x] **Don't save** — password lives in memory for the session only
- [x] **Raw** — stored in plain text on this device
- [x] **Vault** — AES-GCM encrypted, key derived from a master password with PBKDF2-SHA256
- [x] Unlock prompt appears on demand when a locked vault is needed
- [ ] OS keychain integration (macOS Keychain, Windows Credential Manager, libsecret)
- [x] Vault auto-lock after inactivity and master password rotation

### Schema browser

- [x] Lazy introspection: schema list first, tables and columns on expand
- [x] Persistent local schema cache, so the tree renders instantly on launch
- [x] Manual refresh at the database and schema level
- [x] Column types, nullability, and primary-key markers
- [ ] Indexes, foreign keys, constraints, and triggers
- [x] Search and filter within the tree (matches schema, object, and column names)
- [x] Table DDL viewer (right-click an object → **Show DDL…**)
- [ ] ER diagrams

### Query workspace

- [x] Multiple tabs, mixing SQL editors and table editors
- [x] Run the whole buffer or just the selected text
- [x] Result grid with a 1,000-row safety cap and truncation notice
- [x] DDL and DML support with affected-row counts and timings
- [x] SQL syntax highlighting with per-dialect parsing (CodeMirror 6)
- [x] Schema-aware autocompletion for schemas, tables, views, and columns
- [x] SQL formatting (`Shift+Alt+F`, or the **Format** button)
- [x] Query history and saved queries
- [ ] Explicit transaction control and query cancellation
- [x] Multi-statement scripts and per-statement results

### Data editor

- [x] **View Data** opens a `SELECT` in a query tab, results and all
- [x] **Edit Data** opens a dedicated editable grid (double-click a table)
- [x] Server-side paging, plus `WHERE` and `ORDER BY` inputs
- [x] Inline cell editing with dirty-state highlighting
- [x] Insert and delete rows, then submit or revert as a batch
- [x] Primary-key-aware `UPDATE` / `DELETE` statement generation
- [x] Cell viewers: JSON tree, image, and text (double-click or right-click → View value…)
- [x] Pluggable column types and data viewers via the contribution registry
- [ ] Transactional commit mode (currently auto-commit per statement)
- [x] Column sorting and per-column filters from the grid header

### Selection, copy, and paste

- [x] Spreadsheet-style rectangular cell selection with drag and shift-click
- [x] Selection summary: cell count, row count, and numeric `SUM`
- [x] Copy as TSV, CSV, Pipe-separated, JSON, Markdown, or One-row
- [x] Copy as SQL Inserts, SQL Updates, or a Where Clause
- [x] Optional **Include header** toggle (off by default)
- [x] Paste a single value into every selected cell, or tile a block across the range
- [x] Export a full result set to a file (CSV, TSV, JSON, or SQL inserts)
- [ ] Import from CSV into a table

## Getting started

### Prerequisites

- Node.js 20 or newer
- [pnpm](https://pnpm.io/)
- A stable Rust toolchain (via [rustup](https://rustup.rs/))
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

### Run it

```bash
git clone https://github.com/your-org/hyperstudio.git
cd hyperstudio
pnpm install
pnpm tauri dev
```

The React UI can also be developed on its own, without the Rust backend. Tauri commands
will fail in this mode, so it is only useful for layout and styling work:

```bash
pnpm dev
```

### Build a release bundle

```bash
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`.

### Type-check and build the frontend

```bash
pnpm build          # tsc + vite build
cd src-tauri && cargo check
```

## Using HyperStudio

**1. Create a connection.** Pick a driver, fill in the host and credentials, then use
**Test connection** to verify and pull the schema list. The **Schemas** tab lets you limit
introspection to the schemas you care about, which keeps large servers fast.

**2. Decide how the password is stored.** Leave **Save password** off to keep it in memory
for the session, or turn it on and choose **Into vault** or **Raw password**. The first vault
save walks you through creating a master password.

**3. Browse.** Expand a schema to load its tables. Everything is cached locally, so
reopening the app shows the tree immediately without connecting. The pool opens on your
first query, refresh, or edit.

**4. Query or edit.**

| Action | How | Result |
| --- | --- | --- |
| View Data | Right-click a table → **View Data** | Runs `SELECT * … LIMIT 100` in a query tab |
| Edit Data | Double-click a table, or right-click → **Edit Data** | Opens the editable grid in its own tab |

**5. Run a script.** When the buffer holds more than one statement, a **Run script** button
appears next to **Run**. Statements execute in order, each result is listed on the left of
the results pane, and clicking one shows its grid or error. Scripts stop at the first
failure unless you clear **Stop on error**, and **Stop** halts after the running statement.
Semicolons inside strings, comments, and `$$` blocks are left alone by the splitter.

**6. Move data around.** Drag across cells to select a range, then copy with your chosen
extractor or paste a block from a spreadsheet. Edits are staged locally and highlighted
until you submit them.

## Keyboard shortcuts

| Shortcut | Context | Action |
| --- | --- | --- |
| `Cmd/Ctrl + Enter` | SQL editor | Run the buffer, or the current selection |
| `Shift + Alt + F` | SQL editor | Format the buffer, or the current selection |
| `Cmd/Ctrl + C` | Any grid | Copy the selection using the active extractor |
| `Cmd/Ctrl + V` | Data editor | Paste into the selected range |
| `Enter` | Cell editor | Commit the cell |
| `Esc` | Cell editor | Cancel the edit |
| Double-click | Data editor cell | Start editing |
| Shift + click | Any grid | Extend the selection |

## Security model

HyperStudio stores everything locally; there is no server, telemetry, or sync.

| Data | Location | Notes |
| --- | --- | --- |
| Connection profiles | `hyperstudio.connections.v2` | Passwords are stripped unless the mode is **raw** |
| Schema cache | `hyperstudio.schema-cache.v1` | Names, types, and PK flags only — never row data |
| Encrypted vault | `hyperstudio.vault.v1` | Salt, verifier, and AES-GCM ciphertext |

The vault derives a 256-bit AES-GCM key from your master password using PBKDF2-SHA256 with
310,000 iterations and a random 16-byte salt. The master password itself is never written
to disk, and secrets are only held in memory while the vault is unlocked. The
vault auto-locks after a configurable idle period (15 minutes by default), and
the master password can be rotated — which re-derives a new salt and
re-encrypts every stored secret.

**Caveats you should know about:**

- **Raw** mode is plain text. Use it only on a machine you trust.
- Local storage is not protected by the OS keychain yet, so an attacker with access to your
  user account can read raw passwords and attempt an offline attack on the vault.
- Edits in the data editor auto-commit per statement; there is no transactional rollback yet.

## Architecture

The frontend never talks to a database directly. Every operation crosses a typed Tauri
command boundary into Rust. Built-in Postgres and MySQL use in-process `sqlx` pools.
Additional engines load as **external plugins** (JSON-RPC over stdin/stdout), inspired by
[Tabularis](https://tabularis.dev/plugins).

```
src/
  api/         Typed wrappers around Tauri commands
  components/  UI: sidebar, schema browser, workspace, grids, modals, plugins
  hooks/       useConnectionTree, useDatabaseSession
  lib/         Storage, schema cache, vault crypto, SQL builders, extractors
  types/       Shared DTOs mirroring the Rust models

src-tauri/src/
  commands/    Tauri command handlers
  db/          Native pool helpers, schema introspection, query execution
  drivers/     DatabaseDriver trait + native Postgres/MySQL + registry
  plugins/     Manifest, JSON-RPC process actor, install/discover
  models/      Serde DTOs shared with the frontend

plugins/
  PLUGIN_GUIDE.md   How to write a driver plugin
  skeleton/         Minimal Rust reference plugin
```

Key modules worth knowing:

- `lib/vault.ts` — Web Crypto vault (PBKDF2 + AES-GCM), lock/unlock lifecycle
- `lib/sql.ts` — identifier quoting, literals, and `SELECT` / `INSERT` / `UPDATE` / `DELETE` builders
- `lib/extractors.ts` — clipboard formats, selection maths, and paste planning
- `drivers/` — unified driver trait; commands never match on engine strings
- `plugins/` — external process host; plugins cannot shadow `postgres` / `mysql`
- `db/schema.rs` — Postgres and MySQL introspection, including primary-key detection

### Plugins

- Install from the puzzle / settings icon → **Plugins** (local folder or `.zip`).
- **Drivers** run as external processes (JSON-RPC over stdin/stdout).
- **Column types & data viewers** extend how cells render and inspect. Built-ins register
  through the same public contribution API, so the core is just another plugin. Driver
  plugins can declare column types in their manifest (`contributes.column_types`).
- See [`plugins/PLUGIN_GUIDE.md`](plugins/PLUGIN_GUIDE.md) for the RPC surface, manifest, and contributions.
- Trust model: plugins run as your user (fault isolation, not a sandbox). No signing in v1.

## Roadmap

### v0.2 — Trust the editor

- [ ] Transactional commit mode with an explicit **Commit** / **Rollback** toolbar
- [ ] Query cancellation and a visible transaction state
- [ ] Column sorting and header filters in both grids
- [ ] Export a result set or table to CSV, JSON, or SQL

### v0.3 — Write SQL comfortably

- [x] Syntax highlighting and schema-aware autocompletion in the editor
- [ ] SQL formatting
- [ ] Query history with search, plus saved queries
- [ ] Multi-statement scripts with per-statement results
- [ ] Table DDL viewer, indexes, and foreign keys in the browser

### v0.4 — Connect to anything

- [x] Plugin driver host (JSON-RPC over stdin/stdout) with local install
- [ ] SQLite / DuckDB / other engines as community plugins
- [ ] SSH tunnel support
- [ ] Client certificate and full SSL configuration
- [ ] Read-only and production connection guards

### v1.0 — Ship it

- [ ] OS keychain integration and vault auto-lock
- [ ] Signed, notarized builds for macOS, Windows, and Linux
- [ ] Auto-updates
- [ ] Automated test suite and CI on every pull request
- [ ] Stable, versioned local storage with migrations
- [ ] Plugin signing / registry

### Later

- ER diagrams and schema comparison
- Import from CSV
- Scripted extractor plugins and UI slots
- Themes and layout customization

## Contributing

Contributions are very welcome — especially bug reports from real-world databases, since
introspection quirks vary a lot between servers and versions.

1. Fork the repository and create a branch off `main`.
2. Make your change. Keep the existing module boundaries: UI in `src/components`, logic in
   `src/lib` or `src/hooks`, native DB work in `src-tauri/src/db`, driver trait in
   `src-tauri/src/drivers`, and external plugins in `src-tauri/src/plugins` /
   `plugins/`.
3. Verify it compiles:

```bash
pnpm build
cd src-tauri && cargo check
cd ../plugins/skeleton && cargo build --release
```

4. Open a pull request describing what changed and how you tested it. Screenshots help for
   anything UI-facing.

When filing an issue, please include your OS, the database engine and version, and the exact
error text where possible.

## License

[MIT](LICENSE) © HyperStudio contributors
