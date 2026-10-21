/**
 * 班級作業缺交系統與雲端一番賞：後端（Google Apps Script）
 *
 * 使用前：
 * 1. 到「專案設定 → 指令碼屬性」新增兩組存取碼（值由導師自訂，不要寫在程式裡）：
 *    ACCESS_CODE  導師碼：可以使用全部功能（只輸入在導師自己的裝置）
 *    DISPLAY_CODE 教室碼：只能看投影、看抽籤頁與執行「抽」（輸入在班級電腦）
 * 2. 執行 setup() 建立工作表（舊版升級時可不重跑：第一次抽到卡片或打開背包時，會自動建立「卡片背包」）。
 * 3. 部署為網頁應用程式（執行身分：我；存取權：任何人），安全性靠存取碼。
 *
 * 所有 API 一律用 POST，body 為 JSON 字串：{ action, code, ...參數 }
 * 回應：成功 { ok: true, data }；失敗 { ok: false, error: "代碼" }
 */

var SHEET = {
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
HEADERS[SHEET.ROSTER] = ['班級代號', '座號', '在籍'];
HEADERS[SHEET.ASSIGN] = ['ID', '日期', '名稱', '上投影', '投影順序', '建立時間', '已點收'];

// 後來才加入的欄位：舊試算表缺少時自動補在最右邊，既有資料列填入預設值
var ADDED_COLUMNS = {};
ADDED_COLUMNS[SHEET.ASSIGN] = { '已點收': '是' };   // 舊作業都是用「點缺交」記錄的，視為已點收
HEADERS[SHEET.MISSING] = ['作業ID', '座號', '狀態', '更新時間'];
HEADERS[SHEET.TICKETS] = ['座號', '異動', '原因', '時間'];
HEADERS[SHEET.POOL] = ['號碼', '類型', '實物名稱', '已抽', '抽出座號', '抽出時間'];
HEADERS[SHEET.CARDS] = ['卡名', '說明', '權重', '啟用'];
HEADERS[SHEET.DRAWS] = ['請求ID', '時間', '座號', '號碼', '類型', '結果名稱', '結果說明'];
HEADERS[SHEET.BAG] = ['卡片ID', '座號', '卡名', '說明', '來源', '取得時間', '狀態', '使用時間', '連動ID'];

// 這些欄位設為「純文字」格式，避免試算表自動把日期、時間字串轉成日期物件
var TEXT_COLUMNS = {};
TEXT_COLUMNS[SHEET.ROSTER] = ['班級代號'];
TEXT_COLUMNS[SHEET.ASSIGN] = ['ID', '日期', '名稱', '建立時間'];
TEXT_COLUMNS[SHEET.MISSING] = ['作業ID', '更新時間'];
TEXT_COLUMNS[SHEET.TICKETS] = ['時間'];
TEXT_COLUMNS[SHEET.POOL] = ['實物名稱', '抽出時間'];
TEXT_COLUMNS[SHEET.DRAWS] = ['請求ID', '時間'];
TEXT_COLUMNS[SHEET.BAG] = ['卡片ID', '取得時間', '使用時間', '連動ID'];

var POOL_SIZE = 40;
var PRIZE_NUMBERS = [7, 13, 20, 21, 34];
var PRIZE_NAME = '小文具小玩具';
var MAX_BOARD = 5;
var LOCK_WAIT_MS = 10000;

// 有自動效果的卡片（依卡名辨識；在試算表改了卡名，自動效果就會失效）
var CARD_REDRAW = '再抽一次';  // 使用後自動送 1 張抽籤券
var CARD_LUCKY = '幸運女神';   // 使用後從啟用中的卡片挑一張放進背包

// 卡片背包的狀態
var BAG_UNUSED = '未使用';
var BAG_USED = '已使用';
var BAG_REVOKED = '已收回';    // 幸運女神被復原時，挑到的那張卡改成這個狀態
var BAG_RECYCLED = '已回收';   // 學生拿去回收換券的卡（同一次回收的卡，連動ID 相同）

// 回收換券：幾張未使用的卡換 1 張抽籤券
var RECYCLE_COUNT = 3;
var RECYCLE_REASON = '回收卡片';

var DEFAULT_CARDS = [
  ['我是DJ', '下課或用餐時間可以點 1 首歌。', 1.5],
  ['導演', '用餐時間可以選一部影片。', 1.5],
  ['神隊友', '考試遇到困難時，可以請求幫助。（限平時考、一題）', 1],
  ['財神爺', '使用後下一次點數 x2。', 1],
  ['免當值日生', '把值日生的任務交給下一個人。', 1],
  ['聯絡簿代抄', '老師幫忙寫聯絡簿。', 1],
  ['免死金牌', '可免除 1 次任何處罰。（嚴重者除外）', 1],
  ['老師來幫忙', '平時考時老師幫你檢查選擇題答案。', 1],
  ['掃地Pass', '今天不用做掃地工作。', 1],
  ['幸運女神', '從全部兌換券選一張。', 1],
  ['作業-1', '不用寫一項作業。（習作、作文除外）', 1],
  ['點數卡', '抽卡完的點數直接加 5 點。', 1],
  ['再抽一次', '不滿意的卡可以再抽一次。（可當次或下次使用）', 1],
  ['野餐卡', '用餐時間可和好朋友一起吃飯。', 1],
  ['白日夢卡', '可以挑一本書閱讀，不用睡午覺。', 1],
  ['榮譽之星', '獲得學校的榮譽卡一張。', 1]
];

/* ============================================================
 * 初始化
 * ============================================================ */

/**
 * 一次建立 7 張工作表、標題列、籤池 40 個號碼與 16 張卡片。
 * 已存在的工作表不會被覆蓋。
 */
function setup() {
  var code = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE');
  if (!code) {
    throw new Error('尚未設定導師碼：請先到「專案設定（齒輪圖示）→ 指令碼屬性」新增屬性「ACCESS_CODE」，值由導師自行決定，儲存後再重新執行 setup()。');
  }
  var displayCode = PropertiesService.getScriptProperties().getProperty('DISPLAY_CODE');
  if (displayCode && displayCode === code) {
    throw new Error('教室碼 DISPLAY_CODE 不可以和導師碼 ACCESS_CODE 相同，請改成不同的值後再執行 setup()。');
  }
  var ss = ss_();
  var report = [];

  Object.keys(HEADERS).forEach(function (name) {
    if (name === SHEET.BAG) return; // 卡片背包要從抽籤紀錄補登，放到最後處理
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = createSheet_(ss, name);
      report.push('已建立：' + name);
    } else {
      report.push('已存在，略過：' + name);
    }

    // 籤池、卡片只在沒有資料列時才填入預設內容
    if (name === SHEET.POOL && sheet.getLastRow() <= 1) {
      var poolRows = [];
      for (var n = 1; n <= POOL_SIZE; n++) {
        var isPrize = PRIZE_NUMBERS.indexOf(n) !== -1;
        poolRows.push([n, isPrize ? '實物' : '抽卡', isPrize ? PRIZE_NAME : '', '否', '', '']);
      }
      sheet.getRange(2, 1, poolRows.length, poolRows[0].length).setValues(poolRows);
      report.push('已填入籤池 1 至 ' + POOL_SIZE + ' 號');
    }
    if (name === SHEET.CARDS && sheet.getLastRow() <= 1) {
      var cardRows = DEFAULT_CARDS.map(function (c) { return [c[0], c[1], c[2], '是']; });
      sheet.getRange(2, 1, cardRows.length, 4).setValues(cardRows);
      report.push('已填入 ' + cardRows.length + ' 張卡片');
    }
  });

  if (ss.getSheetByName(SHEET.BAG)) {
    report.push('已存在，略過：' + SHEET.BAG);
  } else {
    report.push('已建立：' + SHEET.BAG + '（從抽籤紀錄補登 ' + ensureBag_().backfilled + ' 張卡片）');
  }

  if (!displayCode) report.push('提醒：尚未設定教室碼 DISPLAY_CODE，班級電腦目前只能用導師碼登入。');
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

  // 一律先驗證存取碼，失敗時不回傳任何資料
  var role = roleOf_(req.code);
  if (!role) return out_(fail_('UNAUTHORIZED'));

  var handler = ACTIONS[req.action];
  if (typeof handler !== 'function') return out_(fail_('INVALID_INPUT'));

  // 教室碼只能使用投影與抽籤需要的功能，其餘一律拒絕
  if (role !== 'teacher' && DISPLAY_ACTIONS.indexOf(req.action) === -1) return out_(fail_('FORBIDDEN'));
  req.role = role;

  try {
    return out_(ok_(handler(req)));
  } catch (err) {
    if (err && err.apiCode) return out_(fail_(err.apiCode));
    console.error('API 發生錯誤（' + req.action + '）：' + (err && err.stack ? err.stack : err));
    return out_(fail_('SERVER_ERROR'));
  }
}

