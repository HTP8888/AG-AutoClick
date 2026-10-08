# AG Auto Click & Scroll v10.5.0

## ✨ Tích hợp thêm Antigravity Agent 2.0 - Tự Đông Tích Hợp Auto

### 🔥 Tính năng mới: Auto Click nhiều conversation cùng lúc trong Antigravity Agent (Click nền / Đa luồng)

- **Tự động click đa luồng / đa conversation:** Khi bạn mở nhiều task hoặc conversation cùng lúc trong Antigravity Agent, bất kỳ conversation nào chạy ngầm xuất hiện các nút yêu cầu (`Submit`, `Run`, `Allow`, `Accept`...) đều sẽ **tự động được click phê duyệt ngay lập tức**.
- **Không cần chuyển tab hay canh từng conversation:** Bạn không cần phải đổi qua đổi lại giữa các tab hội thoại để canh bấm nút thủ công.
- **Không cướp tiêu điểm (focus), không giật màn hình:** Tự động phê duyệt trực tiếp qua giao thức ngầm của Agent, hoàn toàn không chiếm con trỏ chuột hay gián đoạn quá trình gõ phím của bạn.
- **Không cần treo Antigravity IDE:** Sau khi cài đặt và kích hoạt, bạn có thể tắt hẳn Antigravity IDE đi. **Auto Click trong Antigravity Agent vẫn chạy bình thường độc lập**, áp dụng cho cả tab hiện tại lẫn tất cả tab chạy ngầm.

---

### 🛠 Hướng dẫn cài đặt & kích hoạt Antigravity Agent (Bản Màu Trắng)

- **B1.** Tắt Antigravity Agent (Bản Màu Trắng).
- **B2.** Mở Antigravity IDE. Sau đó nhấn tổ hợp phím **Ctrl + Shift + P** (macOS: **Cmd + Shift + P**).
- **B3.** Tìm lệnh **`AG Auto: Sync & Fix Antigravity Agent 2.0 (Kích hoạt / Sửa lỗi)`** rồi kích hoạt.
- **B4.** Chờ nó cài đặt sau tích hợp vào Antigravity Agent (Bản Màu Trắng).
- **B5.** Khởi động lại Antigravity Agent (Bản Màu Trắng) → bấm nút **AG Auto** ở góc dưới bên phải màn hình → tick chọn các nút cần bấm (**Submit / Run / Accept / Allow**) và bật **Tự động bấm**.
---

## ☕ Ủng hộ tác giả

Nếu extension giúp ích cho bạn, mời tác giả một ly cà phê nhé! ☕  
Quét mã QR bên dưới qua **Momo, VietQR hoặc Napas 247**:

<p align="center">
  <img src="https://github.com/zixfelw/ag-auto-click-scroll/raw/HEAD/media/momo-qr.png" alt="Momo QR - Ủng hộ tác giả" width="250"/>
</p>

> 🙏 Mọi sự ủng hộ đều là động lực để mình tiếp tục phát triển extension miễn phí cho cộng đồng!

---

## Lịch sử phiên bản (không phải hướng dẫn cài hiện tại)

> Các bước Command Palette và VSIX cũ bên dưới được giữ để tham khảo lịch sử. Với các phiên bản mới, xem hướng dẫn cài đặt ở đầu trang.

## Có gì mới trong v9.8.16 — Antigravity Agent

- **Loader tương thích sandbox:** payload được đóng gói trực tiếp vào preload, không đọc `fs/path/os` hoặc dùng `new Function` trong renderer. Không tắt sandbox hay bật Node integration.
- **Nút cấu hình trong Agent:** AG Auto mở panel ON/OFF, danh sách nút (bao gồm Submit) và chu kỳ click; cấu hình được lưu tại Agent và dùng được khi IDE đã đóng.
- **Phát hiện cài đặt:** kiểm tra ứng dụng thật thay vì chỉ thấy thư mục `resources`; có đường dẫn tùy chỉnh `ag-auto.agentPath` khi cài ở ổ khác hoặc có nhiều bản.
- **Chẩn đoán rõ ràng:** Command Palette → `AG Auto: Diagnose Antigravity Agent (Chẩn đoán)`. Không coi việc ghi patch là bằng chứng engine đã chạy.
- **Cài đặt có kiểm tra và rollback:** không ưu tiên backup cũ hơn gói cập nhật, không báo thành công khi thiếu preload, không đóng mọi process trùng tên Antigravity.
- **Test riêng cho Agent:** kiểm tra discovery/installer và runtime độc lập với bộ test IDE.

### Cấu hình Agent

Xem **Cấu hình Antigravity Agent 2.0** ở đầu trang. Khi cần sửa lỗi thủ công: **Ctrl+Shift+P** → **AG Auto: Sync & Fix Antigravity Agent 2.0 (Kích hoạt / Sửa lỗi)**; hoặc dùng nút sửa lỗi trong dashboard.

