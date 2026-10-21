import * as vscode from "vscode";
import WebSocket from "ws";
import { Color } from "./board";

export type Status = "waiting" | "playing" | "checkmate" | "stalemate" | "draw" | "resigned" | "aborted";

export interface StateMsg {
  type: "state";
  fen: string;
  moves: string[];
  turn: Color;
  check: boolean;
  status: Status;
  winner: Color | null;
  reason: string | null;
  drawOffer: Color | null;
  players: Record<Color, boolean>;
  online: Record<Color, boolean>;
}

export interface WelcomeMsg {
  type: "welcome";
  color: Color;
  token: string;
}

export interface ErrorMsg {
  type: "error";
  code: string;
}

type ServerMsg = StateMsg | WelcomeMsg | ErrorMsg;

/** Close codes the server uses for errors that must not trigger a reconnect. */
const FATAL_CLOSE = new Set([4000, 4001]);

export class Session implements vscode.Disposable {
  private ws?: WebSocket;
  private pingTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private retryDelay = 1000;
  private disposed = false;

  private readonly _onState = new vscode.EventEmitter<StateMsg>();
  private readonly _onWelcome = new vscode.EventEmitter<WelcomeMsg>();
  private readonly _onError = new vscode.EventEmitter<ErrorMsg>();
  private readonly _onConnected = new vscode.EventEmitter<boolean>();
  readonly onState = this._onState.event;
  readonly onWelcome = this._onWelcome.event;
  readonly onError = this._onError.event;
  readonly onConnected = this._onConnected.event;

  constructor(
    private readonly endpoint: string,
    readonly room: string,
    private intent: "create" | "join",
    private token?: string,
  ) {}

  connect(): void {
    const base = this.endpoint.replace(/\/+$/, "").replace(/^http/, "ws");
    const ws = new WebSocket(`${base}/rooms/${this.room}/ws`);
    this.ws = ws;

    ws.on("open", () => {
      this.retryDelay = 1000;
      this._onConnected.fire(true);
      ws.send(JSON.stringify({ type: "hello", intent: this.intent, token: this.token }));
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
    });

    ws.on("message", (raw) => {
      const text = raw.toString();
      if (text === "pong") return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        // Any later reconnect must re-attach to the seat we were given.
        this.token = msg.token;
        this.intent = "join";
        this._onWelcome.fire(msg);
      } else if (msg.type === "state") {
        this._onState.fire(msg);
      } else if (msg.type === "error") {
        this._onError.fire(msg);
      }
    });

    ws.on("close", (code) => {
      clearInterval(this.pingTimer);
      this._onConnected.fire(false);
      if (this.disposed || FATAL_CLOSE.has(code)) return;
      this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 15_000);
    });

    ws.on("error", () => {
      /* "close" follows and handles the retry */
    });
  }

  send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this._onState.dispose();
    this._onWelcome.dispose();
    this._onError.dispose();
    this._onConnected.dispose();
  }
}
