# Change Log

## Release Notes

### 1.1.0 - (2026-04-02)

- Updated package name to `Owl Intellisense` for better clarity and discoverability
- Added command to restart the LSP server from the VS Code command palette
- Fixed an issue where the LSP server would not restart properly on Windows due to IPC transport limitations
- Improved error handling and logging for better debugging of LSP server issues

### 1.0.4 - (2026-03-27)

- Added support for Windows named pipes in the LSP server IPC transport layer to improve compatibility and performance on Windows platforms
- Minor bug fixes and performance improvements in the LSP server and client implementations

### 1.0.3 - (2026-03-27)

- Added support for Windows named pipes in the LSP server IPC transport layer to improve compatibility and performance on Windows platforms
- Updated documentation to reflect the new package name and installation instructions
- Minor bug fixes and performance improvements in the LSP server and client implementations

### 1.0.2 - (2026-03-27)

- Fixed an issue where the LSP server would not restart properly on Windows due to IPC transport limitations
- Improved error handling and logging for better debugging of LSP server issues

### 1.0.0 - (2026-03-26)

- Updated package name to `Owl Intellisense` for better clarity and discoverability
- Added command to restart the LSP server from the VS Code command palette
- Migrate LSP in Go implementation to use JSON-RPC over IPC for improved performance and reliability
- Refactored workspace scanning to be AST-based for more accurate symbol indexing and diagnostics

### 0.1.0 - (2026-06-30)

Initial release:

- LSP client/server split with IPC transport
- AST-based workspace scanner for Odoo addon sources
- Symbol index: components, services, registries, functions, imports
- Completion, hover, definition, references, symbols, diagnostics, code actions
- OWL `@addon/` alias resolution
- 18 static analysis rules
- Real-time status bar scanning progress
