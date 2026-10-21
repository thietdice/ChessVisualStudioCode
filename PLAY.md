# Hướng dẫn chơi

Chưa cài extension? Xem [README.md](README.md).

## 1. Vào trận
| Ai | Làm gì |
|---|---|
| Người tạo phòng | `Ctrl+Shift+P` → **Kv: Open Batch Session**. Mã phòng 6 ký tự được tự copy vào clipboard, gửi cho bạn chơi |
| Người vào phòng | `Ctrl+Shift+P` → **Kv: Attach Batch Session** → dán mã |

- Phe trắng/đen được chia **ngẫu nhiên**. Bàn cờ luôn xoay cho quân của mình ở phía dưới.
- Phải có **đủ 2 người** thì ván mới bắt đầu. Khi mới có 1 người, chọn quân được nhưng không đi được (báo lỗi `CS0162`).

## 2. Đọc bàn cờ
Bàn cờ là mảng `_grid` trong file `StockMatrix.cs`. Cột `a`–`h` ghi ở dòng comment phía trên, số hàng ghi trong `/* 8 */`:
```csharp
        //                       a     b     c     d     e     f     g     h
        private static readonly int[][] _grid =
        {
            /* 8 */ new[] { 0x1C, 0x1A, 0x1B, 0x1E, 0x1F, 0x1B, 0x1A, 0x1C },
            /* 7 */ new[] { 0x19, 0x19, 0x19, 0x19, 0x19, 0x19, 0x19, 0x19 },
            /* 6 */ new[] {   __,   __,   __,   __,   __,   __,   __,   __ },
            ...
            /* 1 */ new[] { 0x0C, 0x0A, 0x0B, 0x0E, 0x0F, 0x0B, 0x0A, 0x0C },
        };

        // high nibble: 0x0_ = White, 0x1_ = Black
        private enum CellKind { Pawn = 0x9, Knight = 0xA, Bishop = 0xB, Rook = 0xC, Queen = 0xE, King = 0xF }
```

| Quân | Trắng | Đen |
|---|---|---|
| Tốt (Pawn) | `0x09` | `0x19` |
| Mã (Knight) | `0x0A` | `0x1A` |
| Tượng (Bishop) | `0x0B` | `0x1B` |
| Xe (Rook) | `0x0C` | `0x1C` |
| Hậu (Queen) | `0x0E` | `0x1E` |
| Vua (King) | `0x0F` | `0x1F` |
| Ô trống | `__` | |

Chú thích `CellKind` ngay dưới bàn cờ: số đầu `0` = trắng, `1` = đen; chữ cuối tra trong enum.

## 3. Đi quân

**Cách 1 — phím tắt**
1. Đặt con trỏ vào ô quân của mình → `Ctrl+Alt+M` (ô được viền).
2. Đặt con trỏ vào ô đích → `Ctrl+Alt+M`.

- Khi chọn quân, các ô quân đó **đi được hợp lệ** sẽ được tô nền (giống highlight kết quả tìm kiếm). Chỉ hiện khi đang tới lượt bạn.
- Nhấn lại ô đang chọn để bỏ chọn; nhấn quân khác của mình để đổi quân.
- Con trỏ phải nằm trên chính ô (`0x0C`, `__`), không phải dấu phẩy hay khoảng trắng.

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
- **Bị chiếu:** gạch vàng `CS0618` dưới quân vua.
- **Lỗi** — gạch đỏ ở dòng `PendingBatch`:
  - `CS1503`: nước đi không hợp lệ
  - `CS4014`: chưa tới lượt
  - `CS0162`: ván chưa bắt đầu hoặc đã kết thúc
- Icon ngắt kết nối cạnh `Kv.Core`: đối thủ đang offline.

## 5. Phím tắt & menu
| Thao tác | Cách làm |
|---|---|
| Chọn / đi quân | `Ctrl+Alt+M` |
| Ẩn / hiện bàn cờ khẩn cấp | `Ctrl+Alt+H` (bàn cờ thành số hex ngẫu nhiên) |
| Mở menu | Bấm **Kv.Core** ở status bar (chỉ hiện khi đang trong phòng), hoặc `Ctrl+Shift+P` → **Kv: Batch Menu** |
| Cầu hoà | Menu → **Propose merge**. Đối thủ nhận popup *Merge request received* → Accept / Decline |
| Xin thua | Menu → **Abort batch** |
| Copy lại mã phòng | Menu → **Copy session key** |
| Thoát phòng | Menu → **Close session** |

**Mất kết nối / lỡ đóng VS Code:** chạy **Kv: Attach Batch Session**, mã phòng cũ đã điền sẵn, Enter là vào lại đúng phe cũ.

## 6. Xử lý sự cố khi chơi
| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Chọn được quân nhưng không đi được, lỗi `CS0162` | Chưa đủ 2 người trong phòng |
| Status bar chỉ có icon xoay mãi | Không kết nối được server: kiểm tra `kvsync.endpoint`, hoặc mạng chặn `workers.dev` |
| `Ctrl+Alt+M` không phản hồi | Thử `Ctrl+Shift+P` → **Kv: Mark Batch Cell**. Nếu chạy được thì phím đang bị chiếm (Unikey/EVKey…): tắt bộ gõ, hoặc đổi phím tại `Ctrl+K Ctrl+S` → `kvsync.mark` |
| `Session ... not found` | Sai mã phòng |
| `Session ... is locked by another process` | Phòng đã đủ 2 người |

## Tự test một mình trên 1 máy
Hai cửa sổ VS Code thường dùng chung bộ nhớ extension, nên cửa sổ thứ 2 sẽ chiếm phe của cửa sổ 1. Mở một instance với profile riêng:
```powershell
code --user-data-dir "$env:TEMP\vscode-p2" --extensions-dir "$env:TEMP\vscode-p2-ext"
```
Trong cửa sổ đó: cài `.vsix`, đặt `kvsync.endpoint`, rồi **Kv: Attach Batch Session** bằng mã phòng của cửa sổ 1.
