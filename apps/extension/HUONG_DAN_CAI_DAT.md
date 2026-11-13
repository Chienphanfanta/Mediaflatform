# Extension “Media Ops — Tự đăng bài” — Hướng dẫn cài đặt

Extension chạy trên **Google Chrome** và **Cốc Cốc** (Windows, macOS). Nó tự đăng các bài đã lên lịch
trong hệ thống lên **Facebook Page, TikTok, YouTube** bằng chính tài khoản đang đăng nhập trên trình duyệt.

## 1. Build bản cài (người quản trị)

```bash
npm install
npm run build -w @media-ops/extension      # → apps/extension/dist/
npm run package -w @media-ops/extension    # → apps/extension/release/media-ops-extension-v<version>.zip
```

## 2. Cài trên từng máy

### Cách A — Cài thủ công (nhanh, ít máy)

1. Giải nén file `media-ops-extension-v*.zip` vào một thư mục cố định, ví dụ `C:\MediaOps\extension`
   (**không xoá thư mục này** sau khi cài).
2. Mở trang quản lý extension:
   - Chrome: gõ `chrome://extensions`
   - Cốc Cốc: gõ `coccoc://extensions` (hoặc Menu → Tiện ích mở rộng)
3. Bật **Chế độ dành cho nhà phát triển** (Developer mode) ở góc phải.
4. Bấm **Tải tiện ích đã giải nén** (Load unpacked) → chọn thư mục ở bước 1.
5. Ghim biểu tượng extension lên thanh công cụ.

Khi cập nhật phiên bản mới: chép đè thư mục, rồi bấm nút ⟳ (Tải lại) trên thẻ extension.

### Cách B — Cài hàng loạt bằng chính sách Windows (nhiều máy)

1. Đăng extension lên Chrome Web Store ở chế độ **Không công khai (Unlisted)** — lấy ID 32 ký tự.
2. Sửa `scripts/windows/force-install-chrome.reg` (và `force-install-coccoc.reg`), thay `EXTENSION_ID_CUA_BAN`.
3. Chạy file `.reg` bằng quyền Administrator trên từng máy (hoặc đẩy qua Group Policy).
4. Mở `chrome://policy` → **Tải lại chính sách**. Extension tự cài và tự cập nhật, nhân viên không gỡ được.

> Đường dẫn policy của Cốc Cốc chưa được kiểm chứng — kiểm tra tại `coccoc://policy`; nếu không nhận,
> dùng Cách A cho Cốc Cốc.

## 3. Ghép trình duyệt với tài khoản nhân viên

1. Trên trình duyệt đó, **đăng nhập sẵn** Facebook (tài khoản quản trị Page), TikTok, YouTube
   của các kênh nhân viên phụ trách.
2. Vào hệ thống → **Đăng bài → Trình duyệt** → bấm **Tạo mã ghép** (mã 6 ký tự, hết hạn sau 10 phút).
3. Bấm biểu tượng extension → nhập **Địa chỉ hệ thống** (vd `https://abc.tracker.com`) + **mã ghép**
   → **Ghép trình duyệt** → đồng ý cấp quyền truy cập địa chỉ hệ thống.
4. Extension hiện tên nhân viên + danh sách kênh phụ trách là xong.

## 4. Cách hoạt động

- Mỗi phút extension hỏi server có bài nào **đến giờ đăng** cho các kênh nhân viên này phụ trách.
- Có bài → extension **mở một cửa sổ riêng** tới trang đăng bài của nền tảng, tự upload ảnh/video,
  điền nội dung, bấm Đăng, rồi tự đóng cửa sổ và báo kết quả về hệ thống.
- Nhiều máy cùng phụ trách 1 kênh: máy nào nhận trước sẽ đăng, máy khác bỏ qua (không đăng trùng).
- Giữa 2 lần đăng trên cùng 1 trình duyệt có khoảng nghỉ tối thiểu (mặc định 60 giây).
- **Trình duyệt phải đang mở** (có thể thu nhỏ). Tắt trình duyệt → bài chờ đến khi mở lại;
  hệ thống nhắn Telegram/Zalo cảnh báo trình duyệt offline lúc đến giờ.

## 5. Xử lý sự cố

| Hiện tượng | Nguyên nhân / cách xử lý |
|---|---|
| Lỗi “Trình duyệt chưa đăng nhập …” | Đăng nhập lại tài khoản nền tảng trên trình duyệt đó, rồi bấm **Đăng lại** trên web |
| Lỗi “Không tìm thấy phần tử trên trang (giao diện có thể đã đổi)” | Nền tảng đổi giao diện → quản trị viên cập nhật kịch bản (xem mục 6) |
| Lỗi “Không tải được file … (CORS MinIO)” | Máy nhân viên không truy cập được `S3_PUBLIC_ENDPOINT`, hoặc MinIO chặn CORS |
| Extension hiện “Trình duyệt này đã bị thu hồi” | Quản lý đã thu hồi trên web → tạo mã ghép mới |
| Bài nằm mãi ở “Chờ đăng” | Không có trình duyệt online của người phụ trách kênh, hoặc extension đang **Tạm dừng** |

Facebook đăng qua **Meta Business Suite** (`business.facebook.com`) để bài lên dưới danh nghĩa Page —
tài khoản cần có quyền quản trị Page trong Business Suite.

## 6. Cập nhật kịch bản khi nền tảng đổi giao diện (quản trị viên)

Kịch bản (selector, nhãn nút EN/VI, thứ tự bước) nằm ở `packages/shared/src/extension/flows.ts`
và được server phục vụ qua `GET /api/v1/ext/flows` → **không cần cài lại extension**.

- Sửa file rồi deploy web, hoặc
- Sửa nóng: đặt biến môi trường `EXTENSION_FLOWS_OVERRIDE` (JSON, chỉ cần flow của nền tảng bị lỗi):
  ```json
  { "flows": { "FACEBOOK": { "platform": "FACEBOOK", "version": 2, "openUrl": "...", "steps": [ ... ] } } }
  ```
- Extension làm mới kịch bản sau tối đa 10 phút.

Thông báo lỗi trên web ghi rõ `[NỀN_TẢNG vX] Bước "..."` để biết bước nào cần sửa.
