/**
 * 班級作業缺交系統與雲端一番賞（全校版）：後端（Google Apps Script）
 *
 * 全校共用一份試算表、多個班級。每一張資料工作表都有「班級ID」欄，
 * 每支 API 先驗證班級，之後只讀寫自己班級的資料列。
 *
 * 使用前：
 * 1. 到「專案設定 → 指令碼屬性」新增 ADMIN_PASSWORD（管理密碼，值由管理者自訂，不要寫在程式裡）。
 * 2. 執行 setup() 建立工作表（會自動產生 HASH_PEPPER，不要刪除或修改它）。
 * 3. 部署為網頁應用程式，再用管理者 API 開班（設定每班的導師碼與班級碼）。
 *
 * 所有 API 一律用 POST，body 為 JSON 字串：
 *   班級 API：{ action, classId, code, ...參數 }（code 是導師碼或班級碼）
 *   管理 API：{ action: 'admin...', adminPassword, ...參數 }
 * 回應：成功 { ok: true, data }；失敗 { ok: false, error: "代碼" }
 */

var SHEET = {
  CLASSES: '班級',
  ROSTER: '名單',
  ASSIGN: '作業',
  MISSING: '缺交',
  TICKETS: '抽籤券',
  POOL: '籤池',
  CARDS: '卡片',
  DRAWS: '抽籤紀錄',
  BAG: '卡片背包'
};

var HEADERS = {};
HEADERS[SHEET.CLASSES] = ['班級ID', '班級名稱', '導師碼雜湊', '班級碼雜湊', '鹽', '啟用', '建立時間'];
HEADERS[SHEET.ROSTER] = ['班級ID', '座號', '在籍'];
HEADERS[SHEET.ASSIGN] = ['班級ID', 'ID', '日期', '名稱', '上投影', '投影順序', '建立時間', '已點收'];
HEADERS[SHEET.MISSING] = ['班級ID', '作業ID', '座號', '狀態', '更新時間'];
HEADERS[SHEET.TICKETS] = ['班級ID', '座號', '異動', '原因', '時間'];
HEADERS[SHEET.POOL] = ['班級ID', '號碼', '類型', '實物名稱', '已抽', '抽出座號', '抽出時間'];
HEADERS[SHEET.CARDS] = ['班級ID', '卡片ID', '卡名', '圖示', '說明', '權重', '效果', '啟用'];
HEADERS[SHEET.DRAWS] = ['班級ID', '請求ID', '時間', '座號', '號碼', '類型', '結果名稱', '結果說明', '圖示'];
HEADERS[SHEET.BAG] = ['班級ID', '卡片ID', '座號', '卡名', '圖示', '說明', '效果', '來源', '取得時間', '狀態', '使用時間', '連動ID'];

// 每班的資料都放在這些工作表（刪除班級時會一起清掉）
var CLASS_SHEETS = [SHEET.ROSTER, SHEET.ASSIGN, SHEET.MISSING, SHEET.TICKETS, SHEET.POOL, SHEET.CARDS, SHEET.DRAWS, SHEET.BAG];

// 後來才加入的欄位：試算表缺少時自動補在最右邊，既有資料列填入預設值（例：ADDED_COLUMNS[SHEET.ASSIGN] = { '新欄位': '預設值' }）
var ADDED_COLUMNS = {};

// 這些欄位設為「純文字」格式，避免試算表自動把代號、日期、時間字串轉成數字或日期物件
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.CLASSES] = ['班級ID', '班級名稱', '導師碼雜湊', '班級碼雜湊', '鹽', '建立時間'];
TEXT_COLUMNS[SHEET.ROSTER] = ['班級ID'];
TEXT_COLUMNS[SHEET.ASSIGN] = ['班級ID', 'ID', '日期', '名稱', '建立時間'];
TEXT_COLUMNS[SHEET.MISSING] = ['班級ID', '作業ID', '更新時間'];
TEXT_COLUMNS[SHEET.TICKETS] = ['班級ID', '時間'];
TEXT_COLUMNS[SHEET.POOL] = ['班級ID', '實物名稱', '抽出時間'];
TEXT_COLUMNS[SHEET.CARDS] = ['班級ID', '卡片ID', '卡名', '圖示', '說明'];
TEXT_COLUMNS[SHEET.DRAWS] = ['班級ID', '請求ID', '時間'];
TEXT_COLUMNS[SHEET.BAG] = ['班級ID', '卡片ID', '卡名', '圖示', '說明', '取得時間', '使用時間', '連動ID'];

var POOL_SIZE = 40;
var PRIZE_NUMBERS = [7, 13, 20, 21, 34];
var PRIZE_NAME = '小文具小玩具';
var MAX_BOARD = 5;
var MAX_CARDS = 50;
var LOCK_WAIT_MS = 10000;

// 導師碼、班級碼的長度限制
var CODE_MIN = 6;
var CODE_MAX = 32;

// 防止猜碼：同一個班級（或管理密碼）在 FAIL_WINDOW_S 秒內錯 MAX_FAILS 次，就暫停驗證
var MAX_FAILS = 10;
var FAIL_WINDOW_S = 600;

// 卡片效果：自動效果一律看「效果」欄位，不看卡名
var EFFECT_NONE = '無';
var EFFECT_REDRAW = '再抽一次';   // 使用後自動送 1 張抽籤券
var EFFECT_CHOOSE = '自選卡片';   // 使用時挑一張卡放進背包（取代舊版的「幸運女神」）
var EFFECTS = [EFFECT_NONE, EFFECT_REDRAW, EFFECT_CHOOSE];

// 自選卡片可以挑的效果（導師決定沿用舊版）：可以挑「再抽一次」，不能挑「自選卡片」，避免無限循環。
// 挑到的卡直接放進背包，不另外確認（「使用卡片」本來就只有導師碼能操作）。
var CHOOSE_ALLOWED_EFFECTS = [EFFECT_NONE, EFFECT_REDRAW];

// 卡片圖示只能從這份清單挑選（存代號，前端用代號對照圖示）
var ICONS = {
  sparkle: '✦', headphones: '🎧', clapper: '🎬', handshake: '🤝', moneybag: '💰', cool: '😎',
  notebook: '📒', medal: '🏅', teacher: '🧑‍🏫', broom: '🧹', clover: '🍀', memo: '📝',
  gem: '💎', redo: '🔄', picnic: '🧺', cloud: '☁️', glow: '🌟', gift: '🎁',
  trophy: '🏆', music: '🎵', books: '📚', pencil: '✏️', candy: '🍬', ticket: '🎟️',
  crown: '👑', rocket: '🚀', game: '🎮', ball: '⚽'
};
var DEFAULT_ICON = 'sparkle';

// 卡片背包的狀態
var BAG_UNUSED = '未使用';
var BAG_USED = '已使用';
var BAG_REVOKED = '已收回';    // 自選卡片被復原時，挑到的那張卡改成這個狀態
var BAG_RECYCLED = '已回收';   // 學生拿去回收換券的卡（同一次回收的卡，連動ID 相同）

// 回收換券：幾張未使用的卡換 1 張抽籤券
var RECYCLE_COUNT = 3;
var RECYCLE_REASON = '回收卡片';

