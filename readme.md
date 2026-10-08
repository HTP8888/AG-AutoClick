# AG Auto Click & Scroll

Tiện ích tự động click duyệt lệnh (`Submit`, `Run`, `Allow`, `Accept`) và tự động cuộn trang cho **Antigravity IDE** & **Antigravity Agent 2.0**.

---

## ⚡ Cài đặt bằng dòng lệnh (CLI)

### Cách 1: Tải trực tiếp và cài đặt (Khuyên dùng)

**Dành cho Windows (PowerShell):**
```powershell
Invoke-WebRequest -Uri "https://github.com/HTP8888/AG-AutoClick/raw/main/ag-auto-click-scroll-10.5.0.vsix" -OutFile "ag-auto-click.vsix"; antigravity --install-extension ag-auto-click.vsix
```
*(Nếu dùng VS Code thay cho Antigravity, thay `antigravity` bằng `code`)*

**Dành cho Linux / macOS (Terminal):**
```bash
curl -L -o ag-auto-click.vsix "https://github.com/HTP8888/AG-AutoClick/raw/main/ag-auto-click-scroll-10.5.0.vsix" && antigravity --install-extension ag-auto-click.vsix
```

---

### Cách 2: Clone repository và cài đặt

```bash
git clone https://github.com/HTP8888/AG-AutoClick.git
cd AG-AutoClick
antigravity --install-extension ag-auto-click-scroll-10.5.0.vsix
```

---

## 🚀 Kích hoạt sau khi cài đặt

1. Mở **Antigravity IDE**, nhấn `Ctrl + Shift + P` (macOS: `Cmd + Shift + P`).
2. Gõ và chạy lệnh:
   ```text
   AG Auto: Sync & Fix Antigravity Agent 2.0 (Kích hoạt / Sửa lỗi)
   ```
3. Mở **Antigravity Agent 2.0** → Bấm nút **AG Auto** ở góc phải màn hình → Bật **Tự động bấm**.