**Cấu hình:** Agent và IDE là hai runtime riêng. Bản này không đồng bộ hai chiều realtime. Cấu hình cá nhân tại Agent không bị âm thầm ghi đè; seed từ IDE được áp dụng qua Sync và khởi động lại, có thao tác nhập seed trong panel Agent. Tắt hết pattern phải giữ danh sách rỗng.

**Giới hạn:** tích hợp Agent sửa file ứng dụng Electron, không phải API VSIX native của Agent. Chỉ patch layout được nhận diện; quyền ghi, build đóng gói khác, cập nhật ứng dụng hoặc nhiều bản cài có thể cần xử lý rõ ràng. Chưa cam kết mọi phiên bản/hệ điều hành. Test mô phỏng không thay cho kiểm tra trên máy thứ hai. Agent panel không bao gồm dashboard thống kê, pricing, click limits hay auto-scroll của IDE.

> Auto-submit có thể phê duyệt lệnh. Chỉ bật cho môi trường và tác vụ bạn tin tưởng; không tự chọn quyền “always allow”. Khi gỡ VSIX, hãy đóng Agent trước để có thể phục hồi file ứng dụng. Nếu phục hồi bị chặn, cài lại VSIX để thực hiện gỡ an toàn thay vì xóa file ứng dụng thủ công.

### Ghi chú lịch sử v9.8.15

Bản trước sửa offset giải nén ASAR và thêm pill ON/OFF, nhưng vẫn còn loader phụ thuộc Node trong sandbox, thiếu panel cấu hình Agent và các lỗi discovery/update. Các mô tả “hoạt động mọi máy” hoặc “gỡ sạch 100%” trong changelog cũ không phải cam kết tương thích của bản hiện tại.

**Tính năng IDE hiện có:** tự nhấn Run/Allow/Submit/Accept và auto-scroll, cấu hình/giới hạn click qua Settings của IDE.

---

## Có gì mới trong v9.8.14

- **Hỗ trợ 2-trong-1 (Dual-App Support)** — Tự động nhận diện và bảo vệ cả **Antigravity IDE** lẫn **Antigravity Agent (Desktop App)** chỉ với một lần cài đặt VSIX duy nhất.
- **Tự động Auto Submit & Run trên Agent Desktop** — Tự động nhận diện các nút `Submit`, `Proceed`, `Accept`, `Accept all`, `Run`, `Allow in Workspace`, `Keep Waiting`, `Continue`, `Retry` ngay trong giao diện Electron của Antigravity Agent.
- **Zero Dependency ASAR Engine** — Bộ giải nén và hook ASAR thuần Node.js không cần cài thêm npm/npx, hoạt động ngay lập tức trên máy người dùng cuối.
- **Gỡ cài đặt sạch sẽ 100% (Clean Uninstaller)** — Khi tắt (`ag-auto.disable`) hoặc gỡ bỏ extension khỏi IDE (`vscode:uninstall`), hệ thống tự động dọn dẹp toàn bộ hook và file script bên Antigravity Agent, trả lại trạng thái ứng dụng nguyên bản.
- **Floating Badge & Phím tắt Alt+A** — Bổ sung huy hiệu trạng thái `⚡ AG Auto: ON / OFF` trực quan ở góc màn hình Antigravity Agent cùng phím tắt `Alt + A` để bật/tắt nhanh.

## Có gì mới trong v9.8.13

- **Nâng cấp cần Reload một lần** để nạp protocol IPC mới. Sau đó lỗi transport hoặc Extension Host restart thông thường sẽ tự pair/reconnect, không tự reload cửa sổ.
- **Pairing riêng từng cửa sổ** — không còn đoán owner theo thời điểm khởi động; cửa sổ khác quét port không làm mất owner. Probe không trả token/config.
- **Request có deadline** — timeout, callback tới trễ và scan bị treo đều có cơ chế thoát; retry có backoff tối đa 30 giây.
- **Không click bằng config quá hạn** — lease 15 giây, kiểm tra ngay trong click/scroll tick; tự tiếp tục theo ON/OFF hiện tại sau config đã xác minh.
- **HTTP watchdog** — ưu tiên lại port cũ, chuyển port khi bị chiếm, probe sức khỏe có ngưỡng xác nhận và đóng socket cũ khi restart.
- **Ít tải nền hơn** — native watcher Windows chạy single-flight; callback/timer cũ không được tác động phiên mới.
- **Chẩn đoán** — Output → `AG Auto IPC` có port/generation, độ tuổi heartbeat và trạng thái recovery; không ghi pairing token hoặc nội dung chat.
- **Giữ nguyên UI** — Settings, quảng cáo, chữ/màu Accept/Scroll ON–OFF, click patterns và cách chọn nút không đổi.

