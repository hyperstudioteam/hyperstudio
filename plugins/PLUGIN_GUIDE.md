# Writing a Hypergrid Driver Plugin

Hypergrid can load **external database drivers** as separate processes that speak
**JSON-RPC 2.0** over newline-delimited `stdin` / `stdout` — the same shape used
by [Tabularis](https://tabularis.dev/plugins).

Built-in drivers (`postgres`, `mysql`) stay in-process via `sqlx`. Everything else
ships as a plugin.

## Architecture

```
Hypergrid (Tauri / Rust)
  └─ PluginProcess actor  ── JSON-RPC ──►  plugin executable
         stdin / stdout                     (any language)
```

- One Tokio task owns the child pipes. Concurrent host callers are routed by request `id`.
- Plugin `stderr` is inherited (logs appear next to the app).
- A crash becomes EOF on the pipe — the GUI stays up.
- Plugins run as the current user. This is **fault isolation**, not a sandbox.

## Layout

Plugins live under the app data directory:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/hypergrid/plugins/<id>/` |
| Linux | `~/.local/share/hypergrid/plugins/<id>/` |
| Windows | `%APPDATA%\hypergrid\plugins\<id>\` |

```text
plugins/
└── skeleton/
    ├── manifest.json
    └── hypergrid-skeleton   # or .exe on Windows
```

Install from **Settings → Plugins** (or the puzzle icon) by pasting a folder or `.zip` path.
The folder name must match `manifest.id`.

## `manifest.json`

```json
{
  "id": "skeleton",
  "name": "Skeleton",
  "version": "0.1.0",
  "description": "Example driver",
  "default_port": null,
  "executable": "hypergrid-skeleton",
  "capabilities": {
    "schemas": true,
    "views": false,
    "file_based": false,
    "folder_based": false,
    "no_connection_required": true,
    "readonly": false,
    "identifier_quote": "\""
  }
}
```

| Field | Notes |
| --- | --- |
| `id` | Lowercase, folder-safe. **Cannot** be `postgres` or `mysql`. |
| `executable` | Relative path inside the plugin folder. |
| `capabilities.file_based` | Connection form shows a file path instead of host/port. |
| `capabilities.folder_based` | Connection form shows a folder path. |
| `capabilities.no_connection_required` | Hides host/credentials (API-style drivers). |
| `capabilities.schemas` | When false, the Schemas tab is hidden. |

## Wire protocol

One JSON object per line.

**Request**

```json
{"jsonrpc":"2.0","method":"execute_query","params":{"connectionId":"…","query":"SELECT 1"},"id":3}
```

**Success**

```json
{"jsonrpc":"2.0","result":{"columns":["?column?"],"rows":[[1]],"affectedRows":0,"truncated":false},"id":3}
```

**Error**

```json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"…"},"id":3}
```

### Methods (v1)

| Method | Required | Result |
| --- | --- | --- |
| `initialize` | no | `null` — receives `{ "settings": { … } }` |
| `ping` | no | `null` |
| `test_connection` | yes | `{ "success": true, "serverVersion"?, "database"? }` |
| `connect` | no | same as test; falls back to `test_connection` |
| `disconnect` | no | `null` |
| `get_schemas` | yes* | `[{ "name", "isSystem"? }]` or `["public"]` |
| `get_tables` | yes* | `[{ "name", "kind"?, "columns"? }]` — kept for backwards compatibility |
| `get_objects` | recommended | `[{ "name", "kind"?, "detail"?, "children"?, "actions"? }]` for one group |
| `get_object_subgroup` | no | `[{ "name", "kind"?, "detail"?, "children"? }]` for one folder under an object |
| `get_columns` | no | `[{ "name", "dataType", "nullable", "primaryKey" }]` |
| `get_schema_tree` | no | `[{ "name", "tables": […] }]` bulk alternative |
| `execute_query` | yes | `{ "columns", "rows", "affectedRows"?, "truncated"? }` |

\*Required when `capabilities.schemas` is true / when browsing tables. If `get_objects`
is missing, Hypergrid falls back to `get_tables` for the `tables` group only.

Connection params passed to `test_connection` / `connect`:

```json
{
  "id": "…",
  "host": "localhost",
  "port": 5432,
  "database": "mydb",
  "username": "user",
  "password": "…",
  "sslMode": "prefer"
}
```

## Quick start (Rust skeleton)

```bash
cd plugins/skeleton
cargo build --release