// 開班時預設的卡片：[卡名, 圖示, 說明, 權重, 效果]
var DEFAULT_CARDS = [
  ['我是DJ', 'headphones', '下課或用餐時間可以點 1 首歌。', 1.5, EFFECT_NONE],
  ['導演', 'clapper', '用餐時間可以選一部影片。', 1.5, EFFECT_NONE],
  ['神隊友', 'handshake', '考試遇到困難時，可以請求幫助。（限平時考、一題）', 1, EFFECT_NONE],
  ['財神爺', 'moneybag', '使用後下一次點數 x2。', 1, EFFECT_NONE],
  ['免當值日生', 'cool', '把值日生的任務交給下一個人。', 1, EFFECT_NONE],
  ['聯絡簿代抄', 'notebook', '老師幫忙寫聯絡簿。', 1, EFFECT_NONE],
  ['免死金牌', 'medal', '可免除 1 次任何處罰。（嚴重者除外）', 1, EFFECT_NONE],
  ['老師來幫忙', 'teacher', '平時考時老師幫你檢查選擇題答案。', 1, EFFECT_NONE],
  ['掃地Pass', 'broom', '今天不用做掃地工作。', 1, EFFECT_NONE],
  ['幸運女神', 'clover', '從全部兌換券選一張。', 1, EFFECT_CHOOSE],
  ['作業-1', 'memo', '不用寫一項作業。（習作、作文除外）', 1, EFFECT_NONE],
  ['點數卡', 'gem', '抽卡完的點數直接加 5 點。', 1, EFFECT_NONE],
  ['再抽一次', 'redo', '不滿意的卡可以再抽一次。（可當次或下次使用）', 1, EFFECT_REDRAW],
  ['野餐卡', 'picnic', '用餐時間可和好朋友一起吃飯。', 1, EFFECT_NONE],
  ['白日夢卡', 'cloud', '可以挑一本書閱讀，不用睡午覺。', 1, EFFECT_NONE],
  ['榮譽之星', 'glow', '獲得學校的榮譽卡一張。', 1, EFFECT_NONE]
];

/* ============================================================
 * 初始化
 * ============================================================ */

/**
 * 建立 9 張工作表與標題列，並產生雜湊用的 HASH_PEPPER。已存在的工作表不會被覆蓋。
 * 不會建立任何班級；開班請用管理者 API。
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASSWORD')) {
    throw new Error('尚未設定管理密碼：請先到「專案設定（齒輪圖示）→ 指令碼屬性」新增屬性「ADMIN_PASSWORD」，值由管理者自行決定，儲存後再重新執行 setup()。');
  }
  var ss = ss_();
  var report = [];
  Object.keys(HEADERS).forEach(function (name) {
    if (ss.getSheetByName(name)) {
      report.push('已存在，略過：' + name);
    } else {
      createSheet_(ss, name);
      report.push('已建立：' + name);
    }
  });
  report.push(getPepper_(true) ? '已產生 HASH_PEPPER' : 'HASH_PEPPER 已存在，保留原值');
  console.log(report.join('\n'));
  return report.join('\n');
}

/* ============================================================
 * 進入點
 * ============================================================ */

function doGet() {
  return ContentService.createTextOutput('此網址僅供班級系統 API 使用。').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e && e.postData ? e.postData.contents : '');
  } catch (err) {
    return out_(fail_('INVALID_INPUT'));
  }
  if (!req || typeof req !== 'object' || Array.isArray(req)) return out_(fail_('INVALID_INPUT'));
  return out_(handle_(req));
}

/** 驗證身分後分派到各 API；回傳 { ok, data } 或 { ok:false, error } */
function handle_(req) {
  var action = typeof req.action === 'string' ? req.action : '';
  var handler;

  if (ADMIN_ACTIONS.hasOwnProperty(action)) {
    // 管理 API：一律先驗證管理密碼
    var adminErr = authAdmin_(req.adminPassword);
    if (adminErr) return fail_(adminErr);
    handler = ADMIN_ACTIONS[action];
  } else {
    // 班級 API：一律先驗證班級與代碼，失敗時不回傳任何資料
    var auth = authClass_(req.classId, req.code);
    if (auth.error) return fail_(auth.error);
    handler = ACTIONS.hasOwnProperty(action) ? ACTIONS[action] : null;
    if (typeof handler !== 'function') return fail_('INVALID_INPUT');
    // 班級碼只能使用投影與抽籤需要的功能，其餘一律拒絕
    if (auth.role !== 'teacher' && DISPLAY_ACTIONS.indexOf(action) === -1) return fail_('FORBIDDEN');
    req.role = auth.role;
    req.cid = auth.classId;
    req.className = auth.className;
  }

  try {
    return ok_(handler(req));
  } catch (err) {
    if (err && err.apiCode) return fail_(err.apiCode);
    console.error('API 發生錯誤（' + action + '）：' + (err && err.stack ? err.stack : err));
    return fail_('SERVER_ERROR');
  }
}

// 班級碼可以呼叫的 API
var DISPLAY_ACTIONS = ['ping', 'getBoard', 'getLottery', 'draw', 'getBackpack'];

var ACTIONS = {
  ping: function (req) { return { serverTime: nowIso_(), role: req.role, classId: req.cid, className: req.className }; },
  getState: getState_,
  getBoard: getBoard_,
  importRoster: importRoster_,
  setRosterActive: setRosterActive_,
  createAssignment: createAssignment_,
  updateAssignment: updateAssignment_,
  deleteAssignment: deleteAssignment_,
  saveMissing: saveMissing_,
  setBoard: setBoard_,
  reorderBoard: reorderBoard_,
  getLottery: getLottery_,
  grantTickets: grantTickets_,
  draw: draw_,
  resetPool: resetPool_,
  getCards: getCards_,
  saveCard: saveCard_,
  deleteCard: deleteCard_,
  getBackpack: getBackpack_,
  useCard: useCard_,
  undoUseCard: undoUseCard_,
  recycleCards: recycleCards_,
  undoRecycle: undoRecycle_,
  clearUsedCards: clearUsedCards_
};

var ADMIN_ACTIONS = {
  adminPing: function () { return { serverTime: nowIso_(), role: 'admin' }; },
  adminListClasses: adminListClasses_,
  adminCreateClass: adminCreateClass_,
  adminSetCodes: adminSetCodes_,
  adminSetActive: adminSetActive_,
  adminDeleteClass: adminDeleteClass_
};

/* ============================================================
 * 驗證
 * ============================================================ */

/** 驗證班級代碼；成功回傳 { classId, className, role }，失敗回傳 { error } */
function authClass_(classId, code) {
  if (typeof classId !== 'string' || !/^[0-9A-Za-z-]{1,10}$/.test(classId.trim())) return { error: 'UNAUTHORIZED' };
  var cid = classId.trim();
  var failKey = 'fail:class:' + cid;
  if (tooManyFails_(failKey)) return { error: 'TOO_MANY_ATTEMPTS' };

  var row = typeof code === 'string' && code.length > 0 ? findClass_(cid) : null;
  var role = null;
  if (row && yes_(row['啟用'])) {
    var salt = String(row['鹽']);
    if (checkCode_(hashCode_(salt, 'teacher', code), String(row['導師碼雜湊']))) role = 'teacher';
    else if (checkCode_(hashCode_(salt, 'display', code), String(row['班級碼雜湊']))) role = 'display';
  }
  // 班級不存在、停用或代碼錯誤都回同一個錯誤，不透露哪個班級存在
  if (!role) {
    noteFail_(failKey);
    return { error: 'UNAUTHORIZED' };
  }
  clearFails_(failKey);
  return { classId: cid, className: String(row['班級名稱'] || ''), role: role };
}

/** 驗證管理密碼；成功回傳 null，失敗回傳錯誤代碼 */
function authAdmin_(password) {
  var failKey = 'fail:admin';
  if (tooManyFails_(failKey)) return 'TOO_MANY_ATTEMPTS';
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!checkCode_(password, expected)) {
    noteFail_(failKey);
    return 'UNAUTHORIZED';
  }
  clearFails_(failKey);
  return null;
}

function tooManyFails_(key) {
  return Number(CacheService.getScriptCache().get(key) || 0) >= MAX_FAILS;
}

function noteFail_(key) {
  var cache = CacheService.getScriptCache();
  cache.put(key, String(Number(cache.get(key) || 0) + 1), FAIL_WINDOW_S);
}

function clearFails_(key) {
  CacheService.getScriptCache().remove(key);
}

/**
 * 雜湊 = SHA-256(HASH_PEPPER | 鹽 | 種類 | 代碼)。
 * HASH_PEPPER 只存在指令碼屬性，試算表外流時也無法直接比對代碼。
 */
function hashCode_(salt, kind, code) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    getPepper_(false) + '|' + salt + '|' + kind + '|' + code,
    Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** 讀取 HASH_PEPPER；沒有時自動產生。create 為 true 時回傳這次是否新產生 */