**Giới hạn kiểm chứng:** đã test production handlers, loopback HTTP thật và 2 giờ mô phỏng bằng fake clock; chưa soak 1–2 giờ trên IDE thật hoặc xác nhận mọi runtime/hệ điều hành. DOM marker được đối chiếu với bundle Antigravity đang cài; khi không có marker hợp lệ, script chờ thay vì chọn nhầm host. ID nội bộ status item đổi theo host nên lựa chọn ẩn riêng item có thể cần đặt lại sau host restart; ẩn toàn status bar/Zen Mode không đổi.

**Thống kê:** retry cùng host được dedupe kể cả sau restart HTTP. Nếu toàn Extension Host crash giữa ghi stats và ACK, có thể mất/đếm lại batch chưa xác nhận; không cam kết exactly-once xuyên crash.

## Có gì mới trong v9.8.12

- **Chờ xác minh đủ 60 giây** — warning Reload không xuất hiện sớm khi renderer vẫn đang khởi động hoặc reconnect bình thường.
- **Ba heartbeat khỏe liên tiếp** — pending recovery chỉ được clear sau ba báo cáo mới từ cùng renderer, đúng preference Accept/Scroll và không degraded.
- **Tiếp tục kiểm tra sau warning** — nếu Auto Accept thực tế vẫn hoạt động ổn định, supervisor tự clear warning mà không bắt người dùng reload thừa.
- **Heartbeat retry đáng tin cậy** — report chỉ được đánh dấu đã gửi sau `HTTP 200` + `{ "ok": true`; request fail/timeout sẽ retry ở poll kế tiếp.
- **Khóa race persisted state** — write `set/clear` được serialize, journal chỉ ACK sau xác minh cuối và state cũ không thể hồi sinh sau khi đã clear.
- **Fix toast cũ chặn warning mới** — completion path giải phóng notification promise cũ; action cũ vẫn có guard nên không thể reload nhầm recovery mới.
- **Đã review code ba vòng** — kiểm tra state machine, timer/focus, reconnect, lifecycle, multi-window, endpoint identity và nội dung VSIX.

## Có gì mới trong v9.8.8

- **Startup grace 20 giây** — khi vừa mở Antigravity, warning và status `Auto Accept cần Reload` được ẩn trong 20 giây để renderer có thời gian kết nối bình thường.
- **Không báo nếu tool đã khỏe** — heartbeat hợp lệ trong grace period sẽ hủy timer và xóa pending warning trước khi UI xuất hiện.
- **Enable reload ngay** — chọn `Ctrl+Shift+P` → `AG Auto: Enable (Inject Script)` sẽ inject/repair rồi reload Antigravity ngay, không bắt bấm thêm vào status cảnh báo.
- **Giữ nguyên chống auto-reload** — startup và supervisor vẫn tuyệt đối không tự reload; reload ngay chỉ xảy ra sau command Enable do chính người dùng chủ động chọn.
- **Timer one-shot có cleanup** — focus re-arm tôn trọng thời hạn còn lại, không kéo dài grace, không polling và timer được hủy khi heartbeat khỏe hoặc extension deactivate.

## Có gì mới trong v9.8.7

- **Không còn tự reload Antigravity** — supervisor repair, startup inject và lệnh Enable chỉ sửa script rồi chờ người dùng xác nhận; không còn timer gọi `Reload Window`.
- **Cảnh báo sticky tới khi tool chạy lại** — status bar hiển thị `⚠ Auto Accept cần Reload`; đóng notification bằng `X` không xóa cảnh báo.
- **Notification chỉ có `Reload ngay`** — không có nút “Để sau”; khi quay lại focus project, notification được re-arm theo event thay vì polling/spam timer.
- **Chỉ xóa sau heartbeat khỏe** — warning được giữ qua Extension Host restart và chỉ biến mất khi renderer instance mới gửi heartbeat hợp lệ sau repair.
- **Chống repair/reload loop** — khi đang chờ reload, supervisor không inject/repair lặp; cooldown 30 phút và giới hạn 2 repair/24 giờ vẫn được giữ.
- **Tách state theo project** — project khỏe không thể vô tình xóa cảnh báo đang chờ reload của project khác.
- **Giữ nguyên UX v9.8.6** — `Accept/Scroll` vẫn chỉ hiện ON/OFF, dashboard không bật theo recovery/đổi trạng thái và promo foreground một lần sau 4 giờ vẫn hoạt động.
- **Đã review code hai vòng** — vòng 1 kiểm tra reload/state lifecycle; vòng 2 audit loop safety, focus, multi-window và toàn bộ reload call-site.

## Có gì mới trong v9.8.6