// 教室碼（DISPLAY_CODE）可以呼叫的 API
var DISPLAY_ACTIONS = ['ping', 'getBoard', 'getLottery', 'draw', 'getBackpack'];

var ACTIONS = {
  ping: function (req) { return { serverTime: nowIso_(), role: req.role }; },
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
  getBackpack: getBackpack_,
  useCard: useCard_,
  undoUseCard: undoUseCard_,
  recycleCards: recycleCards_,
  undoRecycle: undoRecycle_,
  clearUsedCards: clearUsedCards_
};

/* ============================================================
 * 作業缺交
 * ============================================================ */

function getState_() {
  var missing = table_(SHEET.MISSING).rows.map(function (r) {
    return {
      assignmentId: String(r['作業ID']),
      seat: toInt_(r['座號']),
      status: String(r['狀態']).trim(),
      updatedAt: String(r['更新時間'])
    };
  }).filter(function (m) { return m.seat !== null && (m.status === '缺交' || m.status === '已補交'); });

  return {
    roster: readRoster_(),
    assignments: readAssignments_().map(assignOut_),
    missing: missing,
    serverTime: nowIso_()
  };
}

function getBoard_() {
  var roster = readRoster_();
  var active = {};
  roster.forEach(function (r) { if (r.active) active[r.seat] = true; });

  var items = readAssignments_()
    .filter(function (a) { return a.onBoard; })
    .sort(byOrder_)
    .slice(0, MAX_BOARD);

  var bySeat = {};
  table_(SHEET.MISSING).rows.forEach(function (r) {
    var seat = toInt_(r['座號']);
    if (seat === null || !active[seat] || String(r['狀態']).trim() !== '缺交') return;
    var id = String(r['作業ID']);
    (bySeat[id] = bySeat[id] || {})[seat] = true;
  });

  return {
    items: items.map(function (a) {
      var seats = Object.keys(bySeat[a.id] || {}).map(Number).sort(function (x, y) { return x - y; });
      return { id: a.id, name: a.name, date: a.date, order: a.order, recorded: a.recorded, missing: seats };
    }),
    activeCount: Object.keys(active).length,
    serverTime: nowIso_()
  };
}

