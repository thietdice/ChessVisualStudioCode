import { Color, GEOMETRY, Grid, PieceType, Variant, isGo, isXiangqiBoard, rankOf, squareIndex, starPoints } from "./board";

// Vietnamese piece names; prefix t = Trắng/Red, d = Đen/Black.
const NAME: Record<Variant, Partial<Record<PieceType, string>>> = {
  chess: { p: "Tot", n: "Ma", b: "Tuong", r: "Xe", q: "Hau", k: "Vua" },
  xiangqi: { k: "Tuong", a: "Si", b: "Voi", r: "Xe", c: "Phao", n: "Ma", p: "Tot" },
  jieqi: { k: "Tuong", a: "Si", b: "Voi", r: "Xe", c: "Phao", n: "Ma", p: "Tot", x: "Up" },
  go9: {},
  go13: {},
  go19: {},
};
const SIDE: Record<Color, string> = { w: "t", b: "d" };
const EMPTY = "__";

const INDENT = "        ";
const ROW_INDENT = "            ";
// Visible board: "tTuong, " per cell, with a blank line between ranks so cells look less flat.
const CELL_WIDTH = 7;
const CELL_STRIDE = 9;
const ROW_STEP = 2;
// Hidden board keeps the compact hex look: "0x1C, ".
const HIDDEN_WIDTH = 4;
const HIDDEN_STRIDE = 6;
// Go: one string per row, drawn with box-drawing chars so the lines join up like a real board
// ("╋" star point, 1 Black, 0 White), with a "│" comment line between rows. Clicks on the "─"
// either side of a point (GO_LEAD chars before it) still pick that point.
const GO_WIDTH = 1;
const GO_STRIDE = 4;
const GO_LEAD = 1;
const GO_CELL: Record<Color, string> = { w: "1", b: "0" };

export interface RenderInput {
  variant: Variant;
  grid: Grid;
  orientation: Color;
  sessionKey: string;
  status: string;
  /** Check / game-result line, empty when there is nothing to report. */
  note: string;
  hidden: boolean;
}

export interface Layout {
  text: string;
  pendingLine: number;
  /** Line/char of a square's cell, honouring orientation. */
  squarePos(square: string): { line: number; ch: number; width: number };
  /** Square under a document position, if it lies on the grid. */
  squareAt(line: number, ch: number): string | undefined;
}

