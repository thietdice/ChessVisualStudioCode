# Hướng dẫn chơi

Chưa cài extension? Xem [README.md](README.md).

## 1. Vào trận
| Ai | Làm gì |
|---|---|
| Người tạo phòng | `Ctrl+Shift+P` → **Kv: Open Batch Session** → chọn **Batch mode: standard** (cờ vua), **Batch mode: extended** (cờ tướng), **Batch mode: lazy** (cờ úp) hoặc **Batch mode: grid** (cờ vây, chọn tiếp bàn 9 / 13 / 19). Mã phòng 6 ký tự được tự copy vào clipboard, gửi cho bạn chơi |
| Người vào phòng | `Ctrl+Shift+P` → **Kv: Attach Batch Session** → dán mã |

- Phe trắng/đen được chia **ngẫu nhiên**. Bàn cờ luôn xoay cho quân của mình ở phía dưới.
- Phải có **đủ 2 người** thì ván mới bắt đầu. Khi mới có 1 người, chọn quân được nhưng không đi được (báo lỗi `CS0162`).

## 2. Đọc bàn cờ
Bàn cờ là mảng `_grid` trong file `StockMatrix.cs`. Cột `a`–`h` ghi ở dòng comment phía trên, số hàng ghi trong `/* 8 */`:
```csharp
        //                       a        b        c        d        e        f        g        h
        private static readonly Cell[][] _grid =
        {
            /* 8 */ new[] { dXe,     dMa,     dTuong,  dHau,    dVua,    dTuong,  dMa,     dXe     },

            /* 7 */ new[] { dTot,    dTot,    dTot,    dTot,    dTot,    dTot,    dTot,    dTot    },

            /* 6 */ new[] { __,      __,      __,      __,      __,      __,      __,      __      },
            ...
            /* 1 */ new[] { tXe,     tMa,     tTuong,  tHau,    tVua,    tTuong,  tMa,     tXe     },
        };
```
- Tiền tố `t` = Trắng, `d` = Đen; `__` = ô trống. Tên quân: `Tot` (Tốt), `Ma` (Mã), `Tuong` (Tượng), `Xe`, `Hau` (Hậu), `Vua`.
- Ô tối được tô nền xen kẽ, quân trắng chữ vàng, quân đen chữ xanh. Đổi màu trong Settings (`Ctrl+,` → `kvsync.colors`):

| Setting | Mặc định |
|---|---|
| `kvsync.colors.enabled` | `true` (bỏ tick để tắt toàn bộ màu) |
| `kvsync.colors.darkSquare` | `rgba(128, 128, 128, 0.18)` |
| `kvsync.colors.whitePiece` | `#e5c07b` |
| `kvsync.colors.blackPiece` | `#61afef` |

Giá trị là màu CSS bất kỳ (`#rrggbb`, `rgba(...)`, `red`…). Để trống = không tô.

### Cờ tướng (Batch mode: extended)
Bàn 9 cột `a`–`i` × 10 hàng `0`–`9`. Dòng `// ~~~~` giữa hàng 4 và 5 là **sông**; ô trong **cung** (cột d–f) được tô nền.
```csharp
            /* 9 */ new[] { dXe,     dMa,     dVoi,    dSi,     dTuong,  dSi,     dVoi,    dMa,     dXe     },
            ...
            /* 5 */ new[] { __,      __,      __,      __,      __,      __,      __,      __,      __      },
            // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
            /* 4 */ new[] { __,      __,      __,      __,      __,      __,      __,      __,      __      },
            ...
            /* 0 */ new[] { tXe,     tMa,     tVoi,    tSi,     tTuong,  tSi,     tVoi,    tMa,     tXe     },
```
| Quân | Đỏ (`t`) | Đen (`d`) |
|---|---|---|
| Tướng | `tTuong` | `dTuong` |
| Sĩ | `tSi` | `dSi` |
| Tượng | `tVoi` | `dVoi` |
| Xe | `tXe` | `dXe` |
| Pháo | `tPhao` | `dPhao` |
| Mã | `tMa` | `dMa` |
| Tốt | `tTot` | `dTot` |

- Đỏ đi trước. `BatchNote` ghi `Red` / `Black`.
- Luật đầy đủ: cản chân Mã, cản mắt Tượng, Tượng không qua sông, Sĩ/Tướng trong cung, Pháo ăn qua ngòi, Tốt qua sông đi ngang, **2 Tướng không được đối mặt**.
- **Hết nước đi là thua** (khác cờ vua): `BatchNote` = `No moves - Red wins`.
- Gõ nước đi kiểu `h2e2` (Pháo 2 bình 5); không có phong cấp.

