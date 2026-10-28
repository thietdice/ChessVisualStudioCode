/**
 * Jieqi (cờ úp): xiangqi where every piece but the king starts face down on a shuffled start
 * square. A face-down piece moves as the piece that normally starts on its square and is turned
 * face up by its first move. Revealed advisors and elephants may go anywhere on the board.
 * A face-down piece that gets captured stays unknown to both players.
 *
 * The masked board (FEN with x/X for face-down pieces) is enough to generate every legal move,
 * because a face-down piece never leaves its start square. Only the server knows the layout,
 * which it needs to learn what a piece turns into.
 *
 * Keep server/src/jieqi.ts and extension/src/jieqi.ts identical.
 */

export type Color = "w" | "b";
export type Kind = "k" | "a" | "b" | "n" | "r" | "c" | "p";
/** Start square -> real identity of the face-down piece on it. Server-only secret. */
export type Layout = Record<string, Kind>;

interface Cell {
  color: Color;
  kind: Kind;
  hidden: boolean;
}

type Board = (Cell | null)[];

const FILES = "abcdefghi";
const BACK_RANK: Kind[] = ["r", "n", "b", "a", "k", "a", "b", "n", "r"];
const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const START_FEN = "xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w";

/** A fresh secret layout: each side's 15 non-king pieces shuffled over its start squares. */
export function randomLayout(rand: () => number = Math.random): Layout {
  const layout: Layout = {};
  for (const color of ["w", "b"] as Color[]) {
    const pool: Kind[] = ["a", "a", "b", "b", "n", "n", "r", "r", "c", "c", "p", "p", "p", "p", "p"];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let i = 0; i < 90; i++) {
      const role = startRole(color, i);
      if (role && role !== "k") layout[name(i)] = pool.pop()!;
    }
  }
  return layout;
}

export class Jieqi {
  private board: Board;
  private side: Color;

  constructor(fen = START_FEN) {
    const [rows, turn] = fen.split(" ");
    this.board = new Array(90).fill(null);
    rows.split("/").forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) {
          f += Number(ch);
          continue;
        }
        const lower = ch.toLowerCase();
        this.board[(9 - i) * 9 + f++] = {
          color: ch === lower ? "b" : "w",
          kind: lower === "x" ? "p" : (lower as Kind), // placeholder, a face-down piece moves by its square
          hidden: lower === "x",
        };
      }
    });
    this.side = turn === "b" ? "b" : "w";
  }

  turn(): Color {
    return this.side;
  }

  /** Masked FEN: face-down pieces are x/X, so it is safe to send to both players. */
  fen(): string {
    const rows: string[] = [];
    for (let r = 9; r >= 0; r--) {
      let row = "";
      let empty = 0;
      for (let f = 0; f < 9; f++) {
        const c = this.board[r * 9 + f];
        if (!c) {
          empty++;
          continue;
        }
        if (empty) row += empty;
        empty = 0;
        const ch = c.hidden ? "x" : c.kind;
        row += c.color === "w" ? ch.toUpperCase() : ch;
      }
      rows.push(row + (empty || ""));
    }
    return `${rows.join("/")} ${this.side}`;
  }

  /** Legal moves of the side to move, as "a0a1" strings, optionally only from `square`. */
  moves(square?: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < 90; i++) {
      const c = this.board[i];
      if (!c || c.color !== this.side || (square && name(i) !== square)) continue;
      for (const to of pseudoMoves(this.board, i)) {
        if (!exposed(apply(this.board, i, to), this.side)) out.push(name(i) + name(to));
      }
    }
    return out;
  }

  /** Plays a move, turning a face-down piece into its real identity from `layout`. Throws if illegal. */
  move(uci: string, layout?: Layout): void {
    if (!this.moves(uci.slice(0, 2)).includes(uci)) throw new Error(`illegal move ${uci}`);
    const from = index(uci.slice(0, 2));
    const to = index(uci.slice(2, 4));
    const c = this.board[from]!;
    this.board = apply(this.board, from, to, c.hidden ? layout?.[name(from)] : undefined);
    this.side = other(this.side);
  }

  inCheck(): boolean {
    return exposed(this.board, this.side);
  }
}

