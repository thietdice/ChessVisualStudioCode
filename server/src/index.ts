import { DurableObject } from "cloudflare:workers";
import { Chess } from "chess.js";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

type Color = "w" | "b";
type Status = "waiting" | "playing" | "checkmate" | "stalemate" | "draw" | "resigned" | "aborted";

interface RoomData {
  tokens: Partial<Record<Color, string>>;
  moves: string[]; // UCI, e.g. "e2e4", "e7e8q"
  status: Status;
  winner: Color | null;
  reason: string | null;
  drawOffer: Color | null;
}

type ClientMsg =
  | { type: "hello"; intent: "create" | "join"; token?: string }
  | { type: "move"; uci: string }
  | { type: "resign" }
  | { type: "draw_offer" }
  | { type: "draw_accept" }
  | { type: "draw_decline" };

const ROOM_CODE = /^[A-Z0-9]{4,12}$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const IDLE_TTL_MS = 24 * 60 * 60 * 1000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/rooms\/([^/]+)\/ws$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!ROOM_CODE.test(code)) return new Response("bad room code", { status: 400 });
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    if (url.pathname === "/health") return new Response("ok");
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so idle rooms stay hibernated.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(): Promise<Response> {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendError(ws, "bad_json");
    }

    if (msg.type === "hello") return this.onHello(ws, msg);

    const color = (ws.deserializeAttachment() as { color?: Color } | null)?.color;
    const data = await this.load();
    if (!color || !data) return this.sendError(ws, "not_joined");
    if (data.status !== "playing") return this.sendError(ws, "game_over");

    switch (msg.type) {
      case "move":
        return this.onMove(ws, data, color, msg.uci);
      case "resign":
        data.status = "resigned";
        data.winner = other(color);
        data.reason = "resign";
        break;
      case "draw_offer":
        data.drawOffer = color;
        break;
      case "draw_accept":
        if (data.drawOffer !== other(color)) return this.sendError(ws, "no_draw_offer");
        data.status = "draw";
        data.reason = "agreement";
        data.drawOffer = null;
        break;
      case "draw_decline":
        data.drawOffer = null;
        break;
      default:
        return this.sendError(ws, "unknown_type");
    }
    await this.save(data);
    this.broadcast(data);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try { ws.close(code, "closing"); } catch { /* already closed */ }
    const data = await this.load();
    if (data) this.broadcast(data);
  }

  async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS);
      return;
    }
    await this.ctx.storage.deleteAll();
  }

  private async onHello(ws: WebSocket, msg: Extract<ClientMsg, { type: "hello" }>): Promise<void> {
    let data = await this.load();

    if (!data) {
      if (msg.intent !== "create") return this.sendError(ws, "not_found", true);
      data = { tokens: {}, moves: [], status: "waiting", winner: null, reason: null, drawOffer: null };
    } else if (msg.intent === "create" && !msg.token) {
      return this.sendError(ws, "exists", true);
    }

    let color = (Object.keys(data.tokens) as Color[]).find((c) => msg.token && data!.tokens[c] === msg.token);
    let token = msg.token;
    if (!color) {
      const free = (["w", "b"] as Color[]).filter((c) => !data!.tokens[c]);
      if (free.length === 0) return this.sendError(ws, "room_full", true);
      color = free[Math.floor(Math.random() * free.length)];
      token = crypto.randomUUID();
      data.tokens[color] = token;
      if (data.tokens.w && data.tokens.b && data.status === "waiting") data.status = "playing";
    }

    // Drop any older socket for the same seat (e.g. a reload on the same machine).
    for (const other of this.ctx.getWebSockets()) {
      if (other !== ws && (other.deserializeAttachment() as { color?: Color } | null)?.color === color) {
        try { other.close(4000, "replaced"); } catch { /* ignore */ }
      }
    }
    ws.serializeAttachment({ color });

    await this.save(data);
    ws.send(JSON.stringify({ type: "welcome", color, token }));
    this.broadcast(data);
  }

  private async onMove(ws: WebSocket, data: RoomData, color: Color, uci: string): Promise<void> {
    if (!UCI.test(uci)) return this.sendError(ws, "bad_move");
    const chess = replay(data.moves);
    if (chess.turn() !== color) return this.sendError(ws, "not_your_turn");

    const from = uci.slice(0, 2) as any;
    const to = uci.slice(2, 4) as any;
    let promotion = uci[4];
    const piece = chess.get(from);
    if (piece?.type === "p" && (to[1] === "8" || to[1] === "1")) promotion ??= "q";

    let made;
    try {
      made = chess.move({ from, to, promotion });
    } catch {
      return this.sendError(ws, "illegal_move");
    }

    data.moves.push(made.from + made.to + (made.promotion ?? ""));
    data.drawOffer = null;
    if (chess.isCheckmate()) {
      data.status = "checkmate";
      data.winner = color;
      data.reason = "checkmate";
    } else if (chess.isStalemate()) {
      data.status = "stalemate";
      data.reason = "stalemate";
    } else if (chess.isDraw()) {
      data.status = "draw";
      data.reason = chess.isInsufficientMaterial() ? "insufficient_material"
        : chess.isThreefoldRepetition() ? "threefold_repetition" : "fifty_moves";
    }
    await this.save(data);
    this.broadcast(data);
  }

  private broadcast(data: RoomData): void {
    const chess = replay(data.moves);
    const online = new Set(
      this.ctx.getWebSockets()
        .map((s) => (s.deserializeAttachment() as { color?: Color } | null)?.color)
        .filter(Boolean),
    );
    const payload = JSON.stringify({
      type: "state",
      fen: chess.fen(),
      moves: data.moves,
      turn: chess.turn(),
      check: chess.inCheck(),
      status: data.status,
      winner: data.winner,
      reason: data.reason,
      drawOffer: data.drawOffer,
      players: { w: !!data.tokens.w, b: !!data.tokens.b },
      online: { w: online.has("w"), b: online.has("b") },
    });
    for (const s of this.ctx.getWebSockets()) {
      try { s.send(payload); } catch { /* socket gone */ }
    }
  }

  private sendError(ws: WebSocket, code: string, close = false): void {
    try {
      ws.send(JSON.stringify({ type: "error", code }));
      if (close) ws.close(4001, code);
    } catch { /* ignore */ }
  }

  private load(): Promise<RoomData | undefined> {
    return this.ctx.storage.get<RoomData>("room");
  }

  private async save(data: RoomData): Promise<void> {
    await this.ctx.storage.put("room", data);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_TTL_MS);
  }
}

function replay(moves: string[]): Chess {
  const chess = new Chess();
  for (const m of moves) chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return chess;
}

function other(c: Color): Color {
  return c === "w" ? "b" : "w";
}
