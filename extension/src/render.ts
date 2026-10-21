import { Color, FILES, Grid, PieceType, squareIndex } from "./board";

// Piece codes: high nibble 0 = white, 1 = black; low nibble 9..F = p n b r _ q k.
const CODE: Record<PieceType, number> = { p: 0x9, n: 0xa, b: 0xb, r: 0xc, q: 0xe, k: 0xf };

const INDENT = "        ";
const ROW_INDENT = "            ";
const CELL_WIDTH = 4;
const CELL_STRIDE = 6; // "0x1C, "

export interface RenderInput {
  grid: Grid;
  orientation: Color;
  sessionKey: string;
  status: string;
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

  const rowPrefix = (label: string) => `${ROW_INDENT}/* ${label} */ new[] { `;
  const cellStart = rowPrefix("0").length;
  const files = input.orientation === "w" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const rows = input.orientation === "w" ? [...Array(8).keys()] : [...Array(8).keys()].reverse();

  let header = `${INDENT}//`.padEnd(cellStart, " ");
  for (const f of files) header += (" ".repeat(3) + (input.hidden ? " " : FILES[f])).padEnd(CELL_STRIDE, " ");
  lines.push(header.trimEnd());
  lines.push(`${INDENT}private static readonly int[][] _grid =`);
  lines.push(`${INDENT}{`);

  const gridTop = lines.length;
  rows.forEach((r, i) => {
    const cells = files.map((f) => {
      if (input.hidden) return hex(Math.floor(rng() * 0x40));
      const p = input.grid[r][f];
      return p ? hex((p.color === "b" ? 0x10 : 0) | CODE[p.type]) : "  __";
    });
    const label = input.hidden ? String(i) : String(8 - r);
    lines.push(`${rowPrefix(label)}${cells.join(", ")} },`);
  });
  lines.push(`${INDENT}};`);
  lines.push("");
  // Piece legend (P N B R Q K), disguised as an enum; high nibble 0 = white, 1 = black.
  lines.push(`${INDENT}// high nibble: 0x0_ = W, 0x1_ = B`);
  lines.push(`${INDENT}private enum CellKind { P = 0x9, N = 0xA, B = 0xB, R = 0xC, Q = 0xE, K = 0xF }`);
  lines.push("");
  lines.push(`${INDENT}private const string BatchStatus = "${input.status}";`);
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
        line: gridTop + rows.indexOf(row),
        ch: cellStart + files.indexOf(file) * CELL_STRIDE,
        width: CELL_WIDTH,
      };
    },
    squareAt(line, ch) {
      const i = line - gridTop;
      const j = Math.floor((ch - cellStart) / CELL_STRIDE);
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
        private const int __ = 0x00;
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
