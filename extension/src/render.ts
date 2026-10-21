import { Color, FILES, Grid, PieceType, squareIndex } from "./board";

// Vietnamese piece names; prefix t = Trắng (White), d = Đen (Black).
const NAME: Record<PieceType, string> = { p: "Tot", n: "Ma", b: "Tuong", r: "Xe", q: "Hau", k: "Vua" };
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

export interface RenderInput {
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
  const rng = seeded(input.sessionKey);
  const filler = shuffle(FILLER, rng);
  const lines: string[] = [];
  const push = (block: string) => lines.push(...block.split("\n"));

  push(HEADER.replace("{KEY}", input.sessionKey));
  push(filler[0]);
  lines.push("");
  push(filler[1]);
  lines.push("");

  const width = input.hidden ? HIDDEN_WIDTH : CELL_WIDTH;
  const stride = input.hidden ? HIDDEN_STRIDE : CELL_STRIDE;
  const rowStep = input.hidden ? 1 : ROW_STEP;
  const rowPrefix = (label: string) => `${ROW_INDENT}/* ${label} */ new[] { `;
  const cellStart = rowPrefix("0").length;
  const files = input.orientation === "w" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const rows = input.orientation === "w" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();

  const letterAt = input.hidden ? 3 : 2;
  let header = `${INDENT}//`.padEnd(cellStart, " ");
  for (const f of files) header += (" ".repeat(letterAt) + (input.hidden ? " " : FILES[f])).padEnd(stride, " ");
  lines.push(header.trimEnd());
  lines.push(`${INDENT}private static readonly ${input.hidden ? "int" : "Cell"}[][] _grid =`);
  lines.push(`${INDENT}{`);

  const gridTop = lines.length;
  rows.forEach((r, i) => {
    if (i > 0 && rowStep > 1) lines.push("");
    const cells = files.map((f) => {
      if (input.hidden) return hex(Math.floor(rng() * 0x40));
      const p = input.grid[r][f];
      return p ? SIDE[p.color] + NAME[p.type] : EMPTY;
    });
    const body = cells.map((c, j) => (j < 7 ? (c + ",").padEnd(stride, " ") : c.padEnd(width, " "))).join("");
    const label = input.hidden ? String(i) : String(8 - r);
    lines.push(`${rowPrefix(label)}${body} },`);
  });
  lines.push(`${INDENT}};`);
  lines.push("");
  if (input.hidden) {
    lines.push(`${INDENT}// high nibble: 0x0_ = White, 0x1_ = Black`);
    lines.push(
      `${INDENT}private enum CellKind { Pawn = 0x9, Knight = 0xA, Bishop = 0xB, Rook = 0xC, Queen = 0xE, King = 0xF }`,
    );
  } else {
    // Piece legend, disguised as an enum.
    const names = Object.values(NAME);
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
      const { file, row } = squareIndex(square);
      return {
        line: gridTop + rows.indexOf(row) * rowStep,
        ch: cellStart + files.indexOf(file) * stride,
        width,
      };
    },
    squareAt(line, ch) {
      if ((line - gridTop) % rowStep !== 0) return undefined;
      const i = (line - gridTop) / rowStep;
      const j = Math.floor((ch - cellStart) / stride);
      if (i < 0 || i > 7 || ch < cellStart || j < 0 || j > 7) return undefined;
      return FILES[files[j]] + (8 - rows[i]);
    },
  };
}

export function parsePending(text: string): string | undefined {
  return text.match(/PendingBatch\s*=\s*"([^"]*)"/)?.[1].trim().toLowerCase();
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
