/**
 * 建立「班級管理全校版｜聯絡窗口」Google 表單（只需要執行一次）。
 *
 * 這支程式和系統後端 gas/Code.gs 無關，請在 script.google.com 另外開一個「新專案」貼上執行。
 * 執行 createContactForm 後，到「執行記錄」複製印出的設定，交給 Claude 填進 config.js。
 * 印出的內容只有表單的公開網址與欄位編號，沒有任何密碼或金鑰。
 */

var FORM_TITLE = '班級管理全校版｜聯絡窗口';

// 詢問類型的選項：網頁的下拉選單必須和這裡一字不差
var TOPICS = ['申請開班', '使用問題', '建議回饋', '其他'];

// 欄位：[題目, 說明, 長度上限]；Google 收到資料時會再檢查一次長度（後端驗證）
var TEXT_FIELDS = [
  ['學校', '例如：○○國小', 40],
  ['姓名', '方便我們稱呼您即可', 20],
  ['聯絡方式', '建議填學校公務 Email 或學校電話＋分機', 80]
];

// 「想詢問的內容」：選「申請開班」時網頁不顯示這一題，所以表單設為選填，只檢查長度
var MESSAGE_TITLE = '想詢問的內容';
var MESSAGE_MAX = 500;

// 只在執行 addMessageField 時使用：在編輯器裡貼上表單的編輯網址，不要存進 Git
var FORM_EDIT_URL = '';

function addMessageItem_(form) {
  var validation = FormApp.createParagraphTextValidation()
    .setHelpText('最多 ' + MESSAGE_MAX + ' 個字')
    .requireTextLengthLessThanOrEqualTo(MESSAGE_MAX)
    .build();
  return form.addParagraphTextItem()
    .setTitle(MESSAGE_TITLE)
    .setHelpText('選「使用問題」「建議回饋」「其他」時請填寫')
    .setRequired(false)
    .setValidation(validation);
}

/**
 * 在「已經建立好」的聯絡表單加上「想詢問的內容」（只需要執行一次，重複執行不會加第二題）。
 * 先把上面的 FORM_EDIT_URL 填成表單編輯網址，再執行。
 */
function addMessageField() {
  if (!FORM_EDIT_URL) throw new Error('請先在 FORM_EDIT_URL 貼上表單的編輯網址');
  var form = FormApp.openByUrl(FORM_EDIT_URL);
  var found = form.getItems(FormApp.ItemType.PARAGRAPH_TEXT).filter(function (it) {
    return it.getTitle() === MESSAGE_TITLE;
  });
  var item = found.length ? found[0].asParagraphTextItem() : addMessageItem_(form);

  var url = form.createResponse().withItemResponse(item.createResponse('1')).toPrefilledUrl();
  var id = (url.match(/entry\.\d+/) || ['找不到'])[0];
  console.log((found.length ? '這一題已經存在，' : '已新增這一題，') + '請把下面這行複製給 Claude：');
  console.log(MESSAGE_TITLE + '：' + id);
}

function createContactForm() {
  var form = FormApp.create(FORM_TITLE);
  form.setDescription(
    '蒐集目的：回覆您的詢問與聯繫開班事宜。\n' +
    '資料只由系統管理者查看，處理完畢後於學期末刪除。'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setShowLinkToRespondAgain(false);
  form.setProgressBar(false);
  form.setConfirmationMessage('已收到您的訊息，我們會盡快與您聯繫，謝謝！');

  var items = [];
  TEXT_FIELDS.forEach(function (f) {
    var validation = FormApp.createTextValidation()
      .setHelpText('最多 ' + f[2] + ' 個字')
      .requireTextLengthLessThanOrEqualTo(f[2])
      .build();
    var item = form.addTextItem()
      .setTitle(f[0])
      .setHelpText(f[1])
      .setRequired(true)
      .setValidation(validation);
    items.push({ name: f[0], item: item, sample: '1' });
  });

  var topic = form.addListItem()
    .setTitle('詢問類型')
    .setChoiceValues(TOPICS)
    .setRequired(true);
  items.push({ name: '詢問類型', item: topic, sample: TOPICS[0] });
  items.push({ name: MESSAGE_TITLE, item: addMessageItem_(form), sample: '1' });

  // 新版 Google 表單需要「發布」後才能收回覆；舊版沒有這個方法就略過
  if (typeof form.setPublished === 'function') form.setPublished(true);
  form.setAcceptingResponses(true);

  // 用「預先填入網址」找出每一題在網頁上要用的欄位編號（entry.數字）
  var response = form.createResponse();
  items.forEach(function (x) { response.withItemResponse(x.item.createResponse(x.sample)); });
  var ids = (response.toPrefilledUrl().match(/entry\.\d+/g) || []);

  var fields = {};
  items.forEach(function (x, i) { fields[x.name] = ids[i] || '找不到'; });

  var config = {
    action: form.getPublishedUrl().replace(/\/viewform.*$/, '/formResponse'),
    fields: fields
  };

  // 以下都是公開資訊（表單網址與欄位編號），可以放心複製
  console.log('表單編輯網址（只有你能編輯）：' + form.getEditUrl());
  console.log('請把下面這段整段複製給 Claude：\n' + JSON.stringify(config, null, 2));
}
