import * as vscode from "vscode";
import { Chess } from "chess.js";
import { Color, findKing, parseFen, pieceAt } from "./board";
import { FILE_URI, MatrixFileSystem, SCHEME } from "./fs";
import { ErrorMsg, Session, StateMsg } from "./net";
import { Layout, parsePending, render } from "./render";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const TOKENS_KEY = "kvsync.tokens";
const LAST_ROOM_KEY = "kvsync.lastRoom";

// Server error codes rendered as compiler diagnostics on the PendingBatch line.
const ERROR_TEXT: Record<string, string> = {
  illegal_move: "CS1503: Argument 1: cannot convert from 'string' to 'Kv.Core.Inventory.BatchKey'",
  bad_move: "CS1503: Argument 1: cannot convert from 'string' to 'Kv.Core.Inventory.BatchKey'",
  not_your_turn: "CS4014: Because this call is not awaited, execution of the current method continues",
  game_over: "CS0162: Unreachable code detected",
  not_joined: "CS0120: An object reference is required for the non-static field 'StockMatrix._cache'",
};

export function activate(ctx: vscode.ExtensionContext): void {
  const controller = new Controller(ctx);
  ctx.subscriptions.push(
    controller,
    vscode.commands.registerCommand("kvsync.open", () => controller.create()),
    vscode.commands.registerCommand("kvsync.attach", () => controller.attach()),
    vscode.commands.registerCommand("kvsync.mark", () => controller.mark()),
    vscode.commands.registerCommand("kvsync.toggle", () => controller.toggleHidden()),
    vscode.commands.registerCommand("kvsync.resign", () => controller.resign()),
    vscode.commands.registerCommand("kvsync.offerDraw", () => controller.send({ type: "draw_offer" })),
    vscode.commands.registerCommand("kvsync.acceptDraw", () => controller.send({ type: "draw_accept" })),
    vscode.commands.registerCommand("kvsync.copyKey", () => controller.copyKey()),
    vscode.commands.registerCommand("kvsync.close", () => controller.stop()),
    vscode.commands.registerCommand("kvsync.menu", () => controller.menu()),
  );
}

export function deactivate(): void {}

class Controller implements vscode.Disposable {
  private session?: Session;
  private color?: Color;
  private state?: StateMsg;
  private layout?: Layout;
  private text = "";
  private selected?: string;
  private hidden = false;
  private error?: string;
  private connected = false;
  private lastMoveAt = Date.now();
  private notified = new Set<string>();

