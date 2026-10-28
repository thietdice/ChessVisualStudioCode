import { START_FEN as JIEQI_START } from "./jieqi";

export type Color = "w" | "b";
export type Variant = "chess" | "xiangqi" | "jieqi" | "go9" | "go13" | "go19";
/**
 * Chess uses p n b r q k; xiangqi uses p n b(elephant) a(advisor) r c(cannon) k; jieqi adds x (face down);
 * go only has s (stone), where seat w plays Black.
 */
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k" | "a" | "c" | "x" | "s";

export interface Piece {
  color: Color;
  type: PieceType;
}

/** grid[0] is the top rank (8 in chess, 9 in xiangqi), grid[r][0] is file a. */
export type Grid = (Piece | null)[][];

export interface Geometry {
  files: string;
  ranks: number;
  /** Number of the bottom rank: 1 in chess, 0 in xiangqi. */
  firstRank: number;
}

export const GEOMETRY: Record<Variant, Geometry> = {
  chess: { files: "abcdefgh", ranks: 8, firstRank: 1 },
  xiangqi: { files: "abcdefghi", ranks: 10, firstRank: 0 },
  jieqi: { files: "abcdefghi", ranks: 10, firstRank: 0 },
  // Go boards skip the letter i.
  go9: { files: "abcdefghj", ranks: 9, firstRank: 1 },
  go13: { files: "abcdefghjklmn", ranks: 13, firstRank: 1 },
  go19: { files: "abcdefghjklmnopqrst", ranks: 19, firstRank: 1 },
};

export const START_FEN: Record<Variant, string> = {
  chess: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  xiangqi: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
  jieqi: JIEQI_START,
  go9: emptyGo(9),
  go13: emptyGo(13),
  go19: emptyGo(19),
};

export function isGo(variant: Variant): boolean {
  return variant.startsWith("go");
}

/** Xiangqi and jieqi share the board: river, palaces, Red/Black. */
export function isXiangqiBoard(variant: Variant): boolean {
  return variant === "xiangqi" || variant === "jieqi";
}

function emptyGo(size: number): string {
  return `${Array(size).fill(size).join("/")} w`;
}

export function parseFen(fen: string): Grid {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const cells: (Piece | null)[] = [];
    // Digit runs are empty squares; go rows can hold two-digit runs like "19".
    for (const [, run, ch] of row.matchAll(/(\d+)|(\D)/g)) {
      if (run) {
        for (let i = 0; i < Number(run); i++) cells.push(null);
      } else {
        cells.push({ color: ch === ch.toUpperCase() ? "w" : "b", type: ch.toLowerCase() as PieceType });
      }
    }
    return cells;
  });
}

export function rankOf(g: Geometry, row: number): number {
  return g.firstRank + g.ranks - 1 - row;
}

export function squareName(g: Geometry, file: number, row: number): string {
  return g.files[file] + rankOf(g, row);
}

export function squareIndex(g: Geometry, square: string): { file: number; row: number } {
  return { file: g.files.indexOf(square[0]), row: g.firstRank + g.ranks - 1 - Number(square.slice(1)) };
}

export function pieceAt(g: Geometry, grid: Grid, square: string): Piece | null {
  const { file, row } = squareIndex(g, square);
  return grid[row]?.[file] ?? null;
}

export function findKing(g: Geometry, grid: Grid, color: Color): string | undefined {
  for (let r = 0; r < grid.length; r++) {
    for (let f = 0; f < grid[r].length; f++) {
      const p = grid[r][f];
      if (p?.type === "k" && p.color === color) return squareName(g, f, r);
    }
  }
  return undefined;
}