/** Moves ignoring own-king safety. A face-down piece moves as the role of its start square. */
function pseudoMoves(board: Board, from: number): number[] {
  const me = board[from]!;
  const kind = me.hidden ? startRole(me.color, from)! : me.kind;
  const f = from % 9;
  const r = Math.floor(from / 9);
  const out: number[] = [];
  const at = (ff: number, rr: number) => board[rr * 9 + ff];
  const add = (ff: number, rr: number) => {
    if (!onBoard(ff, rr)) return;
    const t = at(ff, rr);
    if (!t || t.color !== me.color) out.push(rr * 9 + ff);
  };
  const inPalace = (ff: number, rr: number) => ff >= 3 && ff <= 5 && (me.color === "w" ? rr <= 2 : rr >= 7);
  const ownHalf = (rr: number) => (me.color === "w" ? rr <= 4 : rr >= 5);

  switch (kind) {
    case "k":
      for (const [df, dr] of ORTHO) if (inPalace(f + df, r + dr)) add(f + df, r + dr);
      break;
    case "a":
      // Only a face-down advisor is still bound to the palace.
      for (const [df, dr] of DIAG) if (!me.hidden || inPalace(f + df, r + dr)) add(f + df, r + dr);
      break;
    case "b":
      for (const [df, dr] of DIAG) {
        const ff = f + 2 * df;
        const rr = r + 2 * dr;
        if (onBoard(ff, rr) && !at(f + df, r + dr) && (!me.hidden || ownHalf(rr))) add(ff, rr);
      }
      break;
    case "n":
      for (const [df, dr] of ORTHO) {
        if (!onBoard(f + df, r + dr) || at(f + df, r + dr)) continue;
        if (df) {
          add(f + 2 * df, r + 1);
          add(f + 2 * df, r - 1);
        } else {
          add(f + 1, r + 2 * dr);
          add(f - 1, r + 2 * dr);
        }
      }
      break;
    case "r":
    case "c":
      for (const [df, dr] of ORTHO) {
        let screened = false;
        for (let ff = f + df, rr = r + dr; onBoard(ff, rr); ff += df, rr += dr) {
          const t = at(ff, rr);
          if (!screened) {
            if (!t) out.push(rr * 9 + ff);
            else if (kind === "r") {
              add(ff, rr);
              break;
            } else screened = true;
          } else if (t) {
            add(ff, rr);
            break;
          }
        }
      }
      break;
    case "p": {
      const fwd = me.color === "w" ? 1 : -1;
      add(f, r + fwd);
      if (!ownHalf(r)) {
        add(f + 1, r);
        add(f - 1, r);
      }
      break;
    }
  }
  return out;
}

/** True if `color`'s king is attacked or faces the other king on an open file. */
function exposed(board: Board, color: Color): boolean {
  const king = board.findIndex((c) => c?.kind === "k" && !c.hidden && c.color === color);
  if (king < 0) return true;
  for (let i = 0; i < 90; i++) {
    const c = board[i];
    if (!c || c.color === color) continue;
    if (c.kind === "k" && !c.hidden && i % 9 === king % 9) {
      const lo = Math.min(i, king);
      const hi = Math.max(i, king);
      let blocked = false;
      for (let j = lo + 9; j < hi; j += 9) if (board[j]) blocked = true;
      if (!blocked) return true;
    }
    if (pseudoMoves(board, i).includes(king)) return true;
  }
  return false;
}

/**
 * Board after moving `from` to `to`. A face-down piece is turned up as `reveal`; without it
 * (move hints on the masked board) it only matters as a blocker, so its kind is left as is.
 */
function apply(board: Board, from: number, to: number, reveal?: Kind): Board {
  const next = board.slice();
  const c = board[from]!;
  next[to] = c.hidden ? { color: c.color, kind: reveal ?? startRole(c.color, from)!, hidden: false } : c;
  next[from] = null;
  return next;
}

/** The piece that normally starts on square `i` for `color`, if any. */
function startRole(color: Color, i: number): Kind | undefined {
  const f = i % 9;
  const r = color === "w" ? Math.floor(i / 9) : 9 - Math.floor(i / 9);
  if (r === 0) return BACK_RANK[f];
  if (r === 2 && (f === 1 || f === 7)) return "c";
  if (r === 3 && f % 2 === 0) return "p";
  return undefined;
}

function onBoard(f: number, r: number): boolean {
  return f >= 0 && f < 9 && r >= 0 && r < 10;
}

function name(i: number): string {
  return FILES[i % 9] + Math.floor(i / 9);
}

function index(square: string): number {
  return Number(square.slice(1)) * 9 + FILES.indexOf(square[0]);
}

function other(c: Color): Color {
  return c === "w" ? "b" : "w";
}