- **Status bar chỉ còn ON/OFF** — các phase kỹ thuật của recovery vẫn chạy nội bộ nhưng không còn làm `Accept/Scroll` nhảy qua `CONNECTING`, `RECOVERING` hoặc `DEGRADED` khi đổi focus hay mở project khác.
- **Chặn dashboard restore từ đầu startup** — serializer và tab guard được đăng ký ngay đầu `activate()`, trước inject, IPC và các tác vụ nền; webview cũ không còn có khoảng trống để ló lên rồi mới bị đóng.
- **Khóa nguồn mở dashboard** — Settings chỉ nhận trigger rõ ràng từ thao tác người dùng hoặc promo; runtime transition/recovery không thể tự gọi panel.
- **Giữ promo một lần sau 4 giờ** — fallback chỉ mở ở project window đang foreground; project nền không được giành focus hay bật dashboard.
- **Không đổi Accept/Scroll** — promo, restore guard và runtime health không ghi đè preference automation đã lưu.
- **Không thêm reload loop** — hotfix không thêm polling/reload; stale kép, 3 miss, pending confirmation, cooldown 30 phút và giới hạn 2 repair/24 giờ được giữ nguyên.
- **Submit giữ nguyên bình thường** — tiếp tục đi qua click flow chung, không có xử lý riêng theo nội dung composer.
- Khi cần can thiệp thủ công, chạy `Ctrl+Shift+P` → **AG Auto: Enable (Inject Script)**.

## Có gì mới trong v9.7.4

### ✅ Auto repair sau khi Antigravity update
- **Fix Accept ON nhưng không click** — Antigravity bản mới có thể ghi đè `workbench.html`, làm mất script inject trong renderer dù setting vẫn ON.
- **Fingerprint workbench mới** — nếu script bị mất sau app update, extension dùng fingerprint `workbench.html` mới để tự inject lại thay vì skip do đã từng thử `missing-script`.
- **Tự reload sau repair** — khi repair thành công sẽ clear V8 cache, update checksum và reload window để script chạy lại.
- **Giữ fix v9.7.3** — Submit ở footer permission card theo ảnh thực tế vẫn được nhận diện.
- **Giữ hotfix storefront** — BOT Order Telegram full link và dashboard stats/history ổn định.

## Có gì mới trong v9.5.1

### 🔴 Fix lỗi trạng thái ON giả khi runtime đã chết
- **Fix status bar báo ON sai sự thật** — Trước đây có case injected script đã tự disable do `server lost` hoặc `bindRejected`, nhưng Extension Host vẫn giữ state cũ nên status bar vẫn hiện **Accept ON / Scroll ON**. Giờ script sẽ chủ động báo tình trạng runtime về host, và status bar sẽ chuyển sang **DEGRADED** để phản ánh đúng thực tế.
- **Thêm runtime health sync** — Extension giờ có kênh đồng bộ riêng để biết khi nào script đang healthy, khi nào đang fail tạm thời do mất bind, mismatch owner, hoặc mất kết nối poll.
- **Cải thiện khả năng chẩn đoán lỗi** — Tooltip status bar giờ giải thích rõ khi auto đang ở trạng thái degraded và gợi ý Reload Window / mở lại Antigravity nếu runtime không tự recover.

### 🔧 Auto-recovery — Script tự hồi phục khi mất kết nối
- **Tự retry sau bind rejection** — Trước đây script bị reject là chết luôn. Giờ sẽ tự retry discovery với delay tăng dần (5s → 10s → 30s) cho đến khi server accept.
- **Stale owner detection** — Server tự release ownerKey nếu owner cũ không poll >30s, cho phép script mới claim lại mà không cần Reload Window.
- **Backup re-discover** — Khi mất server, ngoài retry ngay lập tức còn có retry backup sau 8s để tăng khả năng reconnect khi AG đang restart.

## Có gì mới trong v9.5

### 🔴 Fix lỗi nghiêm trọng — Auto-click tự tắt sau một thời gian
- **Fix JSON.parse crash trong HTTP poll** — Nguyên nhân chính khiến auto-click tự tắt sau khi chạy một lúc. Khi server trả response bị cắt (do CPU cao, server restart, hoặc network lag), `JSON.parse` throw exception nhưng không có `try-catch` → poll errors tích lũy → auto-click tự disable sau ~18 giây. Giờ lỗi parse được xử lý mượt, stats tự rollback, và kết nối không bị gián đoạn.
- **Fix tốc độ quét click bị kẹt ở 5 giây** — Dù set 10s, 30s hay 50s trong Settings, click loop luôn chạy tối đa 5000ms do clamp xung đột giữa `_agApplyConfig` (cho phép 120s) và `_agStartClickLoop` (giới hạn 5s). Giờ cả hai dùng chung max 120000ms — set bao nhiêu chạy đúng bấy nhiêu.
- **Fix UI input max** — Ô nhập "Tốc độ quét click" trên dashboard trước đây giới hạn max=5000, giờ cho phép đến 120000ms.

### 🎨 Cải thiện Dashboard
- **Thêm hint cho ô tốc độ click** — Giải thích rõ: giá trị cao hơn = chờ lâu hơn giữa mỗi lần click, giúp review code trước khi auto-click tiếp.
- **Fix i18n Auto Scroll** — Subtitle "Smart follow with manual pause" giờ hiển thị đúng ngôn ngữ (VN/EN/ZH) thay vì luôn tiếng Anh.
- **Fix duplicate content** — Hint dưới ô click không còn bị trùng với subtitle phía trên.

