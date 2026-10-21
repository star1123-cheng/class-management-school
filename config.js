/*
 * 公開設定檔（會跟著網頁一起公開，不可放導師碼、班級碼、管理密碼、Token）
 * 導師碼與班級碼只以雜湊存在 GAS 的試算表，前端由導師在設定頁輸入。
 */
window.APP_CONFIG = {
  // 正式版 GAS 網頁應用程式網址（部署「正式版 v1」，以 /exec 結尾）。
  // 測試版網址不要寫在這裡（repo 是公開的），改寫在不進 Git 的 config.local.js。
  GAS_URL: 'https://script.google.com/macros/s/AKfycbxeTzCttgwmFu3SptbCW1hwC1zYF1OF_aFGzw8VGa1owBNNz-kBMcGpWNPkODNCF_ug/exec',

  // 抽籤頁背景音樂來源："youtube"（預設）、"mp3"（assets/lottery-bgm.mp3）、"none"（只用合成音效）
  MUSIC_SOURCE: 'youtube',

  // NCS〈Invisible〉Julius Dreisig & Zeus X Crona
  YOUTUBE_VIDEO_ID: 'QglaLzo_aPk'
};

// 只在本機預覽（localhost）時載入 config.local.js，用測試版網址覆蓋 GAS_URL。
// config.local.js 已列在 .gitignore，不會進 repo；GitHub Pages 上不會載入它。
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  document.write('<script src="config.local.js"><\/script>');
}