function getPepper_(create) {
  var props = PropertiesService.getScriptProperties();
  var pepper = props.getProperty('HASH_PEPPER');
  if (pepper) return create ? false : pepper;
  pepper = Utilities.getUuid() + Utilities.getUuid();
  props.setProperty('HASH_PEPPER', pepper);
  return create ? true : pepper;
}

function findClass_(cid) {
  return find_(table_(SHEET.CLASSES).rows, function (r) { return String(r['班級ID']).trim() === cid; });
}

/* ============================================================
 * 管理者：開班與班級設定
 * ============================================================ */

function adminListClasses_() {
  return {
    classes: table_(SHEET.CLASSES).rows.map(function (r) {
      // 不回傳雜湊與鹽
      return {
        classId: String(r['班級ID']).trim(),
        name: String(r['班級名稱'] || ''),
        active: yes_(r['啟用']),
        createdAt: String(r['建立時間'] || '')
      };
    }).filter(function (c) { return c.classId; })
  };
}

/** 開班：建立班級、籤池 40 個號碼與預設卡片 */
function adminCreateClass_(req) {
  var cid = cleanClassId_(req.classId);
  var name = cleanText_(req.name, 1, 20);
  var teacherCode = cleanCode_(req.teacherCode);
  var classCode = cleanCode_(req.classCode);
  if (teacherCode === classCode) throw apiError_('SAME_CODE');

  return withLock_(function () {
    if (findClass_(cid)) throw apiError_('ALREADY_EXISTS');
    var salt = Utilities.getUuid();
    var now = nowIso_();
    appendRows_(table_(SHEET.CLASSES), [{
      '班級ID': cid, '班級名稱': name,
      '導師碼雜湊': hashCode_(salt, 'teacher', teacherCode),
      '班級碼雜湊': hashCode_(salt, 'display', classCode),
      '鹽': salt, '啟用': '是', '建立時間': now
    }]);

    var poolRows = [];
    for (var n = 1; n <= POOL_SIZE; n++) {
      var isPrize = PRIZE_NUMBERS.indexOf(n) !== -1;
      poolRows.push({ '號碼': n, '類型': isPrize ? '實物' : '抽卡', '實物名稱': isPrize ? PRIZE_NAME : '', '已抽': '否' });
    }
    appendRows_(table_(SHEET.POOL, cid), poolRows);

    appendRows_(table_(SHEET.CARDS, cid), DEFAULT_CARDS.map(function (c) {
      return { '卡片ID': 'C' + newId_(), '卡名': c[0], '圖示': c[1], '說明': c[2], '權重': c[3], '效果': c[4], '啟用': '是' };
    }));

    return { classId: cid, name: name, active: true, createdAt: now };
  });
}

/** 重設導師碼或班級碼（至少給一個）；新代碼不可和另一組相同 */
function adminSetCodes_(req) {
  var cid = cleanClassId_(req.classId);
  var hasTeacher = req.teacherCode !== undefined && req.teacherCode !== null && req.teacherCode !== '';
  var hasClass = req.classCode !== undefined && req.classCode !== null && req.classCode !== '';
  if (!hasTeacher && !hasClass) throw apiError_('INVALID_INPUT');
  var teacherCode = hasTeacher ? cleanCode_(req.teacherCode) : null;
  var classCode = hasClass ? cleanCode_(req.classCode) : null;
  if (hasTeacher && hasClass && teacherCode === classCode) throw apiError_('SAME_CODE');

  return withLock_(function () {
    var t = table_(SHEET.CLASSES);
    var row = find_(t.rows, function (r) { return String(r['班級ID']).trim() === cid; });
    if (!row) throw apiError_('NOT_FOUND');
    var salt = String(row['鹽']);
    // 只改其中一組時，和沒改的那一組比對，避免兩組變成相同
    if (hasTeacher && !hasClass && checkCode_(hashCode_(salt, 'display', teacherCode), String(row['班級碼雜湊']))) throw apiError_('SAME_CODE');
    if (hasClass && !hasTeacher && checkCode_(hashCode_(salt, 'teacher', classCode), String(row['導師碼雜湊']))) throw apiError_('SAME_CODE');
    var fields = {};
    if (hasTeacher) fields['導師碼雜湊'] = hashCode_(salt, 'teacher', teacherCode);
    if (hasClass) fields['班級碼雜湊'] = hashCode_(salt, 'display', classCode);
    setFields_(t, row._row, fields);
    clearFails_('fail:class:' + cid);
    return { classId: cid, teacherCode: hasTeacher, classCode: hasClass };
  });
}

function adminSetActive_(req) {
  var cid = cleanClassId_(req.classId);
  if (typeof req.active !== 'boolean') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.CLASSES);
    var row = find_(t.rows, function (r) { return String(r['班級ID']).trim() === cid; });
    if (!row) throw apiError_('NOT_FOUND');
    setFields_(t, row._row, { '啟用': req.active ? '是' : '否' });
    return { classId: cid, active: req.active };
  });
}

/**
 * 刪除班級與它的全部資料（學期末、畢業後清除用）。
 * confirm 必須再輸入一次班級ID，避免按錯。
 */
function adminDeleteClass_(req) {
  var cid = cleanClassId_(req.classId);
  if (req.confirm !== cid) throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var classes = table_(SHEET.CLASSES);
    if (!find_(classes.rows, function (r) { return String(r['班級ID']).trim() === cid; })) throw apiError_('NOT_FOUND');
    var removed = {};
    CLASS_SHEETS.forEach(function (name) { removed[name] = removeClassRows_(name, cid); });
    removeClassRows_(SHEET.CLASSES, cid);
    return { classId: cid, removed: removed };
  });
}

/** 一次重寫工作表，移除某班的全部資料列（比逐列刪除快很多）；回傳刪除列數 */
function removeClassRows_(name, cid) {
  var t = table_(name);
  var lastRow = t.sheet.getLastRow();
  if (lastRow < 2) return 0;
  var range = t.sheet.getRange(2, 1, lastRow - 1, t.width);
  var col = t.idx['班級ID'];
  var values = range.getValues();
  var keep = values.filter(function (v) { return String(v[col]).trim() !== cid; });
  if (keep.length === values.length) return 0;
  range.clearContent();
  if (keep.length) t.sheet.getRange(2, 1, keep.length, t.width).setValues(keep);
  return values.length - keep.length;
}

/* ============================================================
 * 作業缺交
 * ============================================================ */

function getState_(req) {
  var cid = req.cid;
  var missing = table_(SHEET.MISSING, cid).rows.map(function (r) {
    return {
      assignmentId: String(r['作業ID']),
      seat: toInt_(r['座號']),
      status: String(r['狀態']).trim(),
      updatedAt: String(r['更新時間'])
    };
  }).filter(function (m) { return m.seat !== null && (m.status === '缺交' || m.status === '已補交'); });

  return {
    classId: cid,
    className: req.className,
    roster: readRoster_(cid),
    assignments: readAssignments_(table_(SHEET.ASSIGN, cid)).map(assignOut_),
    missing: missing,
    serverTime: nowIso_()
  };
}

function getBoard_(req) {
  var cid = req.cid;
  var active = {};
  readRoster_(cid).forEach(function (r) { if (r.active) active[r.seat] = true; });

  var items = readAssignments_(table_(SHEET.ASSIGN, cid))
    .filter(function (a) { return a.onBoard; })
    .sort(byOrder_)
    .slice(0, MAX_BOARD);

  var bySeat = {};
  table_(SHEET.MISSING, cid).rows.forEach(function (r) {
    var seat = toInt_(r['座號']);
    if (seat === null || !active[seat] || String(r['狀態']).trim() !== '缺交') return;
    var id = String(r['作業ID']);
    (bySeat[id] = bySeat[id] || {})[seat] = true;
  });

  return {
    className: req.className,
    items: items.map(function (a) {
      var seats = Object.keys(bySeat[a.id] || {}).map(Number).sort(function (x, y) { return x - y; });
      return { id: a.id, name: a.name, date: a.date, order: a.order, recorded: a.recorded, missing: seats };
    }),
    activeCount: Object.keys(active).length,
    serverTime: nowIso_()
  };
}