export function render(input: RenderInput): Layout {
  const geo = GEOMETRY[input.variant];
  const rng = seeded(input.sessionKey);
  const filler = shuffle(FILLER, rng);
  const lines: string[] = [];
  const push = (block: string) => lines.push(...block.split("\n"));

  push(HEADER.replace("{KEY}", input.sessionKey));
  push(filler[0]);
  lines.push("");
  push(filler[1]);
  lines.push("");

  const go = isGo(input.variant) && !input.hidden;
  const width = input.hidden ? HIDDEN_WIDTH : go ? GO_WIDTH : CELL_WIDTH;
  const stride = input.hidden ? HIDDEN_STRIDE : go ? GO_STRIDE : CELL_STRIDE;
  const rowStep = input.hidden ? 1 : ROW_STEP;
  const lead = go ? GO_LEAD : 0;
  // Pad rank labels so "/* 9 */" and "/* 19 */" rows line up.
  const labelWidth = String(geo.firstRank + geo.ranks - 1).length;
  const rowPrefix = (label: string) => `${ROW_INDENT}/* ${label.padStart(labelWidth)} */ ${go ? '"' : "new[] { "}`;
  const cellStart = rowPrefix("0").length;
  const fileIdx = [...Array(geo.files.length).keys()];
  const rowIdx = [...Array(geo.ranks).keys()];
  const files = input.orientation === "w" ? fileIdx : fileIdx.reverse();
  const rows = input.orientation === "w" ? rowIdx : rowIdx.reverse();
  const last = files.length - 1;

  const letterAt = input.hidden ? 3 : go ? 0 : 2;
  const stars = go ? starPoints(geo.ranks) : [];
  let header = `${INDENT}//`.padEnd(cellStart, " ");
  for (const f of files) header += (" ".repeat(letterAt) + (input.hidden ? " " : geo.files[f])).padEnd(stride, " ");
  lines.push(header.trimEnd());
  lines.push(`${INDENT}private static readonly ${input.hidden ? "int[]" : go ? "string" : "Cell[]"}[] _grid =`);
  lines.push(`${INDENT}{`);

  const gridTop = lines.length;
  // Xiangqi / jieqi river sits between the two halves, drawn on the spacer line.
  const riverAfter = isXiangqiBoard(input.variant) && !input.hidden ? geo.ranks / 2 - 1 : -1;
  const river = `${ROW_INDENT}// ${"~".repeat(cellStart - ROW_INDENT.length - 3 + stride * last + width - 1)}`;
  const goSpacer = `${ROW_INDENT}//`.padEnd(cellStart, " ") + files.map(() => "│").join(" ".repeat(GO_STRIDE - 1));
  rows.forEach((r, i) => {
    if (i > 0 && rowStep > 1) lines.push(go ? goSpacer : i - 1 === riverAfter ? river : "");
    const cells = files.map((f) => {
      if (input.hidden) return hex(Math.floor(rng() * 0x40));
      const p = input.grid[r]?.[f];
      if (go) return p ? GO_CELL[p.color] : goPoint(i, files.indexOf(f), rows.length - 1, last, stars.includes(f) && stars.includes(r));
      return p ? SIDE[p.color] + (NAME[input.variant][p.type] ?? p.type) : EMPTY;
    });
    const label = input.hidden ? String(i) : String(rankOf(geo, r));
    if (go) {
      lines.push(`${rowPrefix(label)}${cells.join("─".repeat(GO_STRIDE - 1))}",`);
      return;
    }
    const body = cells.map((c, j) => (j < last ? (c + ",").padEnd(stride, " ") : c.padEnd(width, " "))).join("");
    lines.push(`${rowPrefix(label)}${body} },`);
  });
  lines.push(`${INDENT}};`);
  lines.push("");
  if (input.hidden) {
    lines.push(`${INDENT}// high nibble: 0x0_ = White, 0x1_ = Black`);
    lines.push(
      `${INDENT}private enum CellKind { Pawn = 0x9, Knight = 0xA, Bishop = 0xB, Rook = 0xC, Queen = 0xE, King = 0xF }`,
    );
  } else if (go) {
    lines.push(`${INDENT}private const char Empty = '┼', Marker = '╋', Black = '1', White = '0';`);
  } else {
    // Piece legend, disguised as an enum.
    const names = Object.values(NAME[input.variant]);
    lines.push(
      `${INDENT}private enum Cell { ${[EMPTY, ...names.map((n) => SIDE.w + n), ...names.map((n) => SIDE.b + n)].join(", ")} }`,
    );
  }
  lines.push("");
  lines.push(`${INDENT}private const string BatchStatus = "${input.status}";`);
  lines.push(`${INDENT}private const string BatchNote = "${input.hidden ? "" : input.note}";`);
  const pendingLine = lines.length;
  lines.push(`${INDENT}private const string PendingBatch = "";`);
  lines.push("");
  push(filler[2]);
  lines.push("");
  push(filler[3]);
  lines.push("");
  push(filler[4]);
  push(FOOTER);

  return {
    text: lines.join("\n"),
    pendingLine,
    squarePos(square) {
      const { file, row } = squareIndex(geo, square);
      return {
        line: gridTop + rows.indexOf(row) * rowStep,
        ch: cellStart + files.indexOf(file) * stride,
        width,
      };
    },
    squareAt(line, ch) {
      if ((line - gridTop) % rowStep !== 0) return undefined;
      const i = (line - gridTop) / rowStep;
      const j = Math.floor((ch - cellStart + lead) / stride);
      if (i < 0 || i >= rows.length || ch < cellStart - lead || j < 0 || j > last) return undefined;
      return geo.files[files[j]] + rankOf(geo, rows[i]);
    },
  };
}

