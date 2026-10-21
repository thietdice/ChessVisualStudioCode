# ChessVisualStudioCode

Chơi cờ vua 2 người ngay trong VS Code. Bàn cờ được ngụy trang thành một file C# (`StockMatrix.cs`), nhìn giống bạn đang code.

- `extension/` — VS Code extension (tên hiển thị: **Kv Batch Sync**)
- `server/` — relay server chạy trên Cloudflare Workers + Durable Objects

---

## Cài đặt

### 1. Deploy server (chỉ cần làm 1 lần)

**Cách A — deploy từ máy**
```powershell
cd server
npm ci
npx wrangler login
npm run deploy
```

**Cách B — GitHub Actions (tự deploy khi push thay đổi trong `server/`)**
1. Cloudflare → **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers**.
2. Lấy **Account ID**: đoạn 32 ký tự trên URL `dash.cloudflare.com/<account-id>/...`, hoặc chạy `npx wrangler whoami`.
3. GitHub repo → **Settings → Secrets and variables → Actions**, thêm `CLOUDFLARE_API_TOKEN` và `CLOUDFLARE_ACCOUNT_ID`.
4. **Actions → Deploy relay → Run workflow**.

> Lần đầu dùng Workers, account phải có subdomain `workers.dev`: vào **Workers & Pages** trên dashboard để đăng ký. Nếu chưa có, deploy sẽ lỗi `register a workers.dev subdomain`.

Kiểm tra: mở `https://chess-relay.<subdomain>.workers.dev/health`, thấy `ok` là được.

Server hiện tại: `https://chess-relay.thietdice.workers.dev`

### 2. Build & cài extension
```powershell
cd extension
npm ci
npm run compile
npm run package        # tạo kv-batch-sync-0.1.0.vsix
code --install-extension kv-batch-sync-0.1.0.vsix
```
Hoặc trong VS Code: Extensions (`Ctrl+Shift+X`) → `...` → **Install from VSIX...**

Người chơi cùng chỉ cần file `.vsix`, không cần build.

### 3. Cấu hình
`Ctrl+,` → tìm `kvsync`:

| Setting | Giá trị |
|---|---|
| `kvsync.endpoint` | `https://chess-relay.thietdice.workers.dev` |
| `kvsync.author` | Tên hiển thị của đối thủ trong dòng "blame" (tuỳ chọn) |

---

## Cách chơi

### Vào trận
- **Tạo phòng:** `Ctrl+Shift+P` → **Kv: Open Batch Session**. Mã phòng 6 ký tự được tự copy vào clipboard, gửi cho bạn chơi.
- **Vào phòng:** `Ctrl+Shift+P` → **Kv: Attach Batch Session** → dán mã.

Phe trắng/đen được chia ngẫu nhiên. Bàn cờ luôn xoay cho quân của mình ở dưới.

> Phải có **đủ 2 người** trong phòng thì ván mới bắt đầu. Khi chỉ có 1 người, chọn quân được nhưng không đi được (báo lỗi `CS0162`).

### Đọc bàn cờ
Bàn cờ là mảng `_grid`. Cột `a`–`h` ghi ở dòng comment phía trên, hàng ghi trong `/* 8 */`.

| Quân | Trắng | Đen |
|---|---|---|
| Tốt | `0x09` | `0x19` |
| Mã | `0x0A` | `0x1A` |
| Tượng | `0x0B` | `0x1B` |
| Xe | `0x0C` | `0x1C` |
| Hậu | `0x0E` | `0x1E` |
| Vua | `0x0F` | `0x1F` |
| Ô trống | `__` | |

Mẹo nhớ: số đầu `0` = trắng, `1` = đen; chữ cuối **9 A B C E F** = Tốt, Mã, Tượng, Xe, Hậu, Vua.

Ngay dưới grid có sẵn chú thích, ngụy trang thành enum:
```csharp
        // high nibble: 0x0_ = White, 0x1_ = Black
        private enum CellKind { Pawn = 0x9, Knight = 0xA, Bishop = 0xB, Rook = 0xC, Queen = 0xE, King = 0xF }
```