function importRoster_(req) {
  if (req.mode !== 'replace' && req.mode !== 'append') throw apiError_('INVALID_INPUT');
  if (!Array.isArray(req.rows) || req.rows.length === 0 || req.rows.length > 99) throw apiError_('INVALID_INPUT');

  var seen = {};
  var clean = req.rows.map(function (r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw apiError_('INVALID_INPUT');
    // 只接受班級代號與座號，任何其他欄位（例如姓名）一律拒絕
    Object.keys(r).forEach(function (k) {
      if (k !== 'seat' && k !== 'classCode') throw apiError_('INVALID_INPUT');
    });
    var seat = toSeat_(r.seat);
    if (seat === null || seen[seat]) throw apiError_('INVALID_INPUT');
    seen[seat] = true;
    var cc = r.classCode === undefined || r.classCode === null ? '' : String(r.classCode).trim();
    if (!/^[0-9A-Za-z-]{0,10}$/.test(cc)) throw apiError_('INVALID_INPUT');
    return { seat: seat, classCode: cc };
  });

  return withLock_(function () {
    var t = table_(SHEET.ROSTER);
    var existing = {};
    t.rows.forEach(function (r) {
      var s = toInt_(r['座號']);
      if (s !== null && !existing[s]) existing[s] = r;
    });
    var incoming = {};
    clean.forEach(function (c) { incoming[c.seat] = c; });

    var added = 0, activated = 0, deactivated = 0;
    if (req.mode === 'replace') {
      Object.keys(existing).forEach(function (s) {
        var row = existing[s];
        var inc = incoming[s];
        if (inc) {
          var fields = {};
          if (row['在籍'] !== '是') { fields['在籍'] = '是'; activated++; }
          if (String(row['班級代號']) !== inc.classCode) fields['班級代號'] = inc.classCode;
          setFields_(t, row._row, fields);
        } else if (row['在籍'] !== '否') {
          setFields_(t, row._row, { '在籍': '否' });
          deactivated++;
        }
      });
    }
    var toAdd = clean.filter(function (c) { return !existing[c.seat]; }).map(function (c) {
      return { '班級代號': c.classCode, '座號': c.seat, '在籍': '是' };
    });
    appendRows_(t, toAdd);
    added = toAdd.length;

    return { roster: readRoster_(), added: added, activated: activated, deactivated: deactivated };
  });
}