  private readonly fs = new MatrixFileSystem((text) => this.onSave(text));
  private readonly statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("csharp");
  private readonly lastMoveDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
  });
  private readonly selectedDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.selectionHighlightBackground"),
    border: "1px solid",
    borderColor: new vscode.ThemeColor("editorCursor.foreground"),
  });
  private readonly targetDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    border: "1px dotted",
    borderColor: new vscode.ThemeColor("editorLineNumber.activeForeground"),
  });
  private readonly blameDeco = vscode.window.createTextEditorDecorationType({
    after: { color: new vscode.ThemeColor("editorCodeLens.foreground"), fontStyle: "italic", margin: "0 0 0 3em" },
  });
  private readonly blameTimer = setInterval(() => this.decorate(), 30_000);

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.statusItem.command = "kvsync.menu";
    ctx.subscriptions.push(
      vscode.workspace.registerFileSystemProvider(SCHEME, this.fs, { isCaseSensitive: true }),
      this.statusItem,
      this.diagnostics,
      this.lastMoveDeco,
      this.selectedDeco,
      this.targetDeco,
      this.blameDeco,
      vscode.window.onDidChangeVisibleTextEditors(() => this.decorate()),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === FILE_URI.toString()) this.decorate();
      }),
    );
  }

  // ---- commands -------------------------------------------------------------

  async create(): Promise<void> {
    await this.start(randomCode(), "create");
  }

  async attach(): Promise<void> {
    const input = await vscode.window.showInputBox({
      prompt: "Session key",
      value: this.ctx.globalState.get<string>(LAST_ROOM_KEY),
      ignoreFocusOut: true,
    });
    const room = input?.trim().toUpperCase();
    if (!room) return;
    const tokens = this.ctx.globalState.get<Record<string, string>>(TOKENS_KEY) ?? {};
    await this.start(room, "join", tokens[room]);
  }

  mark(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== FILE_URI.toString()) return;
    if (this.hidden || !this.layout || !this.state || !this.color) return;

    const pos = editor.selection.active;
    const square = this.layout.squareAt(pos.line, pos.character);
    if (!square) return;

    const piece = pieceAt(parseFen(this.state.fen), square);
    const own = piece?.color === this.color;
    if (!this.selected || own) {
      // Select an own piece; pressing again on the selected one clears it.
      this.selected = own && square !== this.selected ? square : undefined;
    } else {
      this.sendMove(this.selected + square);
      this.selected = undefined;
    }
    this.decorate();
  }

  toggleHidden(): void {
    this.hidden = !this.hidden;
    this.selected = undefined;
    this.refresh(true);
  }

  async resign(): Promise<void> {
    const ok = await vscode.window.showWarningMessage("Abort current batch?", { modal: true }, "Abort");
    if (ok) this.send({ type: "resign" });
  }

  send(msg: object): void {
    this.session?.send(msg);
  }

  async copyKey(): Promise<void> {
    if (!this.session) return;
    await vscode.env.clipboard.writeText(this.session.room);
    vscode.window.setStatusBarMessage(`Session key ${this.session.room} copied`, 3000);
  }

  async menu(): Promise<void> {
    const offeredToMe = this.state?.drawOffer && this.state.drawOffer !== this.color;
    const items: (vscode.QuickPickItem & { cmd: string })[] = [
      { label: "$(copy) Copy session key", description: this.session?.room, cmd: "kvsync.copyKey" },
      ...(offeredToMe
        ? [{ label: "$(git-merge) Accept merge request", cmd: "kvsync.acceptDraw" }]
        : [{ label: "$(git-pull-request) Propose merge", cmd: "kvsync.offerDraw" }]),
      { label: "$(eye-closed) Toggle preview", cmd: "kvsync.toggle" },
      { label: "$(circle-slash) Abort batch", cmd: "kvsync.resign" },
      { label: "$(close) Close session", cmd: "kvsync.close" },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: "Kv.Core" });
    if (pick) await vscode.commands.executeCommand(pick.cmd);
  }

  stop(): void {
    this.session?.dispose();
    this.session = undefined;
    this.state = undefined;
    this.color = undefined;
    this.selected = undefined;
    this.error = undefined;
    this.statusItem.hide();
    this.diagnostics.clear();
    this.refresh(true);
  }

  dispose(): void {
    clearInterval(this.blameTimer);
    this.session?.dispose();
  }

  // ---- session --------------------------------------------------------------

  private async start(room: string, intent: "create" | "join", token?: string): Promise<void> {
    const endpoint = vscode.workspace.getConfiguration("kvsync").get<string>("endpoint");
    if (!endpoint) {
      vscode.window.showErrorMessage("kvsync.endpoint is not configured.");
      return;
    }
    this.stop();

    const session = new Session(endpoint, room, intent, token);
    this.session = session;
    this.notified.clear();
    session.onWelcome(async (w) => {
      this.color = w.color;
      const tokens = this.ctx.globalState.get<Record<string, string>>(TOKENS_KEY) ?? {};
      await this.ctx.globalState.update(TOKENS_KEY, { ...tokens, [room]: w.token });
      await this.ctx.globalState.update(LAST_ROOM_KEY, room);
      if (intent === "create" && !token) {
        await vscode.env.clipboard.writeText(room);
        vscode.window.showInformationMessage(`Session ${room} ready (key copied to clipboard).`);
      }
      this.refresh();
    });
    session.onState((s) => this.onState(s));
    session.onError((e) => this.onServerError(e, session, intent));
    session.onConnected((c) => {
      this.connected = c;
      this.updateStatusBar();
    });
    session.connect();

    this.refresh(true);
    const doc = await vscode.workspace.openTextDocument(FILE_URI);
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  private onServerError(e: ErrorMsg, session: Session, intent: "create" | "join"): void {
    if (session !== this.session) return;
    switch (e.code) {
      case "exists":
        if (intent === "create") void this.create();
        return;
      case "not_found":
        vscode.window.showErrorMessage(`Session ${session.room} not found.`);
        this.stop();
        return;
      case "room_full":
        vscode.window.showErrorMessage(`Session ${session.room} is locked by another process.`);
        this.stop();
        return;
      default:
        this.error = e.code;
        this.refresh();
    }
  }

  private onState(s: StateMsg): void {
    if (s.moves.length !== this.state?.moves.length) {
      this.lastMoveAt = Date.now();
      this.selected = undefined;
    }
    this.state = s;
    this.error = undefined;
    this.refresh();

    const me = this.color;
    if (s.status === "playing" && s.drawOffer && s.drawOffer !== me && this.once(`draw:${s.moves.length}`)) {
      void vscode.window
        .showInformationMessage("Merge request received from upstream.", "Accept", "Decline")
        .then((pick) => {
          if (pick === "Accept") this.send({ type: "draw_accept" });
          else if (pick === "Decline") this.send({ type: "draw_decline" });
        });
    }
    if (s.status !== "playing" && s.status !== "waiting" && this.once("end")) {
      if (!s.winner) vscode.window.showWarningMessage("Build succeeded with warnings.");
      else if (s.winner === me) vscode.window.showInformationMessage("Build succeeded.");
      else vscode.window.showErrorMessage("Build failed: 1 error.");
    }
  }

  private onSave(text: string): void {
    const pending = parsePending(text);
    if (pending) {
      if (UCI.test(pending)) this.sendMove(pending);
      else this.error = "bad_move";
    }
    this.refresh(true);
  }

  private sendMove(uci: string): void {
    if (!this.session || this.state?.status !== "playing") {
      this.error = "game_over";
      this.refresh();
      return;
    }
    this.session.send({ type: "move", uci });
  }

  private once(key: string): boolean {
    if (this.notified.has(key)) return false;
    this.notified.add(key);
    return true;
  }

  // ---- rendering ------------------------------------------------------------

  private refresh(force = false): void {
    this.layout = render({
      grid: parseFen(this.state?.fen ?? START_FEN),
      orientation: this.color ?? "w",
      sessionKey: this.session?.room ?? "",
      status: this.hidden ? "Idle" : this.statusLabel(),
      hidden: this.hidden,
    });
    if (force || this.layout.text !== this.text) {
      this.text = this.layout.text;
      this.fs.setContent(this.text);
    }
    this.updateDiagnostics();
    this.updateStatusBar();
    this.decorate();
  }

  private statusLabel(): string {
    const s = this.state;
    if (!s || s.status === "waiting") return "Idle";
    if (s.status === "playing") return s.turn === this.color ? "Pending" : "Queued";
    if (!s.winner) return "Merged";
    return s.winner === this.color ? "Committed" : "RolledBack";
  }

  private updateStatusBar(): void {
    if (!this.session) return this.statusItem.hide();
    const s = this.state;
    let text = "$(check) Kv.Core";
    if (this.hidden) {
      text = "$(check) Kv.Core";
    } else if (!this.connected) {
      text = "$(sync~spin) Kv.Core";
    } else if (!s || s.status === "waiting") {
      text = "$(sync~spin) Kv.Core: restoring";
    } else if (s.status === "playing") {
      if (s.drawOffer && s.drawOffer !== this.color) text = "$(git-pull-request) Kv.Core: 1 review";
      else if (s.turn === this.color) text = "$(git-commit) Kv.Core: 1 pending";
      const opponent = this.color === "w" ? "b" : "w";
      if (!s.online[opponent]) text += " $(debug-disconnect)";
    } else if (!s.winner) {
      text = "$(warning) Kv.Core: built with warnings";
    } else {
      text = s.winner === this.color ? "$(pass) Kv.Core: build succeeded" : "$(error) Kv.Core: build failed";
    }
    this.statusItem.text = text;
    this.statusItem.tooltip = this.session.room;
    this.statusItem.show();
  }

  private updateDiagnostics(): void {
    const layout = this.layout;
    const s = this.state;
    const list: vscode.Diagnostic[] = [];
    if (layout && !this.hidden) {
      if (s?.status === "playing" && s.check && s.turn === this.color) {
        const king = findKing(parseFen(s.fen), s.turn);
        if (king) {
          const p = layout.squarePos(king);
          const d = new vscode.Diagnostic(
            new vscode.Range(p.line, p.ch, p.line, p.ch + p.width),
            "'StockMatrix._grid' is obsolete: 'Use ResolveGrid() instead.'",
            vscode.DiagnosticSeverity.Warning,
          );
          d.code = "CS0618";
          d.source = "csharp";
          list.push(d);
        }
      }
      if (this.error) {
        const line = layout.pendingLine;
        const d = new vscode.Diagnostic(
          new vscode.Range(line, 8, line, 200),
          ERROR_TEXT[this.error] ?? `CS0103: The name '${this.error}' does not exist in the current context`,
          vscode.DiagnosticSeverity.Error,
        );
        d.source = "csharp";
        list.push(d);
      }
    }
    this.diagnostics.set(FILE_URI, list);
  }

  private decorate(): void {
    const editors = vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.toString() === FILE_URI.toString(),
    );
    const layout = this.layout;
    const s = this.state;
    const last = s?.moves.at(-1);
    const show = !this.hidden && layout && s;

    const cell = (sq: string) => {
      const p = layout!.squarePos(sq);
      return new vscode.Range(p.line, p.ch, p.line, p.ch + p.width);
    };
    const lastRanges = show && last ? [cell(last.slice(0, 2)), cell(last.slice(2, 4))] : [];
    const selRanges = show && this.selected ? [cell(this.selected)] : [];
    const targetRanges = show && this.selected && this.color
      ? legalTargets(s.fen, this.selected, this.color).map(cell)
      : [];
    const blame: vscode.DecorationOptions[] = [];
    if (show && last) {
      const line = layout.squarePos(last.slice(2, 4)).line;
      const mover: Color = (s.moves.length - 1) % 2 === 0 ? "w" : "b";
      const author = mover === this.color
        ? "You"
        : vscode.workspace.getConfiguration("kvsync").get<string>("author") || "dev-team";
      blame.push({
        range: new vscode.Range(line, 1000, line, 1000),
        renderOptions: { after: { contentText: `${author}, ${ago(this.lastMoveAt)} • fix: adjust batch ${last}` } },
      });
    }

    for (const e of editors) {
      e.setDecorations(this.lastMoveDeco, lastRanges);
      e.setDecorations(this.selectedDeco, selRanges);
      e.setDecorations(this.targetDeco, targetRanges);
      e.setDecorations(this.blameDeco, blame);
    }
  }
}

/**
 * Destination squares of the legal moves from `square`, evaluated as if it were `color`'s turn
 * so hints also show while waiting for the opponent.
 */
function legalTargets(fen: string, square: string, color: Color): string[] {
  try {
    const parts = fen.split(" ");
    if (parts[1] !== color) {
      parts[1] = color;
      parts[3] = "-"; // en passant only applies to the side actually on move
    }
    const moves = new Chess(parts.join(" ")).moves({ square: square as any, verbose: true });
    return [...new Set(moves.map((m) => m.to as string))];
  } catch {
    return [];
  }
}

function randomCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

function ago(t: number): string {
  const min = Math.floor((Date.now() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min > 1 ? "s" : ""} ago`;
  const h = Math.floor(min / 60);
  return `${h} hour${h > 1 ? "s" : ""} ago`;
}
