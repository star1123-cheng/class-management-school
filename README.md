# 班級管理（全校版）

給全校導師共用的班級管理網頁（PWA）：記錄、看板、抽籤與背包。
前端放在 GitHub Pages，後端是一個綁定在試算表上的 Google Apps Script（GAS）。

本專案由單班版 `Class-Management` 複製前端與 `gas/Code.gs`（當底稿）而來，Git 歷史從零開始，與舊專案互不影響。

## 一、已決定的事項

| 項目 | 決定 |
| --- | --- |
| 架構 | 架構 B：新的 Google 帳號開一個 GAS + 試算表，全校共用、多班級 |
| 班級驗證 | 「班級」表記錄每班的導師碼與班級碼，只存加鹽雜湊；每支 API 都驗證班級 |
| 開班 | 由管理者開班，不開放自行註冊 |
| 管理密碼 | 導師手動填在 GAS 指令碼屬性（暫定名稱 `ADMIN_PASSWORD`），不寫在程式或 repo |
| GitHub | 原帳號開新 repo，歷史從零開始 |
| GAS 權限 | `appsscript.json` 維持 `spreadsheets.currentonly` |
| 部署 | 測試版（`.clasp.json`）與正式版（`.clasp-prod.json`）分開 |
| clasp | 3.4.1；新帳號 `clasp login --user school`，本專案每個 clasp 指令都加 `--user school`；`default` 留給舊專案 |
| 分享 | 新 GAS 專案不分享給原本的帳號 |
| 抽獎 | 老師在教師後台自訂獎項（名稱、預設圖示、說明、機率）＋「效果」欄位：無／再抽一次／自選卡片 |
| 幸運女神 | 由「自選卡片」效果取代，用欄位辨識，不靠卡名 |

## 二、尚未決定

- 「自選卡片」能不能選到「再抽一次」或「自選卡片」本身。
- 選到的卡片要直接放進背包，還是要老師確認。

## 三、從舊專案複製了什麼

- 已複製：`index.html`、`settings.html`、`lottery.html`、`board.html`、`css/`、`js/`、`icons/`、`manifest.webmanifest`、`sw.js`、`assets/.gitkeep`、`gas/Code.gs`、`gas/appsscript.json`、`.claude/launch.json`（本機預覽設定）。
- `config.js`：重新建立，`GAS_URL` 留空，等新的 GAS 部署後再填。
- `.gitignore`：以舊版為基礎，加強為「所有 csv／xlsx 都不進 repo」。
- **刻意不複製**：`.clasp.json`、`.clasp-prod.json`、舊網址、名單 csv、`test-data/`、`.git`、部署 ID、`SPEC.md`、`導師操作清單.md`。

> 注意：`gas/Code.gs` 與前端目前仍是**單班版的邏輯**（用 `ACCESS_CODE`／`DISPLAY_CODE`、靠卡名辨識「幸運女神」），之後的階段會改寫成多班級版本。

## 四、管理者初次設定（之後的階段會補完整步驟）

1. 用新的 Google 帳號建立試算表，從「擴充功能 → Apps Script」建立綁定的指令碼（`spreadsheets.currentonly` 只能用在綁定指令碼）。
2. 在本機登入新帳號：

   ```bash
   clasp login --user school
   ```

3. 在 GAS「專案設定 → 指令碼屬性」**自己手動**新增 `ADMIN_PASSWORD`，值不要告訴任何人，也不要寫進任何檔案。
4. 部署網頁應用程式前，會另外說明「執行身分」與「存取權」的組合與風險。

## 五、資安與個資提醒

- GitHub Pages 是純靜態空間，**無法保護任何密碼或金鑰**；`config.js` 只能放公開設定。
- 學生只用「班級代號＋座號」（例如 50101），不存真實姓名。
- 資料存在 Google 試算表（國外雲端服務），屬於資料委外處理，正式啟用前建議先向學校資安窗口報備。
- 保存期限：建議學期末匯出需要的紀錄後清除，畢業班於畢業後刪除該班資料。

## 六、本機預覽

```bash
python -m http.server 8765 --bind 127.0.0.1
```

然後開啟 http://127.0.0.1:8765/ 。