/**
 * 匯入名單：只接受座號（classCode 為舊版欄位，可省略；有填時必須等於目前班級）。
 * 任何其他欄位（例如姓名）一律拒絕。
 */
function importRoster_(req) {
  var cid = req.cid;
  if (req.mode !== 'replace' && req.mode !== 'append') throw apiError_('INVALID_INPUT');
  if (!Array.isArray(req.rows) || req.rows.length === 0 || req.rows.length > 99) throw apiError_('INVALID_INPUT');

  var seen = {};
  var clean = req.rows.map(function (r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw apiError_('INVALID_INPUT');
    Object.keys(r).forEach(function (k) {
      if (k !== 'seat' && k !== 'classCode') throw apiError_('INVALID_INPUT');
    });
    var seat = toSeat_(r.seat);
    if (seat === null || seen[seat]) throw apiError_('INVALID_INPUT');
    seen[seat] = true;
    var cc = r.classCode === undefined || r.classCode === null ? '' : String(r.classCode).trim();
    if (cc !== '' && cc !== cid) throw apiError_('INVALID_INPUT');
    return seat;
  });

  return withLock_(function () {
    var t = table_(SHEET.ROSTER, cid);
    var existing = {};
    t.rows.forEach(function (r) {
      var s = toInt_(r['座號']);
      if (s !== null && !existing[s]) existing[s] = r;
    });
    var incoming = {};
    clean.forEach(function (s) { incoming[s] = true; });

    var activated = 0, deactivated = 0;
    if (req.mode === 'replace') {
      Object.keys(existing).forEach(function (s) {
        var row = existing[s];
        if (incoming[s]) {
          if (row['在籍'] !== '是') { setFields_(t, row._row, { '在籍': '是' }); activated++; }
        } else if (row['在籍'] !== '否') {
          setFields_(t, row._row, { '在籍': '否' });
          deactivated++;
        }
      });
    }
    var toAdd = clean.filter(function (s) { return !existing[s]; }).map(function (s) {
      return { '座號': s, '在籍': '是' };
    });
    appendRows_(t, toAdd);

    return { roster: readRoster_(cid), added: toAdd.length, activated: activated, deactivated: deactivated };
  });
}

function setRosterActive_(req) {
  var seat = toSeat_(req.seat);
  if (seat === null || typeof req.active !== 'boolean') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.ROSTER, req.cid);
    var row = find_(t.rows, function (r) { return toInt_(r['座號']) === seat; });
    if (!row) throw apiError_('NOT_FOUND');
    setFields_(t, row._row, { '在籍': req.active ? '是' : '否' });
    return { seat: seat, active: req.active };
  });
}

function createAssignment_(req) {
  var name = cleanName_(req.name);
  var date = req.date === undefined || req.date === '' ? todayStr_() : cleanDate_(req.date);
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN, req.cid);
    var onBoard = readAssignments_(t).filter(function (a) { return a.onBoard; }).length;
    var canBoard = onBoard < MAX_BOARD;
    var obj = {
      'ID': newId_(),
      '日期': date,
      '名稱': name,
      '上投影': canBoard ? '是' : '否',
      '投影順序': canBoard ? onBoard + 1 : '',
      '建立時間': nowIso_(),
      '已點收': '否'
    };
    appendRows_(t, [obj]);
    return assignOut_(objToAssign_(obj));
  });
}

function updateAssignment_(req) {
  var id = cleanId_(req.id);
  var name = cleanName_(req.name);
  var date = cleanDate_(req.date);
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN, req.cid);
    var row = find_(t.rows, function (r) { return String(r['ID']) === id; });
    if (!row) throw apiError_('NOT_FOUND');
    setFields_(t, row._row, { '名稱': name, '日期': date });
    return { id: id, name: name, date: date };
  });
}

function deleteAssignment_(req) {
  var id = cleanId_(req.id);
  var cid = req.cid;
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN, cid);
    var row = find_(t.rows, function (r) { return String(r['ID']) === id; });
    if (!row) throw apiError_('NOT_FOUND');
    t.sheet.deleteRow(row._row);

    var m = table_(SHEET.MISSING, cid);
    var rowsToDelete = m.rows.filter(function (r) { return String(r['作業ID']) === id; })
      .map(function (r) { return r._row; })
      .sort(function (a, b) { return b - a; });
    rowsToDelete.forEach(function (n) { m.sheet.deleteRow(n); });

    renumberBoard_(cid);
    return { id: id, deletedMissing: rowsToDelete.length };
  });
}

function saveMissing_(req) {
  var id = cleanId_(req.assignmentId);
  var cid = req.cid;
  if (!Array.isArray(req.changes) || req.changes.length === 0 || req.changes.length > 99) throw apiError_('INVALID_INPUT');
  // markRecorded：第一次點收完成（沒點到的已一併送成「缺交」），把作業標為已點收
  if (req.markRecorded !== undefined && typeof req.markRecorded !== 'boolean') throw apiError_('INVALID_INPUT');
  var seen = {};
  var changes = req.changes.map(function (c) {
    if (!c || typeof c !== 'object') throw apiError_('INVALID_INPUT');
    var seat = toSeat_(c.seat);
    if (seat === null || seen[seat]) throw apiError_('INVALID_INPUT');
    if (['缺交', '已補交', '正常'].indexOf(c.status) === -1) throw apiError_('INVALID_INPUT');
    seen[seat] = true;
    return { seat: seat, status: c.status };
  });

  return withLock_(function () {
    var a = table_(SHEET.ASSIGN, cid);
    var assignRow = find_(a.rows, function (r) { return String(r['ID']) === id; });
    if (!assignRow) throw apiError_('NOT_FOUND');
    if (req.markRecorded && !yes_(assignRow['已點收'])) setFields_(a, assignRow._row, { '已點收': '是' });

    var t = table_(SHEET.MISSING, cid);
    var bySeat = {};
    t.rows.forEach(function (r) {
      if (String(r['作業ID']) !== id) return;
      var s = toInt_(r['座號']);
      if (s !== null && !bySeat[s]) bySeat[s] = r;
    });

    var now = nowIso_();
    var toAppend = [];
    var toDelete = [];
    changes.forEach(function (c) {
      var row = bySeat[c.seat];
      if (c.status === '正常') {
        if (row) toDelete.push(row._row);
      } else if (row) {
        if (String(row['狀態']).trim() !== c.status) setFields_(t, row._row, { '狀態': c.status, '更新時間': now });
      } else {
        toAppend.push({ '作業ID': id, '座號': c.seat, '狀態': c.status, '更新時間': now });
      }
    });
    appendRows_(t, toAppend);
    toDelete.sort(function (x, y) { return y - x; }).forEach(function (n) { t.sheet.deleteRow(n); });
    return { saved: changes.length };
  });
}

function setBoard_(req) {
  var id = cleanId_(req.assignmentId);
  if (typeof req.on !== 'boolean') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN, req.cid);
    var list = readAssignments_(t);
    var target = find_(list, function (x) { return x.id === id; });
    if (!target) throw apiError_('NOT_FOUND');
    if (req.on) {
      if (target.onBoard) return { id: id, on: true };
      var count = list.filter(function (x) { return x.onBoard; }).length;
      if (count >= MAX_BOARD) throw apiError_('BOARD_FULL');
      setFields_(t, target._row, { '上投影': '是', '投影順序': count + 1 });
    } else {
      setFields_(t, target._row, { '上投影': '否', '投影順序': '' });
      renumberBoard_(req.cid);
    }
    return { id: id, on: req.on };
  });
}