# Copy the binary next to manifest.json (macOS/Linux):
cp target/release/hypergrid-skeleton .

# In Hypergrid: Settings → Plugins → install this folder path
```

Or package a zip whose root (or single child folder) contains `manifest.json` + the executable.

## Contributions: column types & data viewers

Beyond drivers, plugins can shape how cell values are displayed and inspected. The UI
keeps a **contribution registry** — and Hypergrid's own built-ins register through the
exact same API, so the core is "just another plugin".

### Column types (declarative, no code)

Declare them in `manifest.json` under `contributes.columnTypes` (snake_case
`column_types` is also accepted). Hypergrid maps your
engine's type names to inline formatting + a default viewer. This runs **no plugin code**:

```json
{
  "contributes": {
    "columnTypes": [
      {
        "typeNames": ["json", "jsonb", "document"],
        "matchPrefix": false,
        "align": "left",
        "className": "cell-json",
        "viewer": "builtin.json",
        "priority": 5
      }
    ]
  }
}
```

| Field | Notes |
| --- | --- |
| `typeNames` | SQL type names to match (lowercased). Snake_case `type_names` also accepted. |
| `matchPrefix` | Match as a prefix (e.g. `varchar` matches `varchar(255)`). |
| `align` | `left` \| `right` \| `center`. |
| `className` | CSS class applied to the cell. |
| `viewer` | Default data viewer id opened for this type. |
| `priority` | Higher wins when several match. |

### Object groups (schema tree categories)

The schema browser is **not** hardcoded to tables. Each driver declares the
categories it wants under a schema — MySQL shows Tables / Views / Routines /
Triggers / Events; Typesense shows Collections / Aliases / Synonyms / API Keys.

```json
{
  "contributes": {
    "objectGroups": [
      {
        "id": "tables",
        "label": "Collections",
        "icon": "layers",
        "childLabel": "Fields",
        "actions": ["viewData", "editData"],
        "defaultOpen": true
      },
      {
        "id": "synonyms",
        "label": "Synonyms",
        "icon": "function",
        "actions": [],
        "defaultOpen": false
      }
    ]
  }
}
```

| Field | Notes |
| --- | --- |
| `id` | Stable key passed to `get_objects` as `group`. Use `tables` for anything that should support Edit/View Data. |
| `label` | Heading shown in the tree. |
| `icon` | Lucide icon name: `table`, `eye`, `function`, `zap`, `hash`, `clock`, `layers`, `key`, `columns`, `link`, `list`. |
| `childLabel` | Optional heading for an object's children (Columns, Parameters, Fields). |
| `actions` | Context-menu actions: `viewData`, `editData`. |
| `defaultOpen` | Auto-expand + load this group when the schema is opened. |
| `objectSubgroups` | Optional folders under each object (Columns / Keys / Indexes / …). |

Then implement `get_objects`:

```json
→ { "method": "get_objects", "params": { "connectionId", "schema", "group": "synonyms" } }
← [
  { "name": "brand-typos", "kind": "SYNONYM", "detail": "apple, aple", "children": [] }
]
```

Objects may include `children` (columns / parameters / fields) and optionally
override `actions` per object. Empty `objectGroups` falls back to a single
Tables group backed by `get_tables`.

### Object subgroups (folders under a table / collection)

Native SQL drivers show Columns / Keys / Foreign Keys / Indexes under each
table. Plugins opt in the same way — declare folders on a group, then answer
lazy loads:

```json
{
  "id": "tables",
  "label": "Collections",
  "icon": "layers",
  "actions": ["viewData", "editData"],
  "defaultOpen": true,
  "objectSubgroups": [
    { "id": "columns", "label": "Fields", "icon": "columns" },
    { "id": "facets", "label": "Facets", "icon": "hash" },
    { "id": "indexes", "label": "Indexed", "icon": "list" }
  ]
}
```

| Subgroup `id` | Load behavior |
| --- | --- |
| `columns` | Uses eager `children` / `columns` from `get_objects` (no extra RPC). |
| any other id | Calls `get_object_subgroup` when the folder is expanded. |

```json
→ {
  "method": "get_object_subgroup",
  "params": {
    "connectionId": "…",
    "schema": "typesense",
    "object": "products",
    "subgroup": "indexes"
  }
}
← [
  { "name": "title", "kind": "INDEX", "detail": "string · infix", "children": [] },
  { "name": "price", "kind": "INDEX", "detail": "float · sort", "children": [] }
]
```

Keep `children` on the parent object as the canonical field/column list for
autocomplete and Edit Data. Subgroups are tree-only metadata.

### Connection fields (declarative form)

Plugins that are not classic SQL servers can replace the default Host / Database /
Username / Password form with a custom field list:

```json
{
  "connectionFields": [
    { "key": "host", "label": "Host", "required": true, "width": "half" },
    { "key": "port", "label": "Port", "required": true, "width": "half" },
    {
      "key": "password",
      "label": "API Key",
      "required": true,
      "secret": true,
      "width": "full"
    },
    {
      "key": "database",
      "label": "Protocol",
      "options": ["http", "https"],
      "width": "full"
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `key` | Maps to the connection profile: `host`, `port`, `database`, `username`, `password`, `sslMode`. |
| `label` | UI label. |
| `required` | Browser + form validation. |
| `secret` | Password input; enables vault/raw storage UI. |
| `options` | Optional select choices. |
| `placeholder` / `description` | Hints. |
| `width` | `half` (default grid cell) or `full`. |

When `connectionFields` is present and non-empty, Hypergrid renders only those fields
(plus connection name / folder). Built-in Postgres/MySQL leave it empty and keep the
standard SQL form. Values are still sent to the plugin as the usual connection params
(`password` is the API key for Typesense, `database` can be the protocol, etc.).

### Built-in viewer ids

Reference these from `viewer`, or as targets when building your own column types:

| Viewer id | Renders |
| --- | --- |
| `builtin.json` | Collapsible JSON tree (objects, arrays, JSON strings) |
| `builtin.image` | `data:image/*` and image URLs |
| `builtin.text` | Plain text / stringified fallback (always available) |

### Data viewers (custom UI)

Custom viewer *components* (e.g. a map for GeoJSON, a diff view) run in the UI process.
Runtime loading of external viewer bundles is on the roadmap (Tabularis-style IIFE + a
typed `defineSlot` API). Today, the registry itself is the extension point — built-in
viewers live in `src/components/viewers/` and register in `src/plugins/builtins.tsx` via:

```ts
contributions.registerDataViewer({
  id: "my.viewer",
  label: "My viewer",
  source: "my-plugin",
  canView: (ctx) => typeof ctx.value === "string",
  render: (ctx) => <MyViewer value={ctx.value} />,
});
```

Users open viewers by double-clicking a cell or via **right-click → View value…**.

## Trust model

- Built-ins are trusted and in-process.
- Plugins cannot claim built-in ids (`postgres`, `mysql`).
- v1 install is local path / zip only — no signatures yet. You trust the plugin author.
- Do not paste untrusted paths into the installer.

## See also

- Working example: [`plugins/skeleton`](./skeleton)
- Typesense driver: [`plugins/typesense`](./typesense)
- Host implementation: `src-tauri/src/plugins/`
- Driver trait: `src-tauri/src/drivers/`
