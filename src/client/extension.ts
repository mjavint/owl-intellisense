import * as vscode from 'vscode';
import { createClient } from './client';
import { LanguageClient } from 'vscode-languageclient/node';

let client: LanguageClient;
let statusBar: vscode.StatusBarItem;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Check if extension is enabled
  const config = vscode.workspace.getConfiguration('owlIntelliSense');
  if (!config.get<boolean>('enable', true)) {
    return;
  }

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBar.text = '$(loading~spin) OWL: scanning...';
  statusBar.tooltip = 'OWL IntelliSense — scanning workspace';
  statusBar.show();
  context.subscriptions.push(statusBar);

  client = createClient(context);

  client.onNotification('owl/scanStarted', () => {
    statusBar.text = '$(loading~spin) OWL: scanning...';
    statusBar.tooltip = 'OWL IntelliSense — scanning workspace';
  });

  client.onNotification('owl/scanComplete', (params: { componentCount: number; fileCount: number; durationMs: number }) => {
    statusBar.text = `$(check) OWL: ${params.componentCount} components`;
    statusBar.tooltip = `OWL IntelliSense — indexed ${params.fileCount} files in ${params.durationMs}ms`;
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
