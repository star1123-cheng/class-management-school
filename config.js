/*
 * 公開設定檔（會跟著網頁一起公開，不可放導師碼、班級碼、管理密碼、Token）
 * 導師碼與班級碼只以雜湊存在 GAS 的試算表，前端由導師在設定頁輸入。
 */
window.APP_CONFIG = {
  // 部署 GAS 網頁應用程式後，把網址（以 /exec 結尾）貼在這裡。
  // 全校版的新 GAS 專案尚未部署，先留空。
  GAS_URL: '',

  // 抽籤頁背景音樂來源："youtube"（預設）、"mp3"（assets/lottery-bgm.mp3）、"none"（只用合成音效）
  MUSIC_SOURCE: 'youtube',

  // NCS〈Invisible〉Julius Dreisig & Zeus X Crona
  YOUTUBE_VIDEO_ID: 'QglaLzo_aPk'
};