function reorderBoard_(req) {
  if (!Array.isArray(req.ids) || req.ids.length === 0 || req.ids.length > MAX_BOARD) throw apiError_('INVALID_INPUT');
  var ids = req.ids.map(cleanId_);
  var uniq = {};
  ids.forEach(function (id) {
    if (uniq[id]) throw apiError_('INVALID_INPUT');
    uniq[id] = true;
  });
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN, req.cid);
    var board = readAssignments_(t).filter(function (a) { return a.onBoard; }).sort(byOrder_);
    var map = {};
    board.forEach(function (a) { map[a.id] = a; });
    ids.forEach(function (id) { if (!map[id]) throw apiError_('INVALID_INPUT'); });
    var ordered = ids.map(function (id) { return map[id]; })
      .concat(board.filter(function (a) { return !uniq[a.id]; }));
    ordered.forEach(function (a, i) {
      if (a.order !== i + 1) setFields_(t, a._row, { '投影順序': i + 1 });
    });
    return { ids: ordered.map(function (a) { return a.id; }) };
  });
}

/** 把投影順序重新整理成 1、2、3…，不留空號 */
function renumberBoard_(cid) {
  var t = table_(SHEET.ASSIGN, cid);
  readAssignments_(t).filter(function (a) { return a.onBoard; }).sort(byOrder_).forEach(function (a, i) {
    if (a.order !== i + 1) setFields_(t, a._row, { '投影順序': i + 1 });
  });
}

/* ============================================================
 * 一番賞
 * ============================================================ */

function getLottery_(req) {
  var cid = req.cid;
  var limit = toInt_(req.limit);
  if (limit === null || limit < 1) limit = 10;
  if (limit > 50) limit = 50;

  var pool = readPool_(cid);
  var seats = readRoster_(cid).filter(function (r) { return r.active; }).map(function (r) { return r.seat; });
  var balances = balances_(cid);
  var out = {};
  seats.forEach(function (s) { out[s] = balances[s] || 0; });

  var recent = table_(SHEET.DRAWS, cid).rows.slice(-limit).reverse().map(function (r) {
    return {
      time: String(r['時間']),
      seat: toInt_(r['座號']),
      number: toInt_(r['號碼']),
      type: String(r['類型']),
      name: String(r['結果名稱']),
      icon: String(r['圖示'] || '')
    };
  });

  var drawnCount = pool.filter(function (p) { return p.drawn; }).length;
  return {
    className: req.className,
    // 籤池只回傳是否已抽，不回傳類型與獎品內容
    pool: pool.map(function (p) { return { number: p.number, drawn: p.drawn }; }),
    seats: seats,
    balances: out,
    bagCounts: bagCounts_(cid),
    recent: recent,
    drawnCount: drawnCount,
    remainingCount: pool.length - drawnCount,
    total: pool.length,
    serverTime: nowIso_()
  };
}

function grantTickets_(req) {
  var cid = req.cid;
  var seat = toSeat_(req.seat);
  var amount = toInt_(req.amount);
  var reason = req.reason;
  if (seat === null || amount === null || amount === 0 || Math.abs(amount) > 50) throw apiError_('INVALID_INPUT');
  if (reason !== '發放' && reason !== '更正') throw apiError_('INVALID_INPUT');
  if (reason === '發放' && amount < 0) throw apiError_('INVALID_INPUT');

  return withLock_(function () {
    if (!isActiveSeat_(cid, seat)) throw apiError_('NOT_FOUND');
    var balance = balances_(cid)[seat] || 0;
    if (balance + amount < 0) throw apiError_('INVALID_INPUT');
    appendRows_(table_(SHEET.TICKETS, cid), [{ '座號': seat, '異動': amount, '原因': reason, '時間': nowIso_() }]);
    return { seat: seat, balance: balance + amount };
  });
}

function draw_(req) {
  var cid = req.cid;
  var seat = toSeat_(req.seat);
  var requestId = typeof req.requestId === 'string' ? req.requestId : '';
  if (seat === null || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw apiError_('INVALID_INPUT');

  return withLock_(function () {
    // 1. 同一班相同 requestId 已處理過：直接回傳上次結果，不重複扣券
    var draws = table_(SHEET.DRAWS, cid);
    var prev = find_(draws.rows, function (r) { return String(r['請求ID']) === requestId; });
    if (prev) {
      var prevSeat = toInt_(prev['座號']);
      return {
        number: toInt_(prev['號碼']),
        type: String(prev['類型']),
        name: String(prev['結果名稱']),
        description: String(prev['結果說明'] || ''),
        icon: String(prev['圖示'] || ''),
        seat: prevSeat,
        balance: balances_(cid)[prevSeat] || 0,
        remainingCount: readPool_(cid).filter(function (p) { return !p.drawn; }).length,
        replay: true
      };
    }
    // 卡片背包的卡片ID 用 requestId；不同班剛好重複時拒絕，避免兩班的卡片ID 撞在一起
    if (find_(table_(SHEET.BAG).rows, function (r) { return String(r['卡片ID']) === requestId; })) throw apiError_('INVALID_INPUT');

    // 2. 驗證在籍與券餘額
    if (!isActiveSeat_(cid, seat)) throw apiError_('INVALID_INPUT');
    var balance = balances_(cid)[seat] || 0;
    if (balance < 1) throw apiError_('NO_TICKET');

    // 3. 從未抽號碼中均勻隨機抽一個
    var poolTable = table_(SHEET.POOL, cid);
    var undrawn = poolTable.rows.filter(function (r) {
      return toInt_(r['號碼']) !== null && !yes_(r['已抽']);
    });
    if (undrawn.length === 0) throw apiError_('POOL_EMPTY');
    var pick = undrawn[Math.floor(Math.random() * undrawn.length)];
    var number = toInt_(pick['號碼']);

    // 4. 決定結果
    var type, name, description, icon = '', effect = EFFECT_NONE;
    if (String(pick['類型']).trim() === '實物') {
      type = '實物';
      name = String(pick['實物名稱'] || '').trim() || PRIZE_NAME;
      description = '';
    } else {
      var card = pickCard_(cid);
      if (!card) throw apiError_('NOT_FOUND');
      type = '抽卡';
      name = card.name;
      description = card.description;
      icon = card.icon;
      effect = card.effect;
    }

    // 5. 寫入籤池、抽籤券、抽籤紀錄；抽到卡片時同時放進卡片背包（卡名、說明、效果在這時候固定下來）
    var now = nowIso_();
    setFields_(poolTable, pick._row, { '已抽': '是', '抽出座號': seat, '抽出時間': now });
    appendRows_(table_(SHEET.TICKETS, cid), [{ '座號': seat, '異動': -1, '原因': '抽籤', '時間': now }]);
    appendRows_(draws, [{
      '請求ID': requestId, '時間': now, '座號': seat, '號碼': number,
      '類型': type, '結果名稱': name, '結果說明': description, '圖示': icon
    }]);
    if (type === '抽卡') {
      appendRows_(table_(SHEET.BAG, cid), [{
        '卡片ID': requestId, '座號': seat, '卡名': name, '圖示': icon, '說明': description, '效果': effect,
        '來源': '抽籤', '取得時間': now, '狀態': BAG_UNUSED
      }]);
    }

    // 6. 回傳
    return {
      number: number,
      type: type,
      name: name,
      description: description,
      icon: icon,
      seat: seat,
      balance: balance - 1,
      remainingCount: undrawn.length - 1
    };
  });
}

function resetPool_(req) {
  if (req.confirm !== '重設') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.POOL, req.cid);
    t.rows.forEach(function (r) {
      setFields_(t, r._row, { '已抽': '否', '抽出座號': '', '抽出時間': '' });
    });
    return { reset: t.rows.length };
  });
}

/** 依權重從啟用的卡片中抽一張 */
function pickCard_(cid) {
  var cards = readCards_(cid).filter(isDrawable_);
  if (cards.length === 0) return null;
  var total = cards.reduce(function (s, c) { return s + c.weight; }, 0);
  var r = Math.random() * total;
  for (var i = 0; i < cards.length; i++) {
    r -= cards[i].weight;
    if (r < 0) return cards[i];
  }
  return cards[cards.length - 1];
}

function isDrawable_(c) {
  return c.enabled && c.name && isFinite(c.weight) && c.weight > 0;
}

/* ============================================================
 * 卡片（獎項）設定：只有導師碼可以呼叫
 * ============================================================ */

function readCards_(cid) {
  return table_(SHEET.CARDS, cid).rows.map(cardItem_).filter(function (c) { return c.id; });
}