### Đi quân
**Cách 1 — phím tắt**
1. Đặt con trỏ vào ô quân của mình → `Ctrl+Alt+M` (ô được viền).
2. Đặt con trỏ vào ô đích → `Ctrl+Alt+M`.

Nhấn lại ô đang chọn để bỏ chọn; nhấn quân khác của mình để đổi quân. Con trỏ phải nằm trên chính ô (`0x0C`, `__`), không phải dấu phẩy hay khoảng trắng.

**Cách 2 — gõ nước đi** rồi `Ctrl+S`:
```csharp
private const string PendingBatch = "e2e4";
```
- Phong cấp: `e7e8n` (`q`/`r`/`b`/`n`). Không ghi thì tự phong Hậu.
- Nhập thành: đi nước của vua, ví dụ `e1g1`.

### Trạng thái
| `BatchStatus` | Status bar | Nghĩa |
|---|---|---|
| `Idle` | `Kv.Core: restoring` | Chờ đối thủ vào phòng |
| `Pending` | `Kv.Core: 1 pending` | **Tới lượt bạn** |
| `Queued` | `Kv.Core` | Tới lượt đối thủ |
| `Committed` | `build succeeded` | Thắng |
| `RolledBack` | `build failed` | Thua |
| `Merged` | `built with warnings` | Hoà |

- **Nước vừa đi:** 2 ô được tô nền, cuối dòng có ghi chú kiểu git blame.
- **Bị chiếu:** gạch vàng `CS0618` dưới quân vua.
- **Lỗi** (gạch đỏ ở dòng `PendingBatch`):
  - `CS1503` — nước đi không hợp lệ
  - `CS4014` — chưa tới lượt
  - `CS0162` — ván chưa bắt đầu hoặc đã kết thúc
- Icon ngắt kết nối cạnh `Kv.Core` = đối thủ đang offline.

### Phím tắt & menu
| Thao tác | Cách làm |
|---|---|
| Chọn / đi quân | `Ctrl+Alt+M` |
| Ẩn / hiện bàn cờ khẩn cấp | `Ctrl+Alt+H` |
| Mở menu | Bấm **Kv.Core** ở status bar, hoặc **Kv: Batch Menu** |
| Cầu hoà | Menu → **Propose merge** (đối thủ nhận popup Accept/Decline) |
| Xin thua | Menu → **Abort batch** |
| Copy lại mã phòng | Menu → **Copy session key** |
| Thoát phòng | Menu → **Close session** |

**Mất kết nối / lỡ đóng VS Code:** chạy **Kv: Attach Batch Session**, mã phòng cũ đã điền sẵn, Enter là vào lại đúng phe.

---

## Xử lý sự cố

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Chọn được quân nhưng không đi được, lỗi `CS0162` | Chưa đủ 2 người trong phòng |
| Status bar chỉ có icon xoay mãi | Không kết nối được server: kiểm tra `kvsync.endpoint`, hoặc mạng công ty chặn `workers.dev` |
| `Ctrl+Alt+M` không phản hồi | Thử `Ctrl+Shift+P` → **Kv: Mark Batch Cell**. Nếu chạy được thì phím đang bị chiếm (Unikey/EVKey…): tắt bộ gõ hoặc đổi phím tại `Ctrl+K Ctrl+S` → `kvsync.mark` |
| `kvsync.endpoint is not configured` | Chưa đặt setting `kvsync.endpoint` |
| `Session ... not found` | Sai mã phòng |
| `Session ... is locked by another process` | Phòng đã đủ 2 người |

### Tự test một mình trên 1 máy
Hai cửa sổ VS Code thường dùng chung bộ nhớ extension nên cửa sổ thứ 2 sẽ chiếm phe của cửa sổ 1. Mở một instance với profile riêng:
```powershell
code --user-data-dir "$env:TEMP\vscode-p2" --extensions-dir "$env:TEMP\vscode-p2-ext"
```
Cài `.vsix`, đặt `kvsync.endpoint`, rồi **Kv: Attach Batch Session** bằng mã phòng của cửa sổ 1.

---

## Phát triển
```powershell
# Server chạy local tại http://127.0.0.1:8787 (giá trị mặc định của kvsync.endpoint)
cd server && npm run dev

# Extension: mở thư mục extension/ trong VS Code, nhấn F5
cd extension && npm run watch
```
