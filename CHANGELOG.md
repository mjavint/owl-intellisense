# Change Log

## Release Notes

### 1.0.0 - (2024-07-15)

- Updated package name to `Owl Intellisense` for better clarity and discoverability
- Added command to restart the LSP server from the VS Code command palette
- Migrate LSP in Go implementation to use JSON-RPC over IPC for improved performance and reliability
- Refactored workspace scanning to be AST-based for more accurate symbol indexing and diagnostics

### 0.1.0 - (2024-06-30)

Initial release:

- LSP client/server split with IPC transport
- AST-based workspace scanner for Odoo addon sources
- Symbol index: components, services, registries, functions, imports
- Completion, hover, definition, references, symbols, diagnostics, code actions
- OWL `@addon/` alias resolution
- 18 static analysis rules
- Real-time status bar scanning progress
