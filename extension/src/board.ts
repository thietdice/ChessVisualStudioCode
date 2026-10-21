export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  color: Color;
  type: PieceType;
}

/** grid[0] is rank 8, grid[r][0] is file a. */
export type Grid = (Piece | null)[][];

export const FILES = "abcdefgh";

export function parseFen(fen: string): Grid {
  const rows = fen.split(" ")[0].split("/");
  return rows.map((row) => {
    const cells: (Piece | null)[] = [];
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) cells.push(null);
      } else {
        cells.push({ color: ch === ch.toUpperCase() ? "w" : "b", type: ch.toLowerCase() as PieceType });
      }
    }
    return cells;
  });
}

export function squareName(file: number, row: number): string {
  return FILES[file] + (8 - row);
}

export function squareIndex(square: string): { file: number; row: number } {
  return { file: FILES.indexOf(square[0]), row: 8 - Number(square[1]) };
}

export function pieceAt(grid: Grid, square: string): Piece | null {
  const { file, row } = squareIndex(square);
  return grid[row]?.[file] ?? null;
}

export function findKing(grid: Grid, color: Color): string | undefined {
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = grid[r][f];
      if (p?.type === "k" && p.color === color) return squareName(f, r);
    }
  }
  return undefined;
}
