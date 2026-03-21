# OWL LSP

Language Server Protocol extension for **OWL 2.x (Odoo Web Library)** development in Visual Studio Code.

Provides intelligent code editing by scanning Odoo addon sources and building a live symbol index via AST analysis.

---

## Features

### Auto-completion

- **OWL built-in hooks** inside `setup()` — `useState`, `onMounted`, `useService`, `onWillStart`, etc.
- **Custom hooks** from addon sources — `usePopover`, `useChildRef` and any `use*` function indexed from your workspace
- **Utility functions** from addon files — `patch`, `url`, `browser`, `debounce`, `escape`, `markup`, `sprintf`, etc.
- **Component names** inside `static components = { }` assignments
- **Service methods** — auto-complete service class methods after `useService()`
- **Registry keys** — complete registry categories and keys (`registry.category(...)`)
- **Auto-import on accept** — imports are automatically inserted or merged using `@addon/` aliases

### Hover Documentation

- OWL hooks: full signature, description and return type
- Workspace components: props summary with types and optional flags
- Addon functions: JSDoc, signature and source alias path

### Go-to-Definition

- Jump to OWL component class declarations
- Resolve import specifiers (`{ MyComponent }`) to their source file
- Resolve import paths to actual files
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
| `owl/non-owl-component-import` | Warning | Component not imported from `@odoo/owl` |
| `owl/invalid-props-schema` | Error | `static props` has invalid value |
| `owl/unknown-prop-type` | Warning | Unknown type in props schema |
| `owl/missing-required-prop` | Warning | Required prop missing at call site |
| `owl/unknown-prop-passed` | Warning | Unknown prop passed to component |
| `owl/no-template` | Warning | Component with no `static template` |
| `owl/no-setup` | Info | Component has props but no `setup()` |
| `owl/template-ref-dynamic` | Warning | Dynamic template reference detected |
| `owl/duplicate-template-name` | Warning | Two components share the same template name |
| `owl/normalize-import` | Hint | Import path can use `@addon/` alias |
| `owl/unused-import` | Warning | Imported symbol is never used |
| `owl/duplicate-import` | Warning | Same module imported multiple times |
| `owl/duplicate-import-specifier` | Warning | Same symbol imported multiple times |

### Code Actions (Quick Fixes)

- **Auto-import** any OWL hook, component or utility function
- **Merge imports** — never creates duplicates; merges into existing imports sorted alphabetically
- **Normalize import paths** — convert long relative paths to `@addon/` aliases

### Document & Workspace Symbols

- List all OWL components in the current file
- Search components across the entire workspace

### Rename

- Rename OWL components across all files (imports + usages)

### Signature Help

- Shows function signature when typing inside function calls

### Inlay Hints

- Type annotations for props in component templates

### Semantic Tokens

- Syntax highlighting for OWL-specific constructs

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
| `owlLsp.enable` | boolean | `true` | Enable/disable the extension |
| `owlLsp.odooRoot` | string | `""` | Path to Odoo root (auto-detected if empty) |
| `owlLsp.scanExcludes` | string[] | see below | Glob patterns excluded from scanning |
| `owlLsp.trace.server` | enum | `"off"` | LSP trace level: `off`, `messages`, `verbose` |

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

## Commands

| Command | Description |
|---------|-------------|
| `OWL LSP: Restart Server` | Restart the LSP server (useful after adding new addons) |

### Debugging

The LSP server can be debugged by attaching to port `6009`.

---

## 📄 License

This extension is licensed under the [MIT License](LICENSE).
