/**
 * SES Context OS - VS Code Extension
 * 
 * Automatic project context capture with zero-cost switching
 */

const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

let contextCapture = null;
let autoSaveTimer = null;

// ============================================
// Extension Activation
// ============================================

async function activate(context) {
  console.log('SES Context OS extension activated');

  contextCapture = new ContextCapture(context);
  await contextCapture.initialize();

  // Register commands
  registerCommands(context);

  // Setup auto-capture
  setupAutoCapture(context);

  // Register event listeners
  registerEventListeners(context);

  // Create tree view providers
  createTreeViews(context);

  // Status bar item
  createStatusBar(context);
}

function deactivate() {
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer);
  }
}

// ============================================
// Context Capture Implementation
// ============================================

class ContextCapture {
  constructor(context) {
    this.extensionContext = context;
    this.contexts = new Map();
    this.currentContextId = null;
  }

  async initialize() {
    // Load saved contexts
    const saved = this.extensionContext.globalState.get('ses_contexts', []);
    saved.forEach(ctx => {
      this.contexts.set(ctx.id, ctx);
    });

    console.log(`Loaded ${this.contexts.size} saved contexts`);
  }

  async captureCurrentContext(name = null) {
    const timestamp = Date.now();
    const id = `ctx-${timestamp}`;

    const context = {
      id,
      name: name || `Context ${new Date().toLocaleString()}`,
      timestamp,
      workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      openFiles: await this.getOpenFiles(),
      activeFile: this.getActiveFile(),
      selections: this.getSelections(),
      breakpoints: this.getBreakpoints(),
      tasks: await this.getRunningTasks(),
      terminals: this.getTerminalInfo(),
      gitBranch: await this.getGitBranch()
    };

    this.contexts.set(id, context);
    this.currentContextId = id;

    await this.save();

    return context;
  }

  async getOpenFiles() {
    return vscode.workspace.textDocuments
      .filter(doc => !doc.isUntitled && doc.uri.scheme === 'file')
      .map(doc => ({
        path: doc.uri.fsPath,
        languageId: doc.languageId,
        isDirty: doc.isDirty,
        lineCount: doc.lineCount
      }));
  }

  getActiveFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    return {
      path: editor.document.uri.fsPath,
      selection: {
        start: editor.selection.start.line,
        end: editor.selection.end.line
      },
      visibleRange: {
        start: editor.visibleRanges[0]?.start.line,
        end: editor.visibleRanges[0]?.end.line
      }
    };
  }

  getSelections() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return [];

    return editor.selections.map(sel => ({
      start: { line: sel.start.line, character: sel.start.character },
      end: { line: sel.end.line, character: sel.end.character },
      text: editor.document.getText(sel)
    }));
  }

  getBreakpoints() {
    return vscode.debug.breakpoints.map(bp => {
      if (bp instanceof vscode.SourceBreakpoint) {
        return {
          type: 'source',
          file: bp.location.uri.fsPath,
          line: bp.location.range.start.line,
          enabled: bp.enabled,
          condition: bp.condition,
          hitCondition: bp.hitCondition
        };
      }
      return null;
    }).filter(Boolean);
  }

  async getRunningTasks() {
    return vscode.tasks.taskExecutions.map(exec => ({
      name: exec.task.name,
      source: exec.task.source,
      type: exec.task.definition.type
    }));
  }

  getTerminalInfo() {
    return vscode.window.terminals.map(term => ({
      name: term.name,
      processId: term.processId
    }));
  }

  async getGitBranch() {
    try {
      const gitExtension = vscode.extensions.getExtension('vscode.git');
      if (!gitExtension) return null;

      const git = gitExtension.exports.getAPI(1);
      const repo = git.repositories[0];
      if (!repo) return null;

      return {
        branch: repo.state.HEAD?.name,
        changes: repo.state.workingTreeChanges.length,
        staged: repo.state.indexChanges.length
      };
    } catch (err) {
      return null;
    }
  }

  async switchContext(contextId) {
    const context = this.contexts.get(contextId);
    if (!context) {
      throw new Error('Context not found');
    }

    // Close all editors
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // Open files
    for (const file of context.openFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file.path);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        console.error(`Failed to open ${file.path}:`, err);
      }
    }

    // Restore active file and selection
    if (context.activeFile) {
      try {
        const doc = await vscode.workspace.openTextDocument(context.activeFile.path);
        const editor = await vscode.window.showTextDocument(doc);
        
        if (context.activeFile.selection) {
          const start = new vscode.Position(context.activeFile.selection.start, 0);
          const end = new vscode.Position(context.activeFile.selection.end, 0);
          editor.selection = new vscode.Selection(start, end);
          editor.revealRange(new vscode.Range(start, end));
        }
      } catch (err) {
        console.error('Failed to restore active file:', err);
      }
    }

    // Restore breakpoints
    const currentBreakpoints = vscode.debug.breakpoints;
    vscode.debug.removeBreakpoints(currentBreakpoints);

    for (const bp of context.breakpoints) {
      const uri = vscode.Uri.file(bp.file);
      const pos = new vscode.Position(bp.line, 0);
      const location = new vscode.Location(uri, pos);
      
      const breakpoint = new vscode.SourceBreakpoint(location, bp.enabled);
      vscode.debug.addBreakpoints([breakpoint]);
    }

    this.currentContextId = contextId;

    vscode.window.showInformationMessage(`Switched to context: ${context.name}`);
  }

  async deleteContext(contextId) {
    this.contexts.delete(contextId);
    await this.save();
  }

  async save() {
    const data = Array.from(this.contexts.values());
    await this.extensionContext.globalState.update('ses_contexts', data);
  }

  getAllContexts() {
    return Array.from(this.contexts.values())
      .sort((a, b) => b.timestamp - a.timestamp);
  }
}

