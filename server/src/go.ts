/**
 * Go with area scoring: when both players pass in a row, every stone on the board counts as alive,
 * plus empty regions bordered by one colour only, plus komi for White. Dead stones must be captured
 * before passing. Suicide is illegal and so is repeating any earlier position (positional superko).
 *
 * Seats keep the chess naming: "w" moves first and plays Black stones, "b" plays White.
 */

export type Color = "w" | "b";

export const KOMI = 7.5;
const FILES = "abcdefghjklmnopqrst"; // no "i", as on real go boards

export class Go {
  private board: (Color | null)[];
  private side: Color = "w";
  private passes = 0;
  private readonly seen = new Set<string>();
  readonly captures: Record<Color, number> = { w: 0, b: 0 };

  constructor(readonly size: number) {
    this.board = new Array(size * size).fill(null);
    this.seen.add(this.key());
  }

  turn(): Color {
    return this.side;
  }

  /** Board rows from the top, "S" = Black (seat w), "s" = White (seat b), digit runs = empty points. */
  fen(): string {
    const rows: string[] = [];
    for (let r = this.size - 1; r >= 0; r--) {
      let row = "";
      let empty = 0;
      for (let f = 0; f < this.size; f++) {
        const c = this.board[r * this.size + f];
        if (!c) {
          empty++;
          continue;
        }
        if (empty) row += empty;
        empty = 0;
        row += c === "w" ? "S" : "s";
      }
      rows.push(row + (empty || ""));
    }
    return `${rows.join("/")} ${this.side}`;
  }

  /** Plays "d4" style points or "pass". Throws if illegal. */
  play(move: string): void {
    if (this.isOver()) throw new Error("game over");
    if (move === "pass") {
      this.passes++;
      this.side = other(this.side);
      return;
    }
    const at = this.index(move);
    if (at < 0 || this.board[at]) throw new Error(`illegal move ${move}`);

    const next = this.board.slice();
    next[at] = this.side;
    let taken = 0;
    for (const n of this.neighbours(at)) {
      if (next[n] !== other(this.side)) continue;
      const group = this.group(next, n);
      if (group.liberties) continue;
      for (const s of group.stones) next[s] = null;
      taken += group.stones.length;
    }
    if (!this.group(next, at).liberties) throw new Error(`suicide ${move}`);
    const key = next.map((c) => c ?? ".").join("");
    if (this.seen.has(key)) throw new Error(`superko ${move}`);

    this.board = next;
    this.seen.add(key);
    this.captures[this.side] += taken;
    this.passes = 0;
    this.side = other(this.side);
  }

  isOver(): boolean {
    return this.passes >= 2;
  }

  /** Area score: stones + territory, komi added to White (seat b). */
  score(): Record<Color, number> {
    const score: Record<Color, number> = { w: 0, b: KOMI };
    const visited = new Set<number>();
    for (let i = 0; i < this.board.length; i++) {
      const c = this.board[i];
      if (c) {
        score[c]++;
        continue;
      }
      if (visited.has(i)) continue;
      // Flood the empty region and see which colours border it.
      const region = [i];
      const borders = new Set<Color>();
      visited.add(i);
      for (let k = 0; k < region.length; k++) {
        for (const n of this.neighbours(region[k])) {
          const nc = this.board[n];
          if (nc) borders.add(nc);
          else if (!visited.has(n)) {
            visited.add(n);
            region.push(n);
          }
        }
      }
      if (borders.size === 1) score[[...borders][0]] += region.length;
    }
    return score;
  }

  inCheck(): boolean {
    return false;
  }

  private group(board: (Color | null)[], start: number): { stones: number[]; liberties: number } {
    const color = board[start];
    const stones = [start];
    const seen = new Set(stones);
    const libs = new Set<number>();
    for (let k = 0; k < stones.length; k++) {
      for (const n of this.neighbours(stones[k])) {
        if (!board[n]) libs.add(n);
        else if (board[n] === color && !seen.has(n)) {
          seen.add(n);
          stones.push(n);
        }
      }
    }
    return { stones, liberties: libs.size };
  }

  private neighbours(i: number): number[] {
    const f = i % this.size;
    const out: number[] = [];
    if (f > 0) out.push(i - 1);
    if (f < this.size - 1) out.push(i + 1);
    if (i >= this.size) out.push(i - this.size);
    if (i < this.size * (this.size - 1)) out.push(i + this.size);
    return out;
  }

  private index(point: string): number {
    const f = FILES.indexOf(point[0]);
    const r = Number(point.slice(1));
    if (f < 0 || f >= this.size || !Number.isInteger(r) || r < 1 || r > this.size || point.slice(1) !== String(r)) return -1;
    return (r - 1) * this.size + f;
  }

  private key(): string {
    return this.board.map((c) => c ?? ".").join("");
  }
}

function other(c: Color): Color {
  return c === "w" ? "b" : "w";
}