### Cờ úp (Batch mode: lazy)
Bàn, tọa độ và tên quân giống cờ tướng, thêm quân úp `tUp` / `dUp`.
```csharp
            /* 9 */ new[] { dUp,     dUp,     dUp,     dUp,     dTuong,  dUp,     dUp,     dUp,     dUp     },
            ...
            /* 0 */ new[] { tUp,     tUp,     tUp,     tUp,     tTuong,  tUp,     tUp,     tUp,     tUp     },
```
- Chỉ **Tướng** ngửa. 15 quân còn lại mỗi bên được xáo ngẫu nhiên và úp vào các vị trí xuất phát; cả 2 người đều không biết quân nào là quân nào.
- Quân úp **đi theo quân gốc của ô nó đứng** (úp ở ô Xe thì đi như Xe, ô Pháo đi như Pháo…). Đi xong là lật lên, từ đó đi theo đúng quân thật.
- Sau khi lật, **Sĩ và Tượng đi khắp bàn** (không bị giới hạn trong cung / bên sông mình). Vẫn cản chân Mã, cản mắt Tượng; Tốt không đi lùi, qua sông mới được đi ngang.
- **Ăn quân úp thì không lộ**: quân bị ăn mất luôn, không ai biết đó là quân gì.
- Hết nước đi là thua như cờ tướng. **Hòa chỉ bằng thỏa thuận** (Propose merge), không có hòa do lặp nước.
- Rerun batch sẽ xáo lại quân úp.

### Cờ vây (Batch mode: grid)
Bàn là mảng `byte[][]`: `00` = giao điểm trống, `01` = quân Đen, `02` = quân Trắng. Quân được tô thành **chấm tròn 2 màu** (Đen / Trắng), viên vừa đánh có viền đậm; các điểm sao được tô nền. Cột `a`–`t` **bỏ chữ `i`** như bàn cờ vây thật, hàng `1` ở dưới cùng.
```csharp
        //                        a   b   c   d   e   f   g   h   j
        private static readonly byte[][] _grid =
        {
            /* 9 */ new byte[] { 00, 00, 00, 00, 00, 00, 00, 00, 00 },
            /* 8 */ new byte[] { 00, 00, 00, 00, 00, 00, 00, 00, 00 },
            /* 7 */ new byte[] { 00, 00, 01, 00, 00, 00, 02, 00, 00 },
            ...
```
- Ai đi trước cầm **Đen**. `BatchNote` hiện số quân đã bắt, ví dụ `captures: Black 3, White 1`.
- Đánh quân: con trỏ vào giao điểm trống → `Space` (chỉ 1 lần, không cần chọn quân). Hoặc gõ `PendingBatch = "d4"` rồi `Ctrl+S`.
- **Pass:** Menu → **Skip batch**, hoặc gõ `PendingBatch = "pass"`.
- Luật: cấm tự sát; cấm lặp lại thế cờ đã có (superko, bao gồm cướp ko ngay lập tức).
- **Kết thúc:** 2 bên pass liên tiếp thì server tự **tính đất** = số quân trên bàn + giao điểm trống chỉ giáp quân mình; Trắng được cộng **komi 7.5**. Mọi quân còn trên bàn đều tính là sống, nên **phải bắt hết quân chết trước khi pass**. `BatchNote` = `Black 45 - White 43.5 - Black wins`.
- Đổi màu quân: `kvsync.colors.blackStone` (mặc định `#202020`), `kvsync.colors.whiteStone` (mặc định `#f0f0f0`).

## 3. Đi quân

**Cách 1 — phím tắt**
1. Đặt con trỏ vào ô quân của mình → `Space` (ô được viền).
2. Đặt con trỏ vào ô đích → `Space`.

`Space` chỉ có tác dụng trong file bàn cờ; `Ctrl+Alt+M` vẫn dùng được.

- Khi chọn quân, các ô quân đó **đi được hợp lệ** sẽ được tô nền + viền chấm (giống highlight kết quả tìm kiếm). Gợi ý hiện cả khi đang chờ đối thủ đi, để tính trước nước.
- Nhấn lại ô đang chọn để bỏ chọn; nhấn quân khác của mình để đổi quân.
- Con trỏ đặt ở bất kỳ đâu trong tên quân (`tMa`) hoặc khoảng trống ngay sau nó đều được; dòng trống giữa các hàng không tính.

**Cách 2 — gõ nước đi** vào dòng `PendingBatch` rồi `Ctrl+S`:
```csharp
private const string PendingBatch = "e2e4";
```
- Phong cấp: thêm `q`/`r`/`b`/`n`, ví dụ `e7e8n`. Không ghi thì tự phong Hậu.
- Nhập thành: đi nước của vua, ví dụ `e1g1`.

