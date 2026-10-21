import * as vscode from "vscode";

export const SCHEME = "kvsrc";
export const FILE_PATH = "/Kv.Core/Services/Inventory/StockMatrix.cs";
export const FILE_URI = vscode.Uri.from({ scheme: SCHEME, path: FILE_PATH });

/**
 * Serves one virtual source file. Saving it hands the written text to `onSave`;
 * the controller then pushes fresh content via `setContent`.
 */
export class MatrixFileSystem implements vscode.FileSystemProvider {
  private content: Uint8Array = new Uint8Array();
  private mtime = Date.now();
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private readonly onSave: (text: string) => void) {}

  setContent(text: string): void {
    this.content = new TextEncoder().encode(text);
    this.mtime = Math.max(Date.now(), this.mtime + 1);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri: FILE_URI }]);
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    if (uri.path === FILE_PATH) {
      return { type: vscode.FileType.File, ctime: 0, mtime: this.mtime, size: this.content.byteLength };
    }
    if (FILE_PATH.startsWith(uri.path.replace(/\/?$/, "/")) || uri.path === "/") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const rest = FILE_PATH.slice(uri.path.replace(/\/?$/, "/").length).split("/");
    return rest[0] ? [[rest[0], rest.length === 1 ? vscode.FileType.File : vscode.FileType.Directory]] : [];
  }

  readFile(uri: vscode.Uri): Uint8Array {
    if (uri.path !== FILE_PATH) throw vscode.FileSystemError.FileNotFound(uri);
    return this.content;
  }

  writeFile(uri: vscode.Uri, data: Uint8Array): void {
    if (uri.path !== FILE_PATH) throw vscode.FileSystemError.NoPermissions(uri);
    this.content = data;
    this.mtime = Math.max(Date.now(), this.mtime + 1);
    const text = new TextDecoder().decode(data);
    // Let VS Code finish its save bookkeeping before the controller re-renders.
    setTimeout(() => this.onSave(text), 50);
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}
