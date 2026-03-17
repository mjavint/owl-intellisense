# OWL IntelliSense

Full-featured Language Server Protocol (LSP) extension for **OWL 2.x (Odoo Web Library)** development in Visual Studio Code.

Provides deep IntelliSense by scanning your Odoo addon sources (`*/static/src/**`) and building a live symbol index with AST analysis.

---

## Features

### Auto-completion
- **OWL built-in hooks** inside `setup()` — `useState`, `onMounted`, `useService`, `onWillStart`, etc. with snippet insertion
- **Custom hooks** from addon sources — `usePopover`, `useChildRef` and any `use*` function indexed from your workspace
- **Utility functions** from addon files — `patch`, `url`, `browser`, `debounce`, `escape`, `markup`, `sprintf`, etc.
- **Component names** inside `static components = { }` assignments
- **Auto-import on accept** — imports are automatically inserted or merged into existing import groups, always using `@addon/` aliases

### Hover Documentation
- OWL hooks: full signature, description and return type
- Workspace components: props summary with types and optional flags
- Addon functions: JSDoc, signature and source alias path

### Go-to-Definition
- Jump to OWL component class declarations
- Resolve import specifiers (`{ MyComponent }`) to their source file
- Resolve import paths (`@web/core/popover/popover_hook`) to the actual file
- Supports `@addon/` alias resolution out of the box

### Find References
- Cross-file references for components, OWL hooks and exported functions
- Import-site tracking via the workspace symbol index

### Diagnostics (Static Analysis)

| Code | Severity | Description |
|------|----------|-------------|
| `owl/hook-outside-setup` | Error | OWL hook called outside `setup()` |
| `owl/hook-in-loop` | Error | Hook call inside a loop |
| `owl/hook-in-conditional` | Warning | Hook call inside `if`/ternary |
| `owl/hook-in-async` | Warning | Hook call inside `async` function |
| `owl/missing-owl-import` | Error | OWL symbol used but not imported |
| `owl/no-template` | Warning | Component with no `static template` |
| `owl/no-setup` | Info | Component has props but no `setup()` |
| `owl/invalid-props-schema` | Error | `static props` has invalid value |
| `owl/unknown-prop-type` | Warning | Unknown type in props schema |
| `owl/missing-required-prop` | Warning | Required prop missing at call site |
| `owl/unknown-prop-passed` | Warning | Unknown prop passed to component |
| `owl/duplicate-template-name` | Warning | Two components share the same template name |
| `owl/normalize-import` | Hint | Import path can use `@addon/` alias |

### Code Actions (Quick Fixes)
- **Auto-import** any OWL hook, component or utility function with a single click
- **Merge imports** — never creates duplicate import statements; merges into existing imports sorted alphabetically
- **Normalize import paths** — convert `../../../../../../odoo/addons/web/static/src/core/popover/popover_hook` to `@web/core/popover/popover_hook`

### Document & Workspace Symbols
- List all OWL components in the current file
- Search components across the entire workspace (`Ctrl+T`)

### Real-time Scan Status Bar
- Shows scanning progress: `⟳ OWL: 150/320 files | 24 components, 8 services, 42 utilities`
- Disappears automatically 5 seconds after scan completes

---

## Requirements

- Visual Studio Code `^1.110.0`
- An Odoo workspace with addons following the standard structure:
  ```
  {odoo_root}/
    addons/
      web/static/src/...
      mail/static/src/...
      my_addon/static/src/...
  ```

---

## Odoo Path Alias Resolution

The extension automatically detects your Odoo installation and builds alias mappings:

| Alias | Resolves to |
|-------|-------------|
| `@web/*` | `{odoo}/addons/web/static/src/*` |
| `@mail/*` | `{odoo}/addons/mail/static/src/*` |
| `@{addon}/*` | `{odoo}/addons/{addon}/static/src/*` |

Aliases are used in completions, hover tooltips, code actions, and diagnostics automatically.

---

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `owlIntelliSense.enable` | boolean | `true` | Enable/disable the extension |
| `owlIntelliSense.odooRoot` | string | `""` | Path to Odoo root (auto-detected if empty) |
| `owlIntelliSense.scanExcludes` | string[] | see below | Glob patterns excluded from scanning |
| `owlIntelliSense.trace.server` | enum | `"off"` | LSP trace level: `off`, `messages`, `verbose` |

**Default scan excludes:**
```json
[
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/.git/**",
  "**/static/src/lib/**",
  "**/static/src/libs/**",
  "**/static/lib/**"
]
```

> `lib` directories inside `static/src` are always skipped — they contain third-party libraries, not OWL source.

---

## Architecture

The extension uses a client/server LSP architecture:

- **Client** (`dist/client/extension.js`) — VSCode extension host process; manages the status bar and starts the server
- **Server** (`dist/server/server.js`) — standalone Node.js LSP server; owns the symbol index, AST parser, workspace scanner and all language features

The server process communicates with VSCode via IPC transport and can be independently debugged by attaching to port `6009`.

---

## Release Notes

### 0.1.0

Initial release:
- LSP client/server split with IPC transport
- AST-based workspace scanner for Odoo addon sources
- Symbol index: components, services, registries, functions, imports
- Completion, hover, definition, references, symbols, diagnostics, code actions
- OWL `@addon/` alias resolution
- 13 static analysis rules
- Real-time status bar scanning progress