---

## Có gì mới trong v9.4

### 🐛 Sửa lỗi ổn định — "Dùng một lúc là bị"
- **Fix WeakSet kẹt nút** — Nguyên nhân chính khiến extension ngừng click sau khi dùng một thời gian. Nút đã click giờ tự giải phóng sau 30s, cho phép click lại khi DOM được tái sử dụng.
- **Tăng ngưỡng mất kết nối** — Từ 4 lên 9 lần poll error liên tiếp trước khi tắt auto-click. Giảm false-positive khi CPU cao hoặc server bận.
- **Giữ port kết nối** — Không reset port về 0 khi re-scan provisional, giữ kết nối ổn định hơn.
- **Tự re-discover server** — Khi mất kết nối, tự động tìm lại server ngay thay vì chờ.
- **Không mất click stats** — Stats không bị mất khi XHR timeout, tự rollback về session pending.

### 🎛️ Sửa lỗi tốc độ quét click
- **Click interval áp dụng ngay** — Trước đây đổi "Tốc độ quét click (ms)" rồi Save & Apply nhưng vẫn chạy tốc độ cũ. Giờ setInterval được restart lại khi giá trị thay đổi.
- **Commands API loop cũng restart** — Loop VS Code Commands API giờ cũng cập nhật tốc độ khi Save & Apply.

### 📊 Click Stats Dashboard
- **Chỉ giữ 10 nút chính** — Bỏ Continue, chỉ hiển thị 10 pattern quan trọng nhất.
- **Mặc định Most clicked** — Sắp xếp theo số click giảm dần, có dropdown để đổi.
- **Layout 2 cột dọc** — Thứ tự: cột trái 1-5, cột phải 6-10.
- **Một hệ màu cyan** — Tất cả bar dùng cùng gradient, không loạn màu.
- **Sửa nhận diện Allow in Workspace** — Thống kê/log đúng pattern thay vì bị gom vào Allow.
- **Click Log compact** — Search + Pattern filter trên cùng 1 hàng để xem nhiều log hơn.

---

## Cập nhật nhanh v9.3

> Bản v9.3 thêm **Health Indicator** trên dashboard và fix bug scroll preference không được lưu.

### Các thay đổi chính
- **Health Indicator** — Hiển thị Server port và trạng thái Script inject ngay trên dashboard header. Giúp user biết mình đang kết nối ở port nào (hữu ích khi mở nhiều cửa sổ Antigravity).
- **Fix scrollEnabled không persist** — Khi tắt Auto Scroll rồi reload window, giờ scroll sẽ giữ đúng trạng thái thay vì luôn bật lại ON.
- Hỗ trợ i18n (Việt/Anh/Trung) cho Health Indicator.
- Đa ngôn ngữ cải thiện: thêm các chuỗi dịch cho Server/Script/Port/Injected.

---

## Có gì mới trong v9.0

### 🎯 Giới hạn Click (Click Limits)
- Đặt **Max clicks** cho từng nút — VD: Run chỉ click **5 lần** rồi dừng
- Trống hoặc `0` = **Vô Hạn** (click mãi mãi, mặc định)
- Nút **"Vô Hạn"** để xóa nhanh giới hạn trên giao diện
- Giới hạn theo **session** — reset khi Reload Window
- Áp dụng cho **tất cả** pattern: Run, Allow, Accept, Always Allow, Keep Waiting...
- Chỉ cần nhập số + nhấn **Save & Apply** → có hiệu lực ngay

### 🛡️ Tự tắt khi Disable/Uninstall (Safe Disable)
- Script mặc định **OFF** — chỉ bật khi extension server xác nhận
- Disable hoặc uninstall extension → server tắt → script **tự ngừng click** sau ~6 giây
- Cài lại extension → script tự reconnect và bật lại
- Không còn tình trạng "zombie click" khi đã tắt extension

### Dashboard ổn định hơn
- Fix lỗi dashboard trắng khi webview bị lỗi render
- Phần stats, log và controls không còn bị một panel phụ làm crash toàn bộ UI
- Tối ưu lại luồng khởi tạo để mở settings ổn định hơn
- Bổ sung hỗ trợ nút **Allow in workspace** để auto-click khớp hơn với luồng quyền mới

### Multi-Instance
- Hỗ trợ chạy **2+ cửa sổ Antigravity** cùng lúc — không còn xung đột port
- Dynamic port: tự tìm port trống trong range 48787-48850
- Auto-discovery: script tự dò port server, tự reconnect khi mất kết nối
- Fix triệt để lỗi RAM nhảy 20GB khi mở nhiều instance

### Log Click Stats
- Ghi log chi tiết mỗi lần auto-click vào bảng thống kê
- Hiển thị lịch sử click realtime trong Settings panel

