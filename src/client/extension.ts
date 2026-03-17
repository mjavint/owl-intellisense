import * as vscode from 'vscode';
import { createClient } from './client';
import { LanguageClient } from 'vscode-languageclient/node';

let client: LanguageClient;
let statusBar: vscode.StatusBarItem;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Check if extension is enabled
  const config = vscode.workspace.getConfiguration('owlIntelliSense');
  if (!config.get<boolean>('enable', true)) {
    return;
  }

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  context.subscriptions.push(statusBar);

  client = createClient(context);

  client.onNotification('owl/scanStarted', () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = undefined; }
    statusBar.text = '$(loading~spin) OWL: scanning...';
    statusBar.tooltip = 'OWL IntelliSense — scanning workspace';
    statusBar.show();
  });

  client.onNotification('owl/scanProgress', (params: {
    scannedFiles: number;
    totalFiles: number;
    componentCount: number;
    serviceCount: number;
    functionCount: number;
  }) => {
    const parts: string[] = [];
    if (params.componentCount > 0) { parts.push(`${params.componentCount} components`); }
    if (params.serviceCount > 0) { parts.push(`${params.serviceCount} services`); }
    if (params.functionCount > 0) { parts.push(`${params.functionCount} utilities`); }
    const summary = parts.length > 0 ? parts.join(', ') : 'analyzing...';
    statusBar.text = `$(loading~spin) OWL: ${params.scannedFiles}/${params.totalFiles} files | ${summary}`;
    statusBar.tooltip = `OWL IntelliSense — scanning workspace (${params.scannedFiles}/${params.totalFiles})`;
  });

  client.onNotification('owl/scanComplete', (params: {
    componentCount: number;
    serviceCount: number;
    functionCount: number;
    fileCount: number;
    durationMs: number;
  }) => {
    const parts: string[] = [];
    if (params.componentCount > 0) { parts.push(`${params.componentCount} components`); }
    if (params.serviceCount > 0) { parts.push(`${params.serviceCount} services`); }
    if (params.functionCount > 0) { parts.push(`${params.functionCount} utilities`); }
    const summary = parts.join(', ') || 'no OWL symbols found';
    statusBar.text = `$(check) OWL: ${summary}`;
    statusBar.tooltip = `OWL IntelliSense — ${params.fileCount} files scanned in ${params.durationMs}ms`;

    // Hide after 5 seconds
    if (hideTimer) { clearTimeout(hideTimer); }
    hideTimer = setTimeout(() => {
      statusBar.hide();
      hideTimer = undefined;
    }, 5000);
  });

  // Register restart command
  const restartCommand = vscode.commands.registerCommand(
    'owl-intellisense.restartServer',
    async () => {
      await client.restart();
    }
  );
  context.subscriptions.push(restartCommand);

  await client.start();
}

export async function deactivate(): Promise<void> {
  if (client) {await client.stop();}
}