// ============================================
// Commands
// ============================================

function registerCommands(context) {
  // Capture context
  context.subscriptions.push(
    vscode.commands.registerCommand('ses.captureContext', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter context name',
        placeHolder: 'My Project Context'
      });

      if (name) {
        const ctx = await contextCapture.captureCurrentContext(name);
        vscode.window.showInformationMessage(`Context "${name}" captured`);
      }
    })
  );

  // Switch context
  context.subscriptions.push(
    vscode.commands.registerCommand('ses.switchContext', async () => {
      const contexts = contextCapture.getAllContexts();
      
      const items = contexts.map(ctx => ({
        label: ctx.name,
        description: new Date(ctx.timestamp).toLocaleString(),
        detail: `${ctx.openFiles.length} files, ${ctx.breakpoints.length} breakpoints`,
        contextId: ctx.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select context to switch to'
      });

      if (selected) {
        await contextCapture.switchContext(selected.contextId);
      }
    })
  );

  // Save workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('ses.saveWorkspace', async () => {
      await contextCapture.captureCurrentContext();
      vscode.window.showInformationMessage('Workspace saved');
    })
  );

  // Load workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('ses.loadWorkspace', async () => {
      await vscode.commands.executeCommand('ses.switchContext');
    })
  );

  // View contexts
  context.subscriptions.push(
    vscode.commands.registerCommand('ses.viewContexts', async () => {
      const contexts = contextCapture.getAllContexts();
      
      const panel = vscode.window.createWebviewPanel(
        'sesContexts',
        'SES Contexts',
        vscode.ViewColumn.One,
        {}
      );

      panel.webview.html = generateContextsHTML(contexts);
    })
  );
}

// ============================================
// Auto-capture
// ============================================

function setupAutoCapture(context) {
  const config = vscode.workspace.getConfiguration('ses');
  
  if (config.get('autoCapture')) {
    const interval = config.get('captureInterval', 60000);
    
    autoSaveTimer = setInterval(async () => {
      await contextCapture.captureCurrentContext();
    }, interval);

    context.subscriptions.push({
      dispose: () => {
        if (autoSaveTimer) {
          clearInterval(autoSaveTimer);
        }
      }
    });
  }
}

// ============================================
// Event Listeners
// ============================================

function registerEventListeners(context) {
  // On file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      const config = vscode.workspace.getConfiguration('ses');
      if (config.get('autoCapture')) {
        await contextCapture.captureCurrentContext();
      }
    })
  );

  // On active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      // Could trigger partial context update
    })
  );
}

// ============================================
// Tree Views
// ============================================

function createTreeViews(context) {
  // Context list tree view
  const contextListProvider = {
    getTreeItem: (element) => element,
    getChildren: () => {
      const contexts = contextCapture.getAllContexts();
      return contexts.map(ctx => {
        const item = new vscode.TreeItem(ctx.name);
        item.description = new Date(ctx.timestamp).toLocaleString();
        item.tooltip = `${ctx.openFiles.length} files`;
        item.command = {
          command: 'ses.switchContext',
          title: 'Switch to Context',
          arguments: [ctx.id]
        };
        return item;
      });
    }
  };

  vscode.window.createTreeView('sesContextList', {
    treeDataProvider: contextListProvider
  });
}

// ============================================
// Status Bar
// ============================================

function createStatusBar(context) {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  statusBar.text = '$(archive) SES';
  statusBar.tooltip = 'SES Context OS';
  statusBar.command = 'ses.captureContext';
  statusBar.show();

  context.subscriptions.push(statusBar);
}

// ============================================
// HTML Generation
// ============================================

function generateContextsHTML(contexts) {
  const contextItems = contexts.map(ctx => `
    <div class="context-item">
      <h3>${ctx.name}</h3>
      <p>Created: ${new Date(ctx.timestamp).toLocaleString()}</p>
      <p>Files: ${ctx.openFiles.length} | Breakpoints: ${ctx.breakpoints.length}</p>
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { padding: 20px; }
        .context-item {
          border: 1px solid #ccc;
          padding: 15px;
          margin-bottom: 10px;
          border-radius: 5px;
        }
        h3 { margin: 0 0 10px 0; }
        p { margin: 5px 0; color: #666; }
      </style>
    </head>
    <body>
      <h1>SES Contexts</h1>
      ${contextItems}
    </body>
    </html>
  `;
}

// ============================================
// Exports
// ============================================

module.exports = {
  activate,
  deactivate
};