### Hỗ trợ nút Accept
- Tự động click **Accept** ở khung chat — tuyệt đối không click ở diff editor
- Phân biệt Accept (chat) vs Accept Changes/Accept All (editor) bằng DOM context
- Commands API chỉ chạy `acceptAgentStep` (chat), không chạy `agentAcceptAllInFile` (editor)
- Accept mặc định **ON**, hoạt động ngay khi cài — không cần Save & Apply

### Fix thông báo "Corrupt Installation"
- Tự động cập nhật checksums sau khi inject → xóa hoàn toàn cảnh báo "corrupt"
- Tự reload sau update checksums + tự đóng notification nếu vẫn hiện
- Tự phát hiện extension upgrade → re-inject script mới tự động

### Click Stats Dashboard
- Bảng thống kê click realtime ngay trong Settings với progress bar so sánh
- Nút click nhiều nhất tự động nhận vương miện
- Lưu thống kê qua restart, chỉ mất khi ấn Reset

### Native Dialog Auto-Click (Win32)
- Tự động nhấn **Keep Waiting** trong dialog "window not responding" bằng Win32 API

### Giao diện đơn giản hơn
- Bỏ ô nhập nút tùy chỉnh — chỉ giữ các nút mặc định, toggle ON/OFF
- Clean injection — chỉ dùng HTML script tag, ổn định hơn
- Bổ sung vài tinh chỉnh nhỏ cho dashboard để nhìn gọn và dễ thao tác hơn

---

## Tính năng chính

| Tính năng | Mô tả |
|-----------|-------|
| **Auto Click** | Tự động nhấn Run, Allow, Allow in workspace, Always Allow, Accept, Accept all, Keep Waiting... |
| **Click Limits** | Giới hạn số click cho từng nút — VD: Run click 5 lần rồi dừng. Trống = Vô Hạn |
| **Auto Scroll** | Cuộn khung chat xuống cuối để không bỏ lỡ nội dung mới |
| **Click Stats** | Bảng thống kê click realtime với progress bar và badge |
| **Instant Toggle** | Gạt switch ON/OFF → áp dụng tức thì, không cần Save hay Reload |
| **Tắt/Bật riêng** | Accept và Scroll có toggle riêng, hoạt động độc lập |
| **HTTP Live Sync** | Settings cập nhật realtime qua HTTP server nội bộ |
| **Smart Accept** | Accept chỉ click ở **khung chat** — không click ở diff editor |
| **Diff Protection** | KHÔNG click Accept Changes/Accept All/Accept Incoming trong editor |
| **Settings UI** | Giao diện đẹp — bật/tắt từng nút, chỉnh tốc độ, đa ngôn ngữ |
| **Dual Status Bar** | Hiện Accept ON/OFF và Scroll ON/OFF riêng biệt, màu xanh/đỏ |


---

## Danh sách nút hỗ trợ

Mặc định **ON**: `Run` · `Allow` · `Allow in workspace` · `Accept` · `Always Allow` · `Keep Waiting` · `Retry` · `Continue` · `Allow Once` · `Allow This Con`

Mặc định **OFF**: `Accept all` (bật thủ công khi cần)

> `Accept` chỉ click ở khung chat, không click ở editor. Bạn có thể thêm nút tùy chỉnh hoặc bật/tắt từng nút trong Settings.

---

## Cách sử dụng

