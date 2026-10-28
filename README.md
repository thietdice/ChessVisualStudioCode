# ChessVisualStudioCode

Chơi cờ vua 2 người ngay trong VS Code. Bàn cờ được ngụy trang thành một file C# (`StockMatrix.cs`), nhìn giống bạn đang code.

| Thư mục | Nội dung |
|---|---|
| `server/` | Relay server chạy trên Cloudflare Workers + Durable Objects (gói miễn phí là đủ) |
| `extension/` | VS Code extension, tên hiển thị **Kv Batch Sync** |
| `.github/workflows/deploy-relay.yml` | Tự deploy server khi push thay đổi trong `server/` |
| `.github/workflows/release-extension.yml` | Tự build `.vsix` và tạo GitHub Release khi push `extension/` với `version` mới |

👉 **Cách chơi: xem [PLAY.md](PLAY.md)**

Có 2 trường hợp:
- **Muốn chơi với nhóm của mình** (cách nên làm): một người trong nhóm tự dựng server trên tài khoản Cloudflare của họ, làm đủ cả 2 phần, rồi gửi link tab **Releases** của repo (hoặc file `.vsix`) cho những người còn lại.
- **Được người khác gửi link Releases hoặc file `.vsix`**: tải file `.vsix`, rồi chỉ cần làm [2.2](#22-cài-vào-vs-code) và [2.4](#24-nạp-lại-vs-code). Nếu file chưa gắn sẵn URL, đặt `kvsync.endpoint` theo URL người đó đưa ([2.3](#23-cấu-hình)).

Repo không kèm server dùng chung: mặc định extension trỏ về `http://127.0.0.1:8787`, mỗi nhóm tự deploy server riêng (gói Cloudflare miễn phí là đủ).

---

## Phần 1 — Tự deploy server lên Cloudflare

### 1.1. Chuẩn bị
- Tài khoản GitHub và tài khoản [Cloudflare](https://dash.cloudflare.com/sign-up) (miễn phí).
- [Node.js](https://nodejs.org) 20 trở lên và Git (nếu deploy từ máy).

### 1.2. Lấy code về repo của bạn
- **Fork:** bấm **Fork** trên GitHub. Sau đó vào tab **Actions** của repo fork và bấm **I understand my workflows, go ahead and enable them** (fork mặc định tắt Actions).
- **Hoặc clone rồi đẩy sang repo mới:**
  ```powershell
  git clone https://github.com/thietdice/ChessVisualStudioCode.git
  cd ChessVisualStudioCode
  git remote set-url origin https://github.com/<user-cua-ban>/<ten-repo>.git
  git push -u origin main
  ```

### 1.3. Đăng ký subdomain `workers.dev` (1 lần cho mỗi tài khoản Cloudflare)
Vào [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**, Cloudflare sẽ yêu cầu chọn subdomain, ví dụ `tenban` → `tenban.workers.dev`.
Nếu không thấy màn hình chọn: **Workers & Pages → Overview**, cột bên phải có mục **Subdomain**.

> Bỏ qua bước này, deploy sẽ lỗi:
> `You can either deploy your worker to one or more routes ... or register a workers.dev subdomain`

### 1.4. (Tuỳ chọn) Đổi tên worker
Tên worker nằm trong [`server/wrangler.toml`](server/wrangler.toml):
```toml
name = "chess-relay"
```
URL server sẽ là `https://<name>.<subdomain>.workers.dev`, ví dụ `https://chess-relay.tenban.workers.dev`. Đổi `name` nếu muốn URL khác. Không cần tạo worker trước trên dashboard, lần deploy đầu sẽ tự tạo.

### 1.5. Deploy — chọn 1 trong 2 cách

**Cách A — deploy từ máy**
```powershell
cd server
npm ci
npx wrangler login      # mở trình duyệt để đăng nhập Cloudflare
npm run deploy
```
Cuối log sẽ in ra URL của server.

**Cách B — GitHub Actions (tự deploy mỗi lần push thay đổi trong `server/`)**
1. Tạo API token: Cloudflare → **My Profile → API Tokens → Create Token** → template **Edit Cloudflare Workers** → copy token.
2. Lấy **Account ID**, một trong các cách:
   - đoạn 32 ký tự trên URL dashboard: `dash.cloudflare.com/<account-id>/...`
   - **Workers & Pages** → cột phải → **Account details**
   - chạy `npx wrangler whoami`

   (Đừng nhầm với **Zone ID**, cái đó gắn với domain, không dùng ở đây.)
3. Repo GitHub → **Settings → Secrets and variables → Actions → New repository secret**, thêm:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | token ở bước 1 |
   | `CLOUDFLARE_ACCOUNT_ID` | account ID ở bước 2 |
4. Tab **Actions → Deploy relay → Run workflow** để deploy lần đầu. Log bước `npx wrangler deploy` có in URL server.

### 1.6. Kiểm tra
Mở `https://<name>.<subdomain>.workers.dev/health`, thấy `ok` là server đã chạy.

### 1.7. (Tuỳ chọn) Gắn sẵn URL server vào extension
Mặc định extension trỏ về `http://127.0.0.1:8787` (server chạy local), nên mỗi người phải tự đặt setting `kvsync.endpoint`. Để khỏi phải đặt, sửa giá trị mặc định trong [`extension/package.json`](extension/package.json):
```json
"kvsync.endpoint": {
  "type": "string",
  "default": "https://chess-relay.tenban.workers.dev",
  ...
}
```
rồi build lại extension (Phần 2).

> Nếu repo của bạn để public, **đừng commit** thay đổi này: chỉ sửa tạm để build file `.vsix` gửi cho nhóm, sau đó `git checkout extension/package.json`. Như vậy người lạ clone repo về sẽ không dùng chung hạn mức Cloudflare của bạn.

---

## Phần 2 — Build và cài extension

### 2.1. Lấy file `.vsix`
**Cách 1 — tải từ Releases (khỏi build):** vào tab **Releases** của repo, tải file `kv-batch-sync-<version>.vsix` ở bản mới nhất.

Release được tạo tự động bởi [`.github/workflows/release-extension.yml`](.github/workflows/release-extension.yml) mỗi khi push thay đổi trong `extension/` lên `main` **và đã tăng `version`** trong [`extension/package.json`](extension/package.json) (cùng version thì bỏ qua, không tạo release trùng).

Để file trong release trỏ sẵn về server của bạn (người chơi khỏi đặt `kvsync.endpoint`): repo → **Settings → Secrets and variables → Actions → tab Variables → New repository variable**, tên `KVSYNC_ENDPOINT`, giá trị là URL server (ví dụ `https://chess-relay.tenban.workers.dev`). Không đặt thì file trỏ về `http://127.0.0.1:8787`.

> Repo public thì ai cũng tải được release, tức là ai cũng thấy URL server nếu bạn đặt `KVSYNC_ENDPOINT`. Gói Cloudflare miễn phí không bị tính tiền, nhưng người lạ có thể dùng chung hạn mức. Muốn kín thì để repo private, hoặc không đặt biến này và gửi URL riêng cho nhóm.

**Cách 2 — tự build:**
```powershell
git clone https://github.com/<user>/<repo>.git
cd <repo>\extension
npm ci
npm run compile
npm run package          # tạo kv-batch-sync-0.4.0.vsix trong thư mục extension
```
File `.vsix` không được commit lên repo (đã nằm trong `.gitignore`).

### 2.2. Cài vào VS Code
- Extensions (`Ctrl+Shift+X`) → nút `...` góc trên → **Install from VSIX...** → chọn file `.vsix`
- hoặc: `code --install-extension kv-batch-sync-0.4.0.vsix`

Cài bản mới đè lên bản cũ cũng làm y như vậy.

### 2.3. Cấu hình
`Ctrl+,` → tìm `kvsync`:

| Setting | Giá trị |
|---|---|
| `kvsync.endpoint` | URL server của nhóm bạn, ví dụ `https://chess-relay.tenban.workers.dev` (bỏ qua nếu file `.vsix` đã gắn sẵn ở bước 1.7) |
| `kvsync.colors.*` | Bật/tắt và đổi màu ô tối, quân trắng, quân đen (xem [PLAY.md](PLAY.md#2-đọc-bàn-cờ)) |
| `kvsync.author` | Tên hiển thị của đối thủ trong dòng "blame" (tuỳ chọn) |

### 2.4. Nạp lại VS Code
`Ctrl+Shift+P` → **Developer: Reload Window**. Gõ `Ctrl+Shift+P` → `Kv:` sẽ thấy 10 lệnh của extension.

Xong — sang [PLAY.md](PLAY.md) để chơi.

---

## Xử lý sự cố khi cài đặt

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| Deploy lỗi `register a workers.dev subdomain` | Chưa làm bước 1.3 |
| Actions lỗi xác thực Cloudflare | Sai/thiếu secret `CLOUDFLARE_API_TOKEN` hoặc `CLOUDFLARE_ACCOUNT_ID` |
| Repo fork không chạy workflow | Chưa bật Actions cho fork (bước 1.2) |
| `/health` không mở được ngay sau khi tạo subdomain | DNS cần vài phút, đợi rồi thử lại |
| `curl` trên Windows báo `CRYPT_E_NO_REVOCATION_CHECK` | Do mạng công ty; thêm `--ssl-no-revoke`, server vẫn chạy bình thường |
| Không thấy lệnh `Kv: ...` trong Command Palette | Chưa reload window, hoặc extension đang bị Disable trong tab Extensions |
| `kvsync.endpoint is not configured` | Chưa đặt setting `kvsync.endpoint` |

---

## Phát triển
```powershell
# Server chạy local tại http://127.0.0.1:8787 (giá trị mặc định của kvsync.endpoint)
cd server
npm run dev

# Extension: mở thư mục extension/ trong VS Code rồi nhấn F5
cd extension
npm run watch
```