export function parsePending(text: string): string | undefined {
  return text.match(/PendingBatch\s*=\s*"([^"]*)"/)?.[1].trim().toLowerCase();
}

/** Empty go point at displayed row i / column j: a corner or edge piece, else a cross. */
function goPoint(i: number, j: number, lastRow: number, lastCol: number, star: boolean): string {
  const v = i === 0 ? 0 : i === lastRow ? 2 : 1;
  const h = j === 0 ? 0 : j === lastCol ? 2 : 1;
  if (v === 1 && h === 1 && star) return "╋";
  return ["┌┬┐", "├┼┤", "└┴┘"][v][h];
}

function hex(n: number): string {
  return "0x" + n.toString(16).toUpperCase().padStart(2, "0");
}

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const HEADER = `using System;
using System.Collections.Generic;
using System.Linq;
using Kv.Core.Caching;
using Kv.Core.Persistence;

namespace Kv.Core.Services.Inventory
{
    /// <summary>
    /// Pre-computed cost lookup used by multi-branch stock resolution.
    /// TODO: move to distributed cache once KR2-18842 is merged.
    /// </summary>
    internal static class StockMatrix
    {
        private const string SessionKey = "{KEY}";
        private static readonly ICacheClient _cache = CacheFactory.Default;
`;

const FOOTER = `    }
}`;

const FILLER = [
  `        public static decimal ResolveUnitCost(long productId, int branchId)
        {
            var key = $"cost:{branchId}:{productId}";
            var cached = _cache.Get<decimal?>(key);
            if (cached.HasValue) return cached.Value;

            var cost = CostRepository.GetLatest(productId, branchId)?.Cost ?? 0m;
            _cache.Set(key, cost, TimeSpan.FromMinutes(15));
            return cost;
        }`,
  `        internal static bool ValidateStock(IEnumerable<StockItem> items, int retailerId)
        {
            if (items == null) throw new ArgumentNullException(nameof(items));
            return items.All(i => i.RetailerId == retailerId && i.OnHand >= 0 && i.Reserved <= i.OnHand);
        }`,
  `        private static int ResolveBucket(long productId)
        {
            // keep in sync with StockIndexBuilder.BucketCount
            return (int)(productId % _grid.Length);
        }`,
  `        public static IReadOnlyList<StockItem> MergeBatches(IEnumerable<StockItem> left, IEnumerable<StockItem> right)
        {
            return left.Concat(right)
                .GroupBy(x => new { x.ProductId, x.BranchId })
                .Select(g => new StockItem
                {
                    ProductId = g.Key.ProductId,
                    BranchId = g.Key.BranchId,
                    OnHand = g.Sum(x => x.OnHand),
                    Reserved = g.Sum(x => x.Reserved),
                })
                .ToList();
        }`,
  `        internal static void Invalidate(int retailerId, int branchId)
        {
            var pattern = $"cost:{branchId}:*";
            foreach (var key in _cache.SearchKeys(pattern))
            {
                _cache.Remove(key);
            }
            AuditLog.Write(retailerId, "StockMatrix.Invalidate", branchId);
        }`,
  `        private static decimal WeightedAverage(IList<StockMovement> movements)
        {
            var qty = movements.Sum(m => m.Quantity);
            if (qty == 0) return 0m;
            return Math.Round(movements.Sum(m => m.Quantity * m.UnitCost) / qty, 4, MidpointRounding.AwayFromZero);
        }`,
  `        // NOTE: called from the import worker, avoid heavy allocations here
        internal static long[] SnapshotIds(IEnumerable<StockItem> items) =>
            items.Where(i => !i.IsDeleted).Select(i => i.ProductId).Distinct().ToArray();`,
];