function cardItem_(r) {
  var icon = String(r['圖示'] || '').trim();
  var effect = String(r['效果'] || '').trim();
  return {
    id: String(r['卡片ID'] || ''),
    name: String(r['卡名'] || '').trim(),
    icon: ICONS.hasOwnProperty(icon) ? icon : DEFAULT_ICON,
    description: String(r['說明'] || '').trim(),
    weight: Number(r['權重']),
    effect: EFFECTS.indexOf(effect) !== -1 ? effect : EFFECT_NONE,
    enabled: String(r['啟用']).trim() !== '否' && r['啟用'] !== false,
    _row: r._row
  };
}

/** 卡片清單（含停用的卡）與每張卡目前的中獎機率（%）、可選的圖示與效果 */
function getCards_(req) {
  var cards = readCards_(req.cid);
  var total = cards.filter(isDrawable_).reduce(function (s, c) { return s + c.weight; }, 0);
  return {
    cards: cards.map(function (c) {
      var p = isDrawable_(c) && total > 0 ? Math.round(c.weight / total * 1000) / 10 : 0;
      return { id: c.id, name: c.name, icon: c.icon, description: c.description, weight: c.weight, effect: c.effect, enabled: c.enabled, percent: p };
    }),
    icons: Object.keys(ICONS).map(function (k) { return { key: k, emoji: ICONS[k] }; }),
    effects: EFFECTS.slice(),
    maxCards: MAX_CARDS
  };
}

/** 新增（沒有 id）或修改（有 id）一張卡片 */
function saveCard_(req) {
  var cid = req.cid;
  var hasId = req.id !== undefined && req.id !== null && req.id !== '';
  var id = hasId ? cleanId_(req.id) : null;
  var name = cleanText_(req.name, 1, 20);
  var description = cleanText_(req.description === undefined ? '' : req.description, 0, 60);
  if (typeof req.icon !== 'string' || !ICONS.hasOwnProperty(req.icon)) throw apiError_('INVALID_INPUT');
  if (EFFECTS.indexOf(req.effect) === -1) throw apiError_('INVALID_INPUT');
  var weight = Number(req.weight);
  if (typeof req.weight !== 'number' || !isFinite(weight) || weight <= 0 || weight > 100) throw apiError_('INVALID_INPUT');
  weight = Math.round(weight * 100) / 100;
  if (typeof req.enabled !== 'boolean') throw apiError_('INVALID_INPUT');

  return withLock_(function () {
    var t = table_(SHEET.CARDS, cid);
    var cards = t.rows.map(cardItem_);
    // 同一班卡名不能重複（停用的也算），避免背包裡分不清
    if (cards.some(function (c) { return c.name === name && c.id !== id; })) throw apiError_('DUPLICATE_NAME');
    var fields = { '卡名': name, '圖示': req.icon, '說明': description, '權重': weight, '效果': req.effect, '啟用': req.enabled ? '是' : '否' };
    if (hasId) {
      var row = find_(cards, function (c) { return c.id === id; });
      if (!row) throw apiError_('NOT_FOUND');
      setFields_(t, row._row, fields);
    } else {
      if (cards.length >= MAX_CARDS) throw apiError_('TOO_MANY_CARDS');
      id = 'C' + newId_();
      fields['卡片ID'] = id;
      appendRows_(t, [fields]);
    }
    return { id: id, name: name, icon: req.icon, description: description, weight: weight, effect: req.effect, enabled: req.enabled };
  });
}

/** 刪除卡片設定（已經在背包裡的卡不受影響，因為抽到時已經複製一份） */
function deleteCard_(req) {
  var id = cleanId_(req.id);
  return withLock_(function () {
    var t = table_(SHEET.CARDS, req.cid);
    var row = find_(t.rows, function (r) { return String(r['卡片ID']) === id; });
    if (!row) throw apiError_('NOT_FOUND');
    t.sheet.deleteRow(row._row);
    return { id: id };
  });
}

/* ============================================================
 * 卡片背包
 * ============================================================ */

/**
 * 讀取卡片背包。seat 有值時只回傳該座號的卡片。
 * 回傳 cards（未使用在前、已使用在後，各自新到舊）、counts（各座號未使用張數）、
 * choices（自選卡片可以挑的卡片）。
 */
function getBackpack_(req) {
  var cid = req.cid;
  var hasSeat = req.seat !== undefined && req.seat !== null && req.seat !== '';
  var seat = hasSeat ? toSeat_(req.seat) : null;
  if (hasSeat && seat === null) throw apiError_('INVALID_INPUT');

  var items = readBag_(cid).filter(function (c) {
    return c.status !== BAG_REVOKED && (seat === null || c.seat === seat);
  });
  var unused = items.filter(function (c) { return c.status === BAG_UNUSED; }).reverse();
  var used = items.filter(function (c) { return c.status === BAG_USED || c.status === BAG_RECYCLED; })
    .sort(function (a, b) { return a.usedAt < b.usedAt ? 1 : -1; });
  // 全班總覽時，已使用的卡片只回傳最近 50 張，避免資料量越來越大
  if (seat === null) used = used.slice(0, 50);

  return {
    seat: seat,
    cards: unused.concat(used).map(bagOut_),
    counts: bagCounts_(cid),
    choices: chooseChoices_(cid).map(function (c) { return { id: c.id, name: c.name, icon: c.icon, description: c.description }; }),
    serverTime: nowIso_()
  };
}

/**
 * 使用一張卡片（只有導師碼可以呼叫）。效果看背包裡記錄的「效果」欄：
 * 再抽一次：自動送 1 張抽籤券。
 * 自選卡片：需帶 choiceId（卡片設定的卡片ID），挑到的卡放進同一位同學的背包（未使用）。
 */
function useCard_(req) {
  var cid = req.cid;
  var cardId = cleanId_(req.cardId);
  return withLock_(function () {
    var bag = table_(SHEET.BAG, cid);
    var row = find_(bag.rows, function (r) { return String(r['卡片ID']) === cardId; });
    if (!row) throw apiError_('NOT_FOUND');
    var card = bagItem_(row);
    if (card.status !== BAG_UNUSED) throw apiError_('ALREADY_USED');

    var now = nowIso_();
    var result = { card: null, granted: 0, balance: null, chosen: null };
    var fields = { '狀態': BAG_USED, '使用時間': now };

    if (card.effect === EFFECT_REDRAW) {
      if (!isActiveSeat_(cid, card.seat)) throw apiError_('NOT_FOUND');
      appendRows_(table_(SHEET.TICKETS, cid), [{ '座號': card.seat, '異動': 1, '原因': EFFECT_REDRAW, '時間': now }]);
      result.granted = 1;
      result.balance = balances_(cid)[card.seat] || 0;
    } else if (card.effect === EFFECT_CHOOSE) {
      // 後端再檢查一次：只能挑同一班、啟用中、效果允許的卡
      var choiceId = typeof req.choiceId === 'string' ? req.choiceId : '';
      var choice = find_(chooseChoices_(cid), function (c) { return c.id === choiceId; });
      if (!choice) throw apiError_('INVALID_INPUT');
      var chosen = {
        id: 'L' + newId_(), seat: card.seat, name: choice.name, icon: choice.icon, description: choice.description,
        effect: choice.effect, source: EFFECT_CHOOSE, gotAt: now, status: BAG_UNUSED, usedAt: '', linkId: ''
      };
      appendRows_(bag, [{
        '卡片ID': chosen.id, '座號': chosen.seat, '卡名': chosen.name, '圖示': chosen.icon, '說明': chosen.description,
        '效果': chosen.effect, '來源': chosen.source, '取得時間': now, '狀態': BAG_UNUSED
      }]);
      fields['連動ID'] = chosen.id;
      result.chosen = bagOut_(chosen);
    }

    setFields_(bag, row._row, fields);
    card.status = BAG_USED;
    card.usedAt = now;
    result.card = bagOut_(card);
    return result;
  });
}

/**
 * 復原誤按的「使用」（只有導師碼可以呼叫）。
 * 再抽一次：收回送出的券（券已經拿去抽就不能復原）。
 * 自選卡片：收回挑到的卡（那張卡已經用掉就不能復原）。
 */
