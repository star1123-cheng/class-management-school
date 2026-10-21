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
| clasp | 3.4.1；新帳號 `clasp login --user cheng`，本專案每個 clasp 指令都加 `--user cheng`；`default` 留給舊專案 |
| 分享 | 新 GAS 專案不分享給原本的帳號 |
| 抽獎 | 老師在教師後台自訂獎項（名稱、預設圖示、說明、機率）＋「效果」欄位：無／再抽一次／自選卡片 |
| 幸運女神 | 由「自選卡片」效果取代，用欄位辨識，不靠卡名 |
| 自選卡片 | 沿用舊版：可以挑「再抽一次」，不能挑另一張「自選卡片」；挑到的卡直接放進背包 |

## 二、尚未決定

（目前沒有）

## 三、從舊專案複製了什麼

- 底稿是複製當下舊專案資料夾裡的版本（包含舊專案當時還沒 commit 的修改）。
- 已複製：`index.html`、`settings.html`、`lottery.html`、`board.html`、`css/`、`js/`、`icons/`、`manifest.webmanifest`、`sw.js`、`assets/.gitkeep`、`gas/Code.gs`、`gas/appsscript.json`、`.claude/launch.json`（本機預覽設定）。
- `config.js`：重新建立，`GAS_URL` 留空，等新的 GAS 部署後再填。
- `.gitignore`：以舊版為基礎，加強為「所有 csv／xlsx 都不進 repo」。
- **刻意不複製**：`.clasp.json`、`.clasp-prod.json`、舊網址、名單 csv、`test-data/`、`.git`、部署 ID、`SPEC.md`、`導師操作清單.md`。

> 注意：`gas/Code.gs` 已改寫成多班級版本（階段 3），但**前端還是單班版**（沒有送 `classId`、背包還用卡名辨識），要等階段 5 改完才能搭配使用。

## 四、後端設計（階段 3，`gas/Code.gs`）

### 工作表

| 工作表 | 欄位 |
| --- | --- |
| 班級 | 班級ID、班級名稱、導師碼雜湊、班級碼雜湊、鹽、啟用、建立時間 |
| 名單 | 班級ID、座號、在籍 |
| 作業 | 班級ID、ID、日期、名稱、上投影、投影順序、建立時間、已點收 |
| 缺交 | 班級ID、作業ID、座號、狀態、更新時間 |
| 抽籤券 | 班級ID、座號、異動、原因、時間 |
| 籤池 | 班級ID、號碼、類型、實物名稱、已抽、抽出座號、抽出時間 |
| 卡片 | 班級ID、卡片ID、卡名、圖示、說明、權重、效果、啟用 |
| 抽籤紀錄 | 班級ID、請求ID、時間、座號、號碼、類型、結果名稱、結果說明、圖示 |
| 卡片背包 | 班級ID、卡片ID、座號、卡名、圖示、說明、效果、來源、取得時間、狀態、使用時間、連動ID |

### 驗證方式

- 班級 API：`{ action, classId, code, ... }`。`code` 是導師碼時為導師身分（全部功能），是班級碼時為教室電腦身分（只能用 `ping`、`getBoard`、`getLottery`、`draw`、`getBackpack`）。
- 管理 API（名稱都以 `admin` 開頭）：`{ action, adminPassword, ... }`，比對指令碼屬性 `ADMIN_PASSWORD`。
  - `adminListClasses`、`adminCreateClass`（開班，會一併建立 40 個號碼與 16 張預設卡片）、`adminSetCodes`（重設代碼）、`adminSetActive`（停用／啟用）、`adminDeleteClass`（刪除整班資料，`confirm` 要再填一次班級ID）。
- 雜湊：`SHA-256(HASH_PEPPER | 鹽 | 種類 | 代碼)`。`HASH_PEPPER` 由 `setup()` 自動產生在指令碼屬性，**不要刪除或修改**，否則所有班級都要重設代碼。
- 防猜碼：同一班（或管理密碼）10 分鐘內錯 10 次，暫停驗證 10 分鐘（回 `TOO_MANY_ATTEMPTS`）。
- 班級不存在、停用、代碼錯誤都回同一個 `UNAUTHORIZED`，不透露哪些班級存在。

### 階段 3 自行做的決定（假設，可以推翻）

1. 全校共用 9 張工作表，用「班級ID」欄區分，而不是每班一組工作表。
2. 班級ID 規則：1 到 10 個英數字或 `-`（例如 `501`）。班級名稱 1 到 20 字。
3. 導師碼、班級碼：6 到 32 個字、不可以有空白，兩組不可以相同。
4. 「機率」用**權重**儲存（0 到 100），後台顯示時換算成百分比；老師不用自己湊到 100%。
5. 卡片圖示存代號（例如 `gift`），只能從後端的 `ICONS` 清單挑；每班最多 50 張卡、卡名不可重複。
6. 抽到的卡會把卡名、圖示、說明、**效果**複製進背包；之後老師改卡片設定，不影響已經抽到的卡。
7. （已由導師決定，見第一節）「自選卡片」可挑的效果集中在 `CHOOSE_ALLOWED_EFFECTS`。
8. 所有班級共用同一把寫入鎖；同時很多班在抽籤時可能要多等一下（最多 10 秒，逾時回 `LOCKED_TIMEOUT`）。

### 本機自動測試

`tests/` 用 Node 模擬試算表執行 `gas/Code.gs`，不會連到 Google（`tests/` 不在 clasp 的 `rootDir`，不會被上傳）。

```bash
node --test tests/code.test.js
```

## 五、管理者初次設定

1. 用新的 Google 帳號建立試算表，從「擴充功能 → Apps Script」建立綁定的指令碼（`spreadsheets.currentonly` 只能用在綁定指令碼）。測試版、正式版各一份。
2. 開啟新帳號的 Apps Script API：https://script.google.com/home/usersettings
3. 在本機登入新帳號：

   ```bash
   clasp login --user cheng
   ```

4. 在 GAS「專案設定 → 指令碼屬性」**自己手動**新增 `ADMIN_PASSWORD`，值不要告訴任何人，也不要寫進任何檔案。
5. 上傳程式後，在 Apps Script 編輯器選 `setup` 執行一次（第一次會要求授權，只有「查看及管理這份試算表」）。
6. 部署網頁應用程式前，會另外說明「執行身分」與「存取權」的組合與風險。

## 六、資安與個資提醒

- GitHub Pages 是純靜態空間，**無法保護任何密碼或金鑰**；`config.js` 只能放公開設定。
- 學生只用「班級代號＋座號」（例如 50101），不存真實姓名。
- 資料存在 Google 試算表（國外雲端服務），屬於資料委外處理，正式啟用前建議先向學校資安窗口報備。
- 保存期限：建議學期末匯出需要的紀錄後清除，畢業班於畢業後刪除該班資料。

## 七、本機預覽

```bash
python -m http.server 8765 --bind 127.0.0.1
```

然後開啟 http://127.0.0.1:8765/ 。
