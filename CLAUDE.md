# Class-Management-School 專案規則

全校公開版的班級管理系統。由單班版 `G:\我的雲端硬碟\Claude\Code\Class-Management` 複製而來，但兩者是**完全獨立**的專案。

> **最優先**：只要這次對話要修改程式或增加新功能，第一則回覆先提醒導師「有改 `gas/Code.gs` 就要先用測試版驗收，不可以直接推到正式版」，並確認這次會不會改到後端。

## 舊專案只能讀，不能改

- `Class-Management`（舊資料夾）只能讀取、複製，**不可以修改、不可以在裡面執行 git 或 clasp 指令**。
- 絕對不可以從舊專案複製：`.clasp.json`、`.clasp-prod.json`（指向舊 GAS 專案）、`config.js` 的網址、名單 csv、`.git`、部署 ID。

## 架構（已決定：架構 B）

- 用**新的 Google 帳號**建立一個 GAS + 試算表，全校共用、多班級。
- 試算表有「班級」表；每班有自己的**導師碼**與**班級碼**（取代舊版的 ACCESS_CODE／DISPLAY_CODE），試算表裡**只存加鹽雜湊**，不存明碼。
- **每一支 API 都要驗證班級**：先用班級代號找到班級，再比對雜湊，只能讀寫自己班級的資料列。前端驗證不算數，後端一定要再擋一次。
- 由**管理者開班**，不開放自行註冊。管理者 API 用「管理密碼」驗證。
- 管理密碼由導師**手動**填在 GAS「專案設定 → 指令碼屬性」，名稱暫定 `ADMIN_PASSWORD`。程式只讀取比對，不可以用 `Logger.log`、`console.log` 印出，也不可以向導師索取實際的值。
- 學生資料只用「班級代號＋座號」（例如 50101），不存真實姓名。

## GitHub

- 用原本的 GitHub 帳號開**新 repo**，Git 歷史從零開始。
- 不要一鍵 `git add`、`commit`、`push`；先執行 `git status` 讓導師確認要提交的檔案。

## clasp（3.4.1）與兩個帳號

- 新帳號用 `clasp login --user cheng` 登入。**本專案的每一個 clasp 指令都要加 `--user cheng`**，否則會用到 `default`（舊專案的帳號）。
- `default` 帳號留給舊專案使用，本專案不要用。
- 新的 GAS 專案**不分享**給原本的帳號。
- 測試版與正式版分開部署：
  - 測試版：`.clasp.json`，例如 `clasp --user cheng push`。
  - 正式版：`.clasp-prod.json`，例如 `clasp --user cheng -P .clasp-prod.json push`。
  - 兩個檔案都在 `.gitignore`，不可以進 Git。
- 用 curl 測 GAS 要用 `curl -sL -d '...'`，不要加 `-X POST`（轉址後會回 411）；送中文內容改用 Node。
- 測試時只用錯誤的導師碼／管理密碼（預期回 `UNAUTHORIZED`），不要向導師索取真正的值。

## 權限範圍

`gas/appsscript.json` 維持 `https://www.googleapis.com/auth/spreadsheets.currentonly`，不可以改成 `spreadsheets` 或加 drive 權限。
因此 GAS 必須是**綁定在試算表上**的指令碼（從試算表「擴充功能 → Apps Script」建立，或 `clasp create --type sheets`）。

## 抽獎卡片（取代舊版靠卡名辨識）

- 老師可在教師後台自訂獎項：名稱、圖示（從預設清單挑選，不開放自由輸入 HTML 或網址）、說明、機率。
- 新增「效果」欄位：`無`／`再抽一次`／`自選卡片`。
- 自動效果**一律看「效果」欄位**，不可以再用卡名辨識。舊版的「幸運女神」由「自選卡片」效果取代。
- 自選卡片的規則（導師已決定，沿用舊版）：
  1. 可以挑「無」與「再抽一次」效果的卡，**不能**挑「自選卡片」效果的卡（`CHOOSE_ALLOWED_EFFECTS`）。
  2. 挑到的卡直接放進背包，不需要老師另外確認。

## 網頁防護

- 老師自訂的獎項名稱、說明等文字一律用 `textContent` 顯示，不可以放進 `innerHTML`。
- 後端寫入前驗證欄位型態與長度（名稱、說明、機率範圍、效果只能是三個值之一）。

## 後端自動測試

- 改 `gas/Code.gs` 後先跑 `node --test tests/code.test.js`，全部通過才上傳到測試版。
- 新增或修改 API 時，在 `tests/code.test.js` 補上對應的測試，特別是「別班拿不到、改不到」的隔離測試。
- 每個讀寫班級資料的地方都要用 `table_(工作表, req.cid)`，不可以省略 `cid`（只有「班級」表與管理者刪除班級例外）。

## 前端快取版本號

改了任何 CSS、JS（含 `config.js`），HTML 裡的 `?v=N` 和 `sw.js` 的 `class-mgmt-vN` 要一起加大。

## 文件要跟著改

功能或流程有變動時，同步更新 `README.md`。