## 4. Đọc trạng thái
Xem dòng `BatchStatus` trong file hoặc status bar góc dưới bên trái:

| `BatchStatus` | Status bar | Nghĩa |
|---|---|---|
| `Idle` | `Kv.Core: restoring` | Chờ đối thủ vào phòng |
| `Pending` | `Kv.Core: 1 pending` | **Tới lượt bạn** |
| `Queued` | `Kv.Core` | Tới lượt đối thủ |
| `Committed` | `build succeeded` | Thắng |
| `RolledBack` | `build failed` | Thua |
| `Merged` | `built with warnings` | Hoà |

- **Nước vừa đi:** 2 ô được tô nền, cuối dòng có ghi chú kiểu git blame (`dev-team, 2 minutes ago • fix: adjust batch e7e5`).
- **Chiếu tướng / kết quả:** dòng `BatchNote` ngay dưới `BatchStatus`:
  - `"White in check"` / `"Black in check"`: bên đó đang bị chiếu (bên bị chiếu còn thấy gạch vàng `CS0618` dưới vua)
  - `"Checkmate - White wins"`, `"White resigned - Black wins"`
  - `"Draw - stalemate"`, `"Draw - agreement"`, `"Draw - threefold repetition"`, `"Draw - insufficient material"`, `"Draw - fifty moves"`
- **Lỗi** — gạch đỏ ở dòng `PendingBatch`:
  - `CS1503`: nước đi không hợp lệ
  - `CS4014`: chưa tới lượt
  - `CS0162`: ván chưa bắt đầu hoặc đã kết thúc
- Icon ngắt kết nối cạnh `Kv.Core`: đối thủ đang offline.

## 5. Phím tắt & menu
| Thao tác | Cách làm |
|---|---|
| Chọn / đi quân | `Space` (hoặc `Ctrl+Alt+M`) |
| Ẩn / hiện bàn cờ khẩn cấp | `Ctrl+Alt+H` (bàn cờ thành số hex ngẫu nhiên, tắt hết màu và `BatchNote`) |
| Mở menu | Bấm **Kv.Core** ở status bar (chỉ hiện khi đang trong phòng), hoặc `Ctrl+Shift+P` → **Kv: Batch Menu** |
| Cầu hoà | Menu → **Propose merge**. Đối thủ nhận popup *Merge request received* → Accept / Decline |
| Đầu hàng | Menu → **Abort batch** (mục đầu tiên khi đang chơi), hoặc `Ctrl+Shift+P` → **Kv: Abort Batch** |
| Chơi lại (rematch) | Hết ván: Menu → **Rerun batch**. Đối thủ nhận popup *Rerun requested by upstream* → Accept: ván mới bắt đầu ngay trong phòng cũ, **2 bên đổi phe** |
| Copy lại mã phòng | Menu → **Copy session key** |
| Thoát phòng | Menu → **Close session** |

**Mất kết nối / lỡ đóng VS Code:** chạy **Kv: Attach Batch Session**, mã phòng cũ đã điền sẵn, Enter là vào lại đúng phe cũ.

## 6. Xử lý sự cố khi chơi
| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Chọn được quân nhưng không đi được, lỗi `CS0162` | Chưa đủ 2 người trong phòng |
| Status bar chỉ có icon xoay mãi | Không kết nối được server: kiểm tra `kvsync.endpoint`, hoặc mạng chặn `workers.dev` |
| `Space` / `Ctrl+Alt+M` không phản hồi | Thử `Ctrl+Shift+P` → **Kv: Mark Batch Cell**. Nếu chạy được thì phím đang bị chiếm (Unikey/EVKey…): tắt bộ gõ, hoặc đổi phím tại `Ctrl+K Ctrl+S` → `kvsync.mark` |
| `Session ... not found` | Sai mã phòng |
| `Session ... is locked by another process` | Phòng đã đủ 2 người |

## Tự test một mình trên 1 máy
Hai cửa sổ VS Code thường dùng chung bộ nhớ extension, nên cửa sổ thứ 2 sẽ chiếm phe của cửa sổ 1. Mở một instance với profile riêng:
```powershell
code --user-data-dir "$env:TEMP\vscode-p2" --extensions-dir "$env:TEMP\vscode-p2-ext"
```
Trong cửa sổ đó: cài `.vsix`, đặt `kvsync.endpoint`, rồi **Kv: Attach Batch Session** bằng mã phòng của cửa sổ 1.