function undoUseCard_(req) {
  var cid = req.cid;
  var cardId = cleanId_(req.cardId);
  return withLock_(function () {
    var bag = table_(SHEET.BAG, cid);
    var row = find_(bag.rows, function (r) { return String(r['卡片ID']) === cardId; });
    if (!row) throw apiError_('NOT_FOUND');
    var card = bagItem_(row);
    if (card.status !== BAG_USED) throw apiError_('NOT_USED');

    var now = nowIso_();
    if (card.effect === EFFECT_REDRAW) {
      if ((balances_(cid)[card.seat] || 0) < 1) throw apiError_('CANNOT_UNDO');
      appendRows_(table_(SHEET.TICKETS, cid), [{ '座號': card.seat, '異動': -1, '原因': EFFECT_REDRAW + '（復原）', '時間': now }]);
    } else if (card.effect === EFFECT_CHOOSE && card.linkId) {
      var linked = find_(bag.rows, function (r) { return String(r['卡片ID']) === card.linkId; });
      if (linked) {
        if (bagItem_(linked).status !== BAG_UNUSED) throw apiError_('CANNOT_UNDO');
        setFields_(bag, linked._row, { '狀態': BAG_REVOKED, '使用時間': now });
      }
    }

    setFields_(bag, row._row, { '狀態': BAG_UNUSED, '使用時間': '', '連動ID': '' });
    card.status = BAG_UNUSED;
    card.usedAt = '';
    card.linkId = '';
    return { card: bagOut_(card), balance: balances_(cid)[card.seat] || 0 };
  });
}

/**
 * 回收換券（只有導師碼可以呼叫）：同一位同學剛好 3 張未使用的卡，換 1 張抽籤券。
 * 卡名可以相同，但同一張卡（同一個卡片ID）不能重複算。
 * 3 張卡改成「已回收」並寫上同一個回收ID（放在連動ID 欄），復原時用它找回這 3 張。
 */
function recycleCards_(req) {
  var cid = req.cid;
  if (!Array.isArray(req.cardIds) || req.cardIds.length !== RECYCLE_COUNT) throw apiError_('INVALID_INPUT');
  var ids = req.cardIds.map(cleanId_);
  var seen = {};
  ids.forEach(function (id) {
    if (seen[id]) throw apiError_('INVALID_INPUT');
    seen[id] = true;
  });

  return withLock_(function () {
    var bag = table_(SHEET.BAG, cid);
    var rows = ids.map(function (id) {
      var row = find_(bag.rows, function (r) { return String(r['卡片ID']) === id; });
      if (!row) throw apiError_('NOT_FOUND');
      if (bagItem_(row).status !== BAG_UNUSED) throw apiError_('ALREADY_USED');
      return row;
    });
    var seat = bagItem_(rows[0]).seat;
    if (rows.some(function (r) { return bagItem_(r).seat !== seat; })) throw apiError_('INVALID_INPUT');
    if (!isActiveSeat_(cid, seat)) throw apiError_('NOT_FOUND');

    var now = nowIso_();
    var recycleId = 'R' + newId_();
    rows.forEach(function (r) {
      setFields_(bag, r._row, { '狀態': BAG_RECYCLED, '使用時間': now, '連動ID': recycleId });
    });
    appendRows_(table_(SHEET.TICKETS, cid), [{ '座號': seat, '異動': 1, '原因': RECYCLE_REASON, '時間': now }]);

    return {
      seat: seat,
      recycleId: recycleId,
      cards: rows.map(function (r) {
        var c = bagItem_(r);
        c.status = BAG_RECYCLED;
        c.usedAt = now;
        c.linkId = recycleId;
        return bagOut_(c);
      }),
      granted: 1,
      balance: balances_(cid)[seat] || 0
    };
  });
}

/**
 * 復原回收（只有導師碼可以呼叫）：收回換到的 1 張券，這次回收的卡全部改回未使用。
 * 券已經拿去抽就不能復原。
 */
function undoRecycle_(req) {
  var cid = req.cid;
  var recycleId = cleanId_(req.recycleId);
  return withLock_(function () {
    var bag = table_(SHEET.BAG, cid);
    var rows = bag.rows.filter(function (r) {
      return String(r['連動ID']) === recycleId && bagItem_(r).status === BAG_RECYCLED;
    });
    if (!rows.length) throw apiError_('NOT_FOUND');
    var seat = bagItem_(rows[0]).seat;
    if ((balances_(cid)[seat] || 0) < 1) throw apiError_('CANNOT_UNDO');

    appendRows_(table_(SHEET.TICKETS, cid), [{ '座號': seat, '異動': -1, '原因': RECYCLE_REASON + '（復原）', '時間': nowIso_() }]);
    rows.forEach(function (r) {
      setFields_(bag, r._row, { '狀態': BAG_UNUSED, '使用時間': '', '連動ID': '' });
    });
    return { seat: seat, restored: rows.length, balance: balances_(cid)[seat] || 0 };
  });
}

/**
 * 學期末清理：刪除本班「已使用」「已回收」與「已收回」的卡片（只有導師碼可以呼叫）。
 * 未使用的卡片保留；confirm 必須是字串「清除」。
 */
function clearUsedCards_(req) {
  if (req.confirm !== '清除') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var bag = table_(SHEET.BAG, req.cid);
    var rowNums = bag.rows.filter(function (r) {
      var st = String(r['狀態']).trim();
      return st === BAG_USED || st === BAG_RECYCLED || st === BAG_REVOKED;
    }).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
    // 由下往上刪，前面的列號才不會跑掉
    rowNums.forEach(function (n) { bag.sheet.deleteRow(n); });
    return { removed: rowNums.length };
  });
}

function readBag_(cid) {
  return table_(SHEET.BAG, cid).rows.map(bagItem_).filter(function (c) { return c.id && c.seat !== null; });
}

function bagItem_(r) {
  var effect = String(r['效果'] || '').trim();
  return {
    id: String(r['卡片ID'] || ''),
    seat: toInt_(r['座號']),
    name: String(r['卡名'] || ''),
    icon: String(r['圖示'] || '') || DEFAULT_ICON,
    description: String(r['說明'] || ''),
    effect: EFFECTS.indexOf(effect) !== -1 ? effect : EFFECT_NONE,
    source: String(r['來源'] || ''),
    gotAt: String(r['取得時間'] || ''),
    status: String(r['狀態'] || '').trim() || BAG_UNUSED,
    usedAt: String(r['使用時間'] || ''),
    linkId: String(r['連動ID'] || '')
  };
}

function bagOut_(c) {
  return {
    id: c.id, seat: c.seat, name: c.name, icon: c.icon, description: c.description, effect: c.effect,
    source: c.source, gotAt: c.gotAt, status: c.status, usedAt: c.usedAt,
    recycleId: c.status === BAG_RECYCLED ? c.linkId : ''
  };
}

/** 各座號未使用的卡片張數 */
function bagCounts_(cid) {
  var counts = {};
  readBag_(cid).forEach(function (c) {
    if (c.status === BAG_UNUSED) counts[c.seat] = (counts[c.seat] || 0) + 1;
  });
  return counts;
}

/** 自選卡片可以挑的卡片：同一班、啟用中，而且效果在 CHOOSE_ALLOWED_EFFECTS 裡 */
function chooseChoices_(cid) {
  return readCards_(cid).filter(function (c) {
    return c.enabled && c.name && CHOOSE_ALLOWED_EFFECTS.indexOf(c.effect) !== -1;
  });
}

/* ============================================================
 * 讀取輔助
 * ============================================================ */

function readRoster_(cid) {
  var seen = {};
  return table_(SHEET.ROSTER, cid).rows.map(function (r) {
    return {
      classCode: cid,
      seat: toInt_(r['座號']),
      active: String(r['在籍']).trim() !== '否'
    };
  }).filter(function (r) {
    if (r.seat === null || seen[r.seat]) return false;
    seen[r.seat] = true;
    return true;
  }).sort(function (a, b) { return a.seat - b.seat; });
}