function setRosterActive_(req) {
  var seat = toSeat_(req.seat);
  if (seat === null || typeof req.active !== 'boolean') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.ROSTER);
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
    var t = table_(SHEET.ASSIGN);
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
    var t = table_(SHEET.ASSIGN);
    var row = find_(t.rows, function (r) { return String(r['ID']) === id; });
    if (!row) throw apiError_('NOT_FOUND');
    setFields_(t, row._row, { '名稱': name, '日期': date });
    return { id: id, name: name, date: date };
  });
}

function deleteAssignment_(req) {
  var id = cleanId_(req.id);
  return withLock_(function () {
    var t = table_(SHEET.ASSIGN);
    var row = find_(t.rows, function (r) { return String(r['ID']) === id; });
    if (!row) throw apiError_('NOT_FOUND');
    t.sheet.deleteRow(row._row);

    var m = table_(SHEET.MISSING);
    var rowsToDelete = m.rows.filter(function (r) { return String(r['作業ID']) === id; })
      .map(function (r) { return r._row; })
      .sort(function (a, b) { return b - a; });
    rowsToDelete.forEach(function (n) { m.sheet.deleteRow(n); });

    renumberBoard_();
    return { id: id, deletedMissing: rowsToDelete.length };
  });
}

function saveMissing_(req) {
  var id = cleanId_(req.assignmentId);
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
    var a = table_(SHEET.ASSIGN);
    var assignRow = find_(a.rows, function (r) { return String(r['ID']) === id; });
    if (!assignRow) throw apiError_('NOT_FOUND');
    if (req.markRecorded && !yes_(assignRow['已點收'])) setFields_(a, assignRow._row, { '已點收': '是' });

    var t = table_(SHEET.MISSING);
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
    var t = table_(SHEET.ASSIGN);
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
      renumberBoard_();
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
    var t = table_(SHEET.ASSIGN);
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
function renumberBoard_() {
  var t = table_(SHEET.ASSIGN);
  readAssignments_(t).filter(function (a) { return a.onBoard; }).sort(byOrder_).forEach(function (a, i) {
    if (a.order !== i + 1) setFields_(t, a._row, { '投影順序': i + 1 });
  });
}

/* ============================================================
 * 一番賞
 * ============================================================ */

function getLottery_(req) {
  var limit = toInt_(req.limit);
  if (limit === null || limit < 1) limit = 10;
  if (limit > 50) limit = 50;

  var pool = readPool_();
  var seats = readRoster_().filter(function (r) { return r.active; }).map(function (r) { return r.seat; });
  var balances = balances_();
  var out = {};
  seats.forEach(function (s) { out[s] = balances[s] || 0; });

  var draws = table_(SHEET.DRAWS).rows;
  var recent = draws.slice(-limit).reverse().map(function (r) {
    return {
      time: String(r['時間']),
      seat: toInt_(r['座號']),
      number: toInt_(r['號碼']),
      type: String(r['類型']),
      name: String(r['結果名稱'])
    };
  });

  var drawnCount = pool.filter(function (p) { return p.drawn; }).length;
  return {
    // 籤池只回傳是否已抽，不回傳類型與獎品內容
    pool: pool.map(function (p) { return { number: p.number, drawn: p.drawn }; }),
    seats: seats,
    balances: out,
    bagCounts: bagCounts_(),
    recent: recent,
    drawnCount: drawnCount,
    remainingCount: pool.length - drawnCount,
    total: pool.length,
    serverTime: nowIso_()
  };
}

function grantTickets_(req) {
  var seat = toSeat_(req.seat);
  var amount = toInt_(req.amount);
  var reason = req.reason;
  if (seat === null || amount === null || amount === 0 || Math.abs(amount) > 50) throw apiError_('INVALID_INPUT');
  if (reason !== '發放' && reason !== '更正') throw apiError_('INVALID_INPUT');
  if (reason === '發放' && amount < 0) throw apiError_('INVALID_INPUT');

  return withLock_(function () {
    if (!isActiveSeat_(seat)) throw apiError_('NOT_FOUND');
    var balance = balances_()[seat] || 0;
    if (balance + amount < 0) throw apiError_('INVALID_INPUT');
    appendRows_(table_(SHEET.TICKETS), [{ '座號': seat, '異動': amount, '原因': reason, '時間': nowIso_() }]);
    return { seat: seat, balance: balance + amount };
  });
}

function draw_(req) {
  var seat = toSeat_(req.seat);
  var requestId = typeof req.requestId === 'string' ? req.requestId : '';
  if (seat === null || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw apiError_('INVALID_INPUT');

  return withLock_(function () {
    // 1. 相同 requestId 已處理過：直接回傳上次結果，不重複扣券
    var draws = table_(SHEET.DRAWS);
    var prev = find_(draws.rows, function (r) { return String(r['請求ID']) === requestId; });
    if (prev) {
      var prevSeat = toInt_(prev['座號']);
      var poolNow = readPool_();
      return {
        number: toInt_(prev['號碼']),
        type: String(prev['類型']),
        name: String(prev['結果名稱']),
        description: String(prev['結果說明'] || ''),
        seat: prevSeat,
        balance: balances_()[prevSeat] || 0,
        remainingCount: poolNow.filter(function (p) { return !p.drawn; }).length,
        replay: true
      };
    }

    // 2. 驗證在籍與券餘額
    if (!isActiveSeat_(seat)) throw apiError_('INVALID_INPUT');
    var balance = balances_()[seat] || 0;
    if (balance < 1) throw apiError_('NO_TICKET');

    // 3. 從未抽號碼中均勻隨機抽一個
    var poolTable = table_(SHEET.POOL);
    var undrawn = poolTable.rows.filter(function (r) {
      return toInt_(r['號碼']) !== null && !yes_(r['已抽']);
    });
    if (undrawn.length === 0) throw apiError_('POOL_EMPTY');
    var pick = undrawn[Math.floor(Math.random() * undrawn.length)];
    var number = toInt_(pick['號碼']);

    // 4. 決定結果
    var type, name, description;
    if (String(pick['類型']).trim() === '實物') {
      type = '實物';
      name = String(pick['實物名稱'] || '').trim() || PRIZE_NAME;
      description = '';
    } else {
      var card = pickCard_();
      if (!card) throw apiError_('NOT_FOUND');
      type = '抽卡';
      name = card.name;
      description = card.description;
    }

    // 5. 寫入籤池、抽籤券、抽籤紀錄；抽到卡片時同時放進卡片背包
    var bag = type === '抽卡' ? ensureBag_().table : null;
    var now = nowIso_();
    setFields_(poolTable, pick._row, { '已抽': '是', '抽出座號': seat, '抽出時間': now });
    appendRows_(table_(SHEET.TICKETS), [{ '座號': seat, '異動': -1, '原因': '抽籤', '時間': now }]);
    appendRows_(draws, [{
      '請求ID': requestId, '時間': now, '座號': seat, '號碼': number,
      '類型': type, '結果名稱': name, '結果說明': description
    }]);
    if (bag) {
      appendRows_(bag, [{
        '卡片ID': requestId, '座號': seat, '卡名': name, '說明': description,
        '來源': '抽籤', '取得時間': now, '狀態': BAG_UNUSED
      }]);
    }

    // 6. 回傳
    return {
      number: number,
      type: type,
      name: name,
      description: description,
      seat: seat,
      balance: balance - 1,
      remainingCount: undrawn.length - 1
    };
  });
}

function resetPool_(req) {
  if (req.confirm !== '重設') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var t = table_(SHEET.POOL);
    t.rows.forEach(function (r) {
      setFields_(t, r._row, { '已抽': '否', '抽出座號': '', '抽出時間': '' });
    });
    return { reset: t.rows.length };
  });
}