### Cài đặt
1. Mở Antigravity / VS Code
2. `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Chọn file `.vsix` → Cài đặt → **Reload Window**
4. Extension tự inject script + **auto-reload** lần đầu

> **Linux**: lần đầu inject sẽ hiện hộp thoại nhập mật khẩu — chỉ cần nhập 1 lần.

### Mở Settings
- Click **"Accept ON/OFF"** hoặc **"Scroll ON/OFF"** trên Status Bar (góc dưới phải)
- Hoặc `Ctrl+Shift+P` → `AG Auto: Open Settings`
- Dashboard promo cũng có thể tự mở **một lần sau 4 giờ** trong phiên nếu Settings/promo chưa được xem; việc này không thay đổi Accept/Scroll.

### Sử dụng
- **Toggle ON/OFF**: Gạt switch → tức thì, không cần Save
- **Đổi patterns/settings**: Chỉnh thông số → nhấn **Save & Apply**
- **Reload thủ công**: Nhấn nút **Reload** khi cần

### Gỡ bỏ
`Ctrl+Shift+P` → `AG Auto: Disable` → **Reload Window**

---

> **Safe Click**: Script chỉ click nút nằm trong approval dialog (có nút Reject/Deny/Cancel bên cạnh). Không click nhầm diff editor, navigation, sidebar, hay dialog khác.

---

## Click Stats

![Click Stats](https://github.com/zixfelw/ag-auto-click-scroll/raw/HEAD/media/click-stats-screenshot.png)

## Giao diện Settings

![Settings UI](https://github.com/zixfelw/ag-auto-click-scroll/raw/HEAD/media/settings-screenshot.png)

---

## Changelog

### v9.8.6 (Latest)
- **Stable status UX**: status bar chỉ phản ánh preference `ON/OFF`; runtime health và recovery phase không còn đổi text/icon hay độ rộng item.
- **Project restore race fixed**: serializer + unexpected-tab guard được đăng ký trước mọi startup I/O, inject và IPC để chặn dashboard cũ ngay khi mở project khác.
- **Explicit dashboard intent**: mọi call mở Settings phải có trigger `user` hoặc `promo`; recovery/focus/runtime transition không có đường mở panel.
- **Foreground promo guard**: fallback 4 giờ vẫn một lần/phiên nhưng project window nền không được tự mở dashboard.
- **Preference integrity**: dashboard/promo không thể ép hoặc persist `Accept ON`.
- **Anti-loop unchanged**: không thêm reload/timer loop; giữ stale kép, 3 miss, pending confirmation, cooldown và daily repair budget.
- **Regression coverage**: khóa ON/OFF-only UI, explicit panel trigger, foreground promo và startup ordering.

### v9.8.5
- **Focus status stability**: heartbeat còn mới giữ status `ON`; focus listener không còn hạ runtime khỏe xuống `CONNECTING`.
- **Grace safety preserved**: tín hiệu stale vẫn được startup/focus grace 60 giây chặn repair và reset miss counter.
- **Four-hour proactive promo**: dashboard tự mở tối đa một lần sau 4 giờ mỗi phiên, có single-timer guard và cleanup khi deactivate.
- **Preference integrity**: xóa toàn bộ promo path ép/persist `Accept ON`; promo không thay đổi Accept/Scroll.
- **Session suppression**: nếu Settings hoặc promo đã được xem thì fallback 4 giờ không mở thêm.
- **Regression coverage**: thêm test cho grace healthy/stale, promo timer lifecycle và nguồn ghi Accept.
- **Anti-loop/Submit unchanged**: giữ pending confirmation, cooldown/daily budget và click flow Submit bình thường.

### v9.8.4
- **Renderer Recovery Supervisor**: tự phát hiện injected runtime bị rớt bằng hai tín hiệu độc lập và 3 vòng xác nhận.
- **Anti-loop policy**: startup/focus grace 60 giây, cooldown 30 phút, tối đa 2 auto repair mỗi 24 giờ.
- **Pending confirmation lock**: chỉ renderer instance mới, đúng owner window và sinh sau repair mới mở khóa lần repair tiếp theo.
- **Host/renderer isolation**: HTTP server lỗi sẽ được host watchdog xử lý, không kích hoạt reload renderer.
- **Concurrency safety**: manual/automatic repair dùng chung mutex và reload scheduling guard; timer được cleanup khi deactivate.
- **Status bar**: bổ sung trạng thái `CONNECTING`, `RECOVERING` và `DEGRADED` chính xác hơn.
- **Regression safety**: `Submit` tiếp tục dùng luồng click bình thường, không có logic riêng theo composer text.

### v9.8.3
- **Submit trở về luồng bình thường**: chỉ là một click pattern giống `Run` và `Allow`.
- **Xóa toàn bộ xử lý riêng**: không còn guard theo ô chat, Write in hoặc permission card.
- **Giữ auto-merge pattern**: config cũ vẫn tự nhận `Submit` nếu người dùng không chủ động tắt pattern này.
- **Giữ các fix ổn định**: HTTP IPC recovery, chống rớt/nhầm port và Run and Debug guard.

### v9.5.2

- **Light Mode**: Settings panel giờ hỗ trợ đầy đủ VS Code light theme — tự detect `.vscode-light` class và áp dụng bảng màu sáng (background, text, cards, inputs, buttons, progress bars, badges).

### v9.5.1
- **Bugfix quan trọng**: Fix trạng thái **Accept ON / Scroll ON giả** khi injected runtime đã tự disable do `server lost` hoặc `bindRejected`.
- **Runtime Health Sync**: Script giờ báo trạng thái degraded/healthy ngược về Extension Host để status bar phản ánh đúng thực tế.
- **Status Bar**: Thêm trạng thái **DEGRADED** và tooltip giải thích khi runtime đang lỗi tạm thời.
- **Auto-Recovery**: Script tự retry discovery sau bind rejection (progressive delay 5s→30s) thay vì chết luôn.
- **Stale Owner Detection**: Server tự release ownerKey nếu owner không poll >30s — cho phép script mới claim lại sau AG restart.
- **Backup Re-discover**: Thêm retry thứ 2 sau 8s khi server lost — tăng khả năng reconnect khi AG đang restart.

### v9.5.0
- **Bugfix nghiêm trọng**: JSON.parse crash trong HTTP poll khiến auto-click tự tắt sau một thời gian — giờ có try-catch + stats rollback.
- **Bugfix nghiêm trọng**: Tốc độ quét click bị kẹt ở 5000ms do clamp xung đột — giờ tôn trọng đúng giá trị user set (200ms–120s).
- **Bugfix**: UI input max click interval từ 5000 lên 120000ms.
- **UI**: Thêm hint giải thích cho ô tốc độ quét click.
- **UI**: Fix subtitle Auto Scroll luôn hiện tiếng Anh — giờ hiển thị đúng ngôn ngữ.
- **UI**: Fix duplicate hint content trong panel Auto Click.

### v9.4.0
- **Bugfix quan trọng**: Sửa lỗi "dùng một lúc là bị" — nút bị kẹt trong WeakSet, giờ tự giải phóng sau 30s.
- **Bugfix**: Tốc độ quét click không áp dụng sau Save & Apply — setInterval giờ restart khi giá trị thay đổi.
- **Bugfix**: Commands API loop cũng restart theo tốc độ mới.
- Tăng ngưỡng poll error lên 9 lần, tự re-discover server khi mất kết nối.
- Giữ port kết nối khi re-scan provisional, không mất stats khi XHR timeout.
- Click Stats: 10 nút chính, Most clicked mặc định, rank 1-10, layout 2 cột dọc, gradient cyan thống nhất.
- Click Log: compact toolbar, bỏ Continue, sửa nhận diện Allow in Workspace.
- Responsive layout: tự co giãn theo chiều rộng webview.

### v9.3.0
- **Health Indicator** — Hiển thị Server port và Script inject status trên dashboard
- **Fix scrollEnabled** không persist sau reload — lưu vào globalState
- Cải thiện i18n cho health indicator (Việt/Anh/Trung)

### v9.2.0
- Fix mặc định **Accept OFF** sau khi restart (restore từ `startupEnabledPreference`)
- Đồng bộ trạng thái giữa **Dashboard ↔ Status Bar ↔ Runtime**
- Fix điểm ghi đè state trong `startCommandsLoop()`
- Thêm cơ chế bind chặt renderer/server bằng `windowKey + startedAt` để tránh loạn trạng thái multi-window

### v9.0.0
- **Click Limits** — Giới hạn số click cho từng nút, trống = Vô Hạn
- **Nút "Vô Hạn"** — Xóa nhanh giới hạn trên giao diện
- **Safe Disable** — Script tự tắt khi disable/uninstall extension, không còn zombie click
- **Promotion System** — Thông báo tài khoản giá rẻ thông minh, tự retry

### v8.3.0
- **Smart Auto Scroll** — Tự bật/tắt scroll theo hoạt động agent (MutationObserver)

### v8.2.0
- **Fix Multi-Instance** — Hỗ trợ 2+ cửa sổ cùng lúc, dynamic port, auto-discovery

### v8.1.0
- **Log Click Stats** — Ghi log chi tiết mỗi lần auto-click, hiển thị lịch sử click realtime trong Settings

### v7.4.0
- **Hỗ trợ nút Accept** — Tự động click Accept ở khung chat, tuyệt đối không click ở diff editor
- **Smart Accept Logic** — Phân biệt Accept (chat) vs Accept Changes/Accept All (editor) bằng DOM context
- **Chat-only Commands** — Commands API chỉ chạy `acceptAgentStep` (chat), không chạy `agentAcceptAllInFile` (editor)
- **Clean Injection** — Bỏ inject code vào workbench.js, chỉ dùng HTML script tag — ổn định hơn, không bị V8 cache

### v7.0.0
- **Fix 'Corrupt Installation' Warning** — Tự động cập nhật checksums trong `product.json`
- **Auto-Reload sau Update** — Tự reload sau khi cập nhật checksums
- **Auto-Dismiss Notification** — Tự đóng notification "corrupt" nếu vẫn xuất hiện

### v6.3.0
- **Click Stats Dashboard** — Thống kê click realtime, progress bar, vương miện, badge
- **Native Dialog Auto-Click** — Tự nhấn "Keep Waiting" qua Win32 API
- **Persistent Stats** — Lưu thống kê qua restart
- **Toggle Panel** — Click status bar để mở/đóng Settings
- **Display Name Mapping** — Hiển thị tên đầy đủ cho patterns

### v5.8.0
- **SSH Remote Support** — Hoạt động trên Remote-SSH
- **Async HTTP Polling** — Không block UI
- **Auto-stop polling** — Dừng sau 5 lỗi liên tiếp

### v5.5.0
- **Auto-fix sau update** — Tự inject lại khi Antigravity update

### v5.4.0
- **Smart Auto Scroll** — Chỉ cuộn trong khung chat chính
- **Jitter-free Scrolling** — Dừng cuộn khi chạm đáy

### v5.1.0
- **Linux/macOS support** — Auto-elevation
- **Diff Protection** — Không click diff editor
- **Smart Commands Loop** — Tôn trọng pattern settings
- **Status Bar Adjacent** — 2 items liền kề

### v5.0.0
- Instant Toggle, Scroll Toggle, HTTP IPC, Dual Status Bar
- UI nâng cấp, Auto-inject + Auto-reload

### v4.x
- Auto Click, Auto Scroll, Settings UI đa ngôn ngữ, Safe Click

---

## License

MIT © [Zixfel](https://github.com/zixfelw)