function isActiveSeat_(cid, seat) {
  return readRoster_(cid).some(function (r) { return r.seat === seat && r.active; });
}

function readAssignments_(t) {
  return t.rows.map(function (r) {
    var a = objToAssign_(r);
    a._row = r._row;
    return a;
  }).filter(function (a) { return a.id; });
}

function objToAssign_(r) {
  var onBoard = yes_(r['上投影']);
  return {
    id: String(r['ID'] || ''),
    date: String(r['日期'] || ''),
    name: String(r['名稱'] || ''),
    onBoard: onBoard,
    order: onBoard ? toInt_(r['投影順序']) : null,
    createdAt: String(r['建立時間'] || ''),
    recorded: yes_(r['已點收'])
  };
}

function assignOut_(a) {
  return { id: a.id, date: a.date, name: a.name, onBoard: a.onBoard, order: a.order, createdAt: a.createdAt, recorded: a.recorded };
}

function byOrder_(a, b) {
  var x = a.order === null ? 999 : a.order;
  var y = b.order === null ? 999 : b.order;
  return x - y || (a.createdAt < b.createdAt ? -1 : 1);
}

function readPool_(cid) {
  return table_(SHEET.POOL, cid).rows.map(function (r) {
    return { number: toInt_(r['號碼']), drawn: yes_(r['已抽']) };
  }).filter(function (p) { return p.number !== null; })
    .sort(function (a, b) { return a.number - b.number; });
}

function balances_(cid) {
  var sum = {};
  table_(SHEET.TICKETS, cid).rows.forEach(function (r) {
    var s = toInt_(r['座號']);
    var d = toInt_(r['異動']);
    if (s === null || d === null) return;
    sum[s] = (sum[s] || 0) + d;
  });
  Object.keys(sum).forEach(function (s) { if (sum[s] < 0) sum[s] = 0; });
  return sum;
}

/* ============================================================
 * 試算表存取
 * ============================================================ */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** 試算表缺少後來加入的欄位時，補上標題並為既有資料列填入預設值；有補欄位就回傳 true */
function addMissingColumns_(sheet, name, idx, lastRow) {
  var added = ADDED_COLUMNS[name];
  if (!added) return false;
  var missing = Object.keys(added).filter(function (h) { return !(h in idx); });
  if (!missing.length) return false;
  var col = Math.max(sheet.getLastColumn(), 1);
  missing.forEach(function (h) {
    col++;
    sheet.getRange(1, col).setValue(h).setFontWeight('bold');
    if (lastRow > 1) {
      var fill = [];
      for (var i = 2; i <= lastRow; i++) fill.push([added[h]]);
      sheet.getRange(2, col, lastRow - 1, 1).setValues(fill);
    }
  });
  return true;
}

/** 建立工作表、寫入標題列，並把需要的欄位設成純文字格式 */
function createSheet_(ss, name) {
  var sheet = ss.insertSheet(name);
  var header = HEADERS[name];
  sheet.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  (TEXT_COLUMNS[name] || []).forEach(function (col) {
    var c = header.indexOf(col) + 1;
    sheet.getRange(2, c, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  });
  return sheet;
}

/**
 * 讀取整張工作表，回傳 { sheet, header, idx, rows, cid }，rows 為物件且含 _row（實際列號）。
 * 有給 cid 時只保留該班的資料列，appendRows_ 也會自動填入該班的班級ID。
 */
function table_(name, cid) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表「' + name + '」，請先執行 setup()。');
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), HEADERS[name].length);
  var values = lastRow >= 1 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  header.forEach(function (h, i) { if (h && !(h in idx)) idx[h] = i; });
  if (addMissingColumns_(sheet, name, idx, lastRow)) return table_(name, cid);
  HEADERS[name].forEach(function (h) {
    if (!(h in idx)) throw new Error('工作表「' + name + '」缺少欄位「' + h + '」。');
  });

  var tz = Session.getScriptTimeZone();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var arr = values[i];
    var empty = true;
    var obj = { _row: i + 1 };
    for (var key in idx) {
      var v = arr[idx[key]];
      if (v instanceof Date) v = key === '日期' ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v.toISOString();
      if (v !== '' && v !== null) empty = false;
      obj[key] = v;
    }
    if (empty) continue;
    if (cid !== undefined && String(obj['班級ID']).trim() !== cid) continue;
    rows.push(obj);
  }
  return { name: name, sheet: sheet, header: header, idx: idx, width: lastCol, rows: rows, cid: cid };
}

function setFields_(t, rowNum, fields) {
  Object.keys(fields).forEach(function (k) {
    t.sheet.getRange(rowNum, t.idx[k] + 1).setValue(fields[k]);
  });
}

function appendRows_(t, objs) {
  if (!objs || objs.length === 0) return;
  var start = t.sheet.getLastRow() + 1;
  var data = objs.map(function (o) {
    var arr = [];
    for (var c = 0; c < t.width; c++) arr.push('');
    Object.keys(o).forEach(function (k) { arr[t.idx[k]] = o[k]; });
    if (t.cid !== undefined) arr[t.idx['班級ID']] = t.cid;
    return arr;
  });
  (TEXT_COLUMNS[t.name] || []).forEach(function (col) {
    t.sheet.getRange(start, t.idx[col] + 1, data.length, 1).setNumberFormat('@');
  });
  t.sheet.getRange(start, 1, data.length, t.width).setValues(data);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_WAIT_MS)) throw apiError_('LOCKED_TIMEOUT');
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 * 小工具
 * ============================================================ */

/** 固定時間比較兩個字串，避免從回應時間猜出正確內容 */
function checkCode_(code, expected) {
  if (!expected || typeof code !== 'string' || code.length === 0) return false;
  if (code.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < code.length; i++) diff |= code.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function ok_(data) { return { ok: true, data: data }; }
function fail_(code) { return { ok: false, error: code }; }

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code) {
  var e = new Error(code);
  e.apiCode = code;
  return e;
}

function find_(list, pred) {
  for (var i = 0; i < list.length; i++) if (pred(list[i])) return list[i];
  return null;
}

function yes_(v) {
  return v === true || String(v).trim() === '是' || String(v).toUpperCase() === 'TRUE';
}

function toInt_(v) {
  if (typeof v === 'number') return isFinite(v) && Math.floor(v) === v ? v : null;
  if (typeof v === 'string' && /^\s*-?\d{1,6}\s*$/.test(v)) return parseInt(v, 10);
  return null;
}

function toSeat_(v) {
  var n = toInt_(v);
  return n !== null && n >= 1 && n <= 99 ? n : null;
}

function cleanName_(v) {
  return cleanText_(v, 1, 40);
}

/** 去掉前後空白後檢查長度；不是字串或長度不符就丟 INVALID_INPUT */
function cleanText_(v, min, max) {
  var s = typeof v === 'string' ? v.trim() : null;
  if (s === null || s.length < min || s.length > max) throw apiError_('INVALID_INPUT');
  return s;
}

function cleanClassId_(v) {
  if (typeof v !== 'string' || !/^[0-9A-Za-z-]{1,10}$/.test(v.trim())) throw apiError_('INVALID_INPUT');
  return v.trim();
}

/** 導師碼、班級碼：6 到 32 個字，不可以有空白 */
function cleanCode_(v) {
  if (typeof v !== 'string' || v.length < CODE_MIN || v.length > CODE_MAX || /\s/.test(v)) throw apiError_('WEAK_CODE');
  return v;
}

function cleanDate_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw apiError_('INVALID_INPUT');
  var p = v.split('-').map(Number);
  var d = new Date(p[0], p[1] - 1, p[2]);
  if (d.getFullYear() !== p[0] || d.getMonth() !== p[1] - 1 || d.getDate() !== p[2]) throw apiError_('INVALID_INPUT');
  return v;
}

function cleanId_(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(v)) throw apiError_('INVALID_INPUT');
  return v;
}

function newId_() {
  var rand = Math.random().toString(36).slice(2, 8);
  return Date.now().toString(36) + '-' + rand;
}

function nowIso_() {
  return new Date().toISOString();
}

function todayStr_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