/** 依權重從啟用的卡片中抽一張 */
function pickCard_() {
  var cards = enabledCards_();
  if (cards.length === 0) return null;
  var total = cards.reduce(function (s, c) { return s + c.weight; }, 0);
  var r = Math.random() * total;
  for (var i = 0; i < cards.length; i++) {
    r -= cards[i].weight;
    if (r < 0) return cards[i];
  }
  return cards[cards.length - 1];
}

/** 「卡片」工作表中啟用、權重大於 0 的卡 */
function enabledCards_() {
  return table_(SHEET.CARDS).rows.map(function (r) {
    return {
      name: String(r['卡名'] || '').trim(),
      description: String(r['說明'] || '').trim(),
      weight: Number(r['權重']),
      enabled: String(r['啟用']).trim() !== '否' && r['啟用'] !== false
    };
  }).filter(function (c) { return c.name && c.enabled && isFinite(c.weight) && c.weight > 0; });
}

/* ============================================================
 * 卡片背包
 * ============================================================ */

/**
 * 讀取卡片背包。seat 有值時只回傳該座號的卡片。
 * 回傳 cards（未使用在前、已使用在後，各自新到舊）、counts（各座號未使用張數）、
 * choices（幸運女神可以挑的卡片）。
 */
function getBackpack_(req) {
  var hasSeat = req.seat !== undefined && req.seat !== null && req.seat !== '';
  var seat = hasSeat ? toSeat_(req.seat) : null;
  if (hasSeat && seat === null) throw apiError_('INVALID_INPUT');

  if (!ss_().getSheetByName(SHEET.BAG)) withLock_(function () { ensureBag_(); });
  var items = readBag_().filter(function (c) {
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
    counts: bagCounts_(),
    choices: luckyChoices_().map(function (c) { return { name: c.name, description: c.description }; }),
    serverTime: nowIso_()
  };
}

/**
 * 使用一張卡片（只有導師碼可以呼叫）。
 * 再抽一次：自動送 1 張抽籤券。
 * 幸運女神：需帶 choice（卡名），挑到的卡放進同一位同學的背包（未使用）。
 */
function useCard_(req) {
  var cardId = cleanId_(req.cardId);
  return withLock_(function () {
    var bag = ensureBag_().table;
    var row = find_(bag.rows, function (r) { return String(r['卡片ID']) === cardId; });
    if (!row) throw apiError_('NOT_FOUND');
    var card = bagItem_(row);
    if (card.status !== BAG_UNUSED) throw apiError_('ALREADY_USED');

    var now = nowIso_();
    var result = { card: null, granted: 0, balance: null, chosen: null };
    var fields = { '狀態': BAG_USED, '使用時間': now };

    if (card.name === CARD_REDRAW) {
      if (!isActiveSeat_(card.seat)) throw apiError_('NOT_FOUND');
      appendRows_(table_(SHEET.TICKETS), [{ '座號': card.seat, '異動': 1, '原因': CARD_REDRAW, '時間': now }]);
      result.granted = 1;
      result.balance = balances_()[card.seat] || 0;
    } else if (card.name === CARD_LUCKY) {
      // 後端再檢查一次：只能挑啟用中、而且不是幸運女神的卡
      var choiceName = typeof req.choice === 'string' ? req.choice.trim() : '';
      var choice = find_(luckyChoices_(), function (c) { return c.name === choiceName; });
      if (!choice) throw apiError_('INVALID_INPUT');
      var chosen = {
        id: 'L' + newId_(), seat: card.seat, name: choice.name, description: choice.description,
        source: CARD_LUCKY, gotAt: now, status: BAG_UNUSED, usedAt: ''
      };
      appendRows_(bag, [{
        '卡片ID': chosen.id, '座號': chosen.seat, '卡名': chosen.name, '說明': chosen.description,
        '來源': chosen.source, '取得時間': now, '狀態': BAG_UNUSED
      }]);
      fields['連動ID'] = chosen.id;
      result.chosen = chosen;
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
 * 幸運女神：收回挑到的卡（那張卡已經用掉就不能復原）。
 */
function undoUseCard_(req) {
  var cardId = cleanId_(req.cardId);
  return withLock_(function () {
    var bag = ensureBag_().table;
    var row = find_(bag.rows, function (r) { return String(r['卡片ID']) === cardId; });
    if (!row) throw apiError_('NOT_FOUND');
    var card = bagItem_(row);
    if (card.status !== BAG_USED) throw apiError_('NOT_USED');

    var now = nowIso_();
    if (card.name === CARD_REDRAW) {
      if ((balances_()[card.seat] || 0) < 1) throw apiError_('CANNOT_UNDO');
      appendRows_(table_(SHEET.TICKETS), [{ '座號': card.seat, '異動': -1, '原因': CARD_REDRAW + '（復原）', '時間': now }]);
    } else if (card.name === CARD_LUCKY && card.linkId) {
      var linked = find_(bag.rows, function (r) { return String(r['卡片ID']) === card.linkId; });
      if (linked) {
        if (bagItem_(linked).status !== BAG_UNUSED) throw apiError_('CANNOT_UNDO');
        setFields_(bag, linked._row, { '狀態': BAG_REVOKED, '使用時間': now });
      }
    }

    setFields_(bag, row._row, { '狀態': BAG_UNUSED, '使用時間': '', '連動ID': '' });
    card.status = BAG_UNUSED;
    card.usedAt = '';
    return { card: bagOut_(card), balance: balances_()[card.seat] || 0 };
  });
}

/**
 * 回收換券（只有導師碼可以呼叫）：同一位同學剛好 3 張未使用的卡，換 1 張抽籤券。
 * 卡名可以相同，但同一張卡（同一個卡片ID）不能重複算。
 * 3 張卡改成「已回收」並寫上同一個回收ID（放在連動ID 欄），復原時用它找回這 3 張。
 */
function recycleCards_(req) {
  if (!Array.isArray(req.cardIds) || req.cardIds.length !== RECYCLE_COUNT) throw apiError_('INVALID_INPUT');
  var ids = req.cardIds.map(cleanId_);
  var seen = {};
  ids.forEach(function (id) {
    if (seen[id]) throw apiError_('INVALID_INPUT');
    seen[id] = true;
  });

  return withLock_(function () {
    var bag = ensureBag_().table;
    var rows = ids.map(function (id) {
      var row = find_(bag.rows, function (r) { return String(r['卡片ID']) === id; });
      if (!row) throw apiError_('NOT_FOUND');
      if (bagItem_(row).status !== BAG_UNUSED) throw apiError_('ALREADY_USED');
      return row;
    });
    var seat = bagItem_(rows[0]).seat;
    if (rows.some(function (r) { return bagItem_(r).seat !== seat; })) throw apiError_('INVALID_INPUT');
    if (!isActiveSeat_(seat)) throw apiError_('NOT_FOUND');

    var now = nowIso_();
    var recycleId = 'R' + newId_();
    rows.forEach(function (r) {
      setFields_(bag, r._row, { '狀態': BAG_RECYCLED, '使用時間': now, '連動ID': recycleId });
    });
    appendRows_(table_(SHEET.TICKETS), [{ '座號': seat, '異動': 1, '原因': RECYCLE_REASON, '時間': now }]);

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
      balance: balances_()[seat] || 0
    };
  });
}

/**
 * 復原回收（只有導師碼可以呼叫）：收回換到的 1 張券，這次回收的卡全部改回未使用。
 * 券已經拿去抽就不能復原。
 */
function undoRecycle_(req) {
  var recycleId = cleanId_(req.recycleId);
  return withLock_(function () {
    var bag = ensureBag_().table;
    var rows = bag.rows.filter(function (r) {
      return String(r['連動ID']) === recycleId && bagItem_(r).status === BAG_RECYCLED;
    });
    if (!rows.length) throw apiError_('NOT_FOUND');
    var seat = bagItem_(rows[0]).seat;
    if ((balances_()[seat] || 0) < 1) throw apiError_('CANNOT_UNDO');

    appendRows_(table_(SHEET.TICKETS), [{ '座號': seat, '異動': -1, '原因': RECYCLE_REASON + '（復原）', '時間': nowIso_() }]);
    rows.forEach(function (r) {
      setFields_(bag, r._row, { '狀態': BAG_UNUSED, '使用時間': '', '連動ID': '' });
    });
    return { seat: seat, restored: rows.length, balance: balances_()[seat] || 0 };
  });
}

/**
 * 學期末清理：刪除「已使用」「已回收」與「已收回」的卡片（只有導師碼可以呼叫）。
 * 未使用的卡片保留；confirm 必須是字串「清除」。
 */
function clearUsedCards_(req) {
  if (req.confirm !== '清除') throw apiError_('INVALID_INPUT');
  return withLock_(function () {
    var bag = ensureBag_().table;
    var rowNums = bag.rows.filter(function (r) {
      var st = String(r['狀態']).trim();
      return st === BAG_USED || st === BAG_RECYCLED || st === BAG_REVOKED;
    }).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
    // 由下往上刪，前面的列號才不會跑掉
    rowNums.forEach(function (n) { bag.sheet.deleteRow(n); });
    return { removed: rowNums.length };
  });
}

/**
 * 確保「卡片背包」工作表存在；第一次建立時，從「抽籤紀錄」補登過去抽到的卡片（一律為未使用）。
 * 會建立工作表，呼叫端必須已經持有鎖，或在 setup() 中執行。
 */
function ensureBag_() {
  var ss = ss_();
  var backfilled = 0;
  if (!ss.getSheetByName(SHEET.BAG)) {
    createSheet_(ss, SHEET.BAG);
    if (ss.getSheetByName(SHEET.DRAWS)) {
      var seen = {};
      var rows = table_(SHEET.DRAWS).rows.filter(function (r) {
        var id = String(r['請求ID'] || '');
        if (String(r['類型']).trim() !== '抽卡' || !id || seen[id]) return false;
        seen[id] = true;
        return true;
      }).map(function (r) {
        return {
          '卡片ID': String(r['請求ID']), '座號': toInt_(r['座號']), '卡名': String(r['結果名稱']),
          '說明': String(r['結果說明'] || ''), '來源': '補登', '取得時間': String(r['時間']), '狀態': BAG_UNUSED
        };
      });
      appendRows_(table_(SHEET.BAG), rows);
      backfilled = rows.length;
    }
  }
  return { table: table_(SHEET.BAG), backfilled: backfilled };
}

function readBag_() {
  if (!ss_().getSheetByName(SHEET.BAG)) return [];
  return table_(SHEET.BAG).rows.map(bagItem_).filter(function (c) { return c.id && c.seat !== null; });
}

function bagItem_(r) {
  return {
    id: String(r['卡片ID'] || ''),
    seat: toInt_(r['座號']),
    name: String(r['卡名'] || ''),
    description: String(r['說明'] || ''),
    source: String(r['來源'] || ''),
    gotAt: String(r['取得時間'] || ''),
    status: String(r['狀態'] || '').trim() || BAG_UNUSED,
    usedAt: String(r['使用時間'] || ''),
    linkId: String(r['連動ID'] || '')
  };
}

function bagOut_(c) {
  return {
    id: c.id, seat: c.seat, name: c.name, description: c.description, source: c.source, gotAt: c.gotAt, status: c.status, usedAt: c.usedAt,
    recycleId: c.status === BAG_RECYCLED ? c.linkId : ''
  };
}

/** 各座號未使用的卡片張數；背包工作表還沒建立時回傳空物件 */
function bagCounts_() {
  var counts = {};
  readBag_().forEach(function (c) {
    if (c.status === BAG_UNUSED) counts[c.seat] = (counts[c.seat] || 0) + 1;
  });
  return counts;
}

/** 幸運女神可以挑的卡片：啟用中，且不含幸運女神自己（避免無限循環） */
function luckyChoices_() {
  return enabledCards_().filter(function (c) { return c.name !== CARD_LUCKY; });
}

/* ============================================================
 * 讀取輔助
 * ============================================================ */

function readRoster_() {
  var seen = {};
  return table_(SHEET.ROSTER).rows.map(function (r) {
    return {
      classCode: r['班級代號'] === '' || r['班級代號'] === null ? '' : String(r['班級代號']),
      seat: toInt_(r['座號']),
      active: String(r['在籍']).trim() !== '否'
    };
  }).filter(function (r) {
    if (r.seat === null || seen[r.seat]) return false;
    seen[r.seat] = true;
    return true;
  }).sort(function (a, b) { return a.seat - b.seat; });
}

function isActiveSeat_(seat) {
  return readRoster_().some(function (r) { return r.seat === seat && r.active; });
}

function readAssignments_(t) {
  t = t || table_(SHEET.ASSIGN);
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

function readPool_() {
  return table_(SHEET.POOL).rows.map(function (r) {
    return { number: toInt_(r['號碼']), drawn: yes_(r['已抽']) };
  }).filter(function (p) { return p.number !== null; })
    .sort(function (a, b) { return a.number - b.number; });
}

function balances_() {
  var sum = {};
  table_(SHEET.TICKETS).rows.forEach(function (r) {
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

/** 建立工作表、寫入標題列，並把需要的欄位設成純文字格式 */
/** 舊試算表缺少後來加入的欄位時，補上標題並為既有資料列填入預設值；有補欄位就回傳 true */
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

/** 讀取整張工作表，回傳 { sheet, header, idx, rows }，rows 為物件且含 _row（實際列號） */
function table_(name) {
  var sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表「' + name + '」，請先執行 setup()。');
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), HEADERS[name].length);
  var values = lastRow >= 1 ? sheet.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var header = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  header.forEach(function (h, i) { if (h && !(h in idx)) idx[h] = i; });
  if (addMissingColumns_(sheet, name, idx, lastRow)) return table_(name);
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
    if (!empty) rows.push(obj);
  }
  return { name: name, sheet: sheet, header: header, idx: idx, width: lastCol, rows: rows };
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

/** 回傳 'teacher'（導師碼）、'display'（教室碼）或 null（錯誤） */
function roleOf_(code) {
  var props = PropertiesService.getScriptProperties();
  if (checkCode_(code, props.getProperty('ACCESS_CODE'))) return 'teacher';
  if (checkCode_(code, props.getProperty('DISPLAY_CODE'))) return 'display';
  return null;
}

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
  var s = typeof v === 'string' ? v.trim() : '';
  if (s.length === 0 || s.length > 40) throw apiError_('INVALID_INPUT');
  return s;
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
