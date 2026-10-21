/*
 * gas/Code.gs 的本機自動測試（多班級驗證、資料隔離、卡片效果、管理者功能）。
 * 執行：node --test tests/
 * 這裡的密碼與代碼都是測試用的假值。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

const ADMIN = 'test-admin-password';
const C501 = { classId: '501', teacher: 'teach501x', display: 'class501x' };
const C502 = { classId: '502', teacher: 'teach502x', display: 'class502x' };

/** 建立一個已 setup、開好 501 與 502 兩班、各有名單的環境 */
function school() {
  const g = createGas({ properties: { ADMIN_PASSWORD: ADMIN } });
  g.ctx.setup();
  [C501, C502].forEach((c) => {
    const r = g.post({ action: 'adminCreateClass', adminPassword: ADMIN, classId: c.classId, name: c.classId + ' 班', teacherCode: c.teacher, classCode: c.display });
    assert.equal(r.ok, true, JSON.stringify(r));
  });
  const t1 = api(g, C501);
  const t2 = api(g, C502);
  assert.equal(t1('importRoster', { mode: 'replace', rows: [{ seat: 1 }, { seat: 2 }, { seat: 3 }] }).ok, true);
  assert.equal(t2('importRoster', { mode: 'replace', rows: [1, 2, 3, 4, 5].map((s) => ({ seat: s })) }).ok, true);
  return { g, t1, t2 };
}

/** 回傳用某班導師碼（或班級碼）呼叫 API 的函式 */
function api(g, cls, role) {
  const code = role === 'display' ? cls.display : cls.teacher;
  return (action, params) => g.post(Object.assign({}, params || {}, { action, classId: cls.classId, code }));
}

function allCells(g) {
  return Object.values(g.sheets).flatMap((s) => s.dump().flat().map(String));
}

/** 只保留指定的一張卡為啟用，回傳該卡 */
function onlyCard(call, predicate, changes) {
  const cards = call('getCards').data.cards;
  let target = null;
  cards.forEach((c) => {
    const keep = !target && predicate(c);
    if (keep) target = c;
    const body = Object.assign({ id: c.id, name: c.name, icon: c.icon, description: c.description, weight: c.weight, effect: c.effect, enabled: keep }, keep ? changes : {});
    assert.equal(call('saveCard', body).ok, true);
  });
  return target;
}

/** 一直抽到抽中卡片為止（籤池有 5 個實物號碼），回傳抽籤結果 */
function drawCard(call, seat) {
  for (let i = 0; i < 40; i++) {
    call('grantTickets', { seat, amount: 1, reason: '發放' });
    const r = call('draw', { seat, requestId: 'req' + Math.random().toString(36).slice(2, 12) });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (r.data.type === '抽卡') return r.data;
  }
  throw new Error('抽不到卡片');
}

test('setup：沒有管理密碼時拒絕，有密碼時建立 9 張工作表並產生 HASH_PEPPER', () => {
  const bare = createGas();
  assert.throws(() => bare.ctx.setup(), /ADMIN_PASSWORD/);

  const g = createGas({ properties: { ADMIN_PASSWORD: ADMIN } });
  g.ctx.setup();
  assert.deepEqual(Object.keys(g.sheets).sort(), ['作業', '卡片', '卡片背包', '名單', '抽籤券', '抽籤紀錄', '班級', '籤池', '缺交'].sort());
  assert.ok(g.props.HASH_PEPPER && g.props.HASH_PEPPER.length >= 32);
  const pepper = g.props.HASH_PEPPER;
  g.ctx.setup(); // 重跑不會覆蓋
  assert.equal(g.props.HASH_PEPPER, pepper);
  assert.ok(!g.logs.join('\n').includes(ADMIN), '紀錄裡不可以出現管理密碼');
  assert.ok(!g.logs.join('\n').includes(pepper), '紀錄裡不可以出現 HASH_PEPPER');
});

test('管理密碼：錯誤時拒絕，連錯 10 次後暫停驗證', () => {
  const g = createGas({ properties: { ADMIN_PASSWORD: ADMIN } });
  g.ctx.setup();
  assert.equal(g.post({ action: 'adminPing', adminPassword: ADMIN }).ok, true);
  for (let i = 0; i < 10; i++) assert.equal(g.post({ action: 'adminPing', adminPassword: 'wrong' }).error, 'UNAUTHORIZED');
  assert.equal(g.post({ action: 'adminPing', adminPassword: ADMIN }).error, 'TOO_MANY_ATTEMPTS');
});

test('開班：檢查代碼規則、重複班級，試算表與回應都不含明碼', () => {
  const { g } = school();
  const create = (p) => g.post(Object.assign({ action: 'adminCreateClass', adminPassword: ADMIN, name: '測試' }, p));
  assert.equal(create({ classId: '503', teacherCode: 'short', classCode: 'class503x' }).error, 'WEAK_CODE');
  assert.equal(create({ classId: '503', teacherCode: 'has space1', classCode: 'class503x' }).error, 'WEAK_CODE');
  assert.equal(create({ classId: '503', teacherCode: 'samecode1', classCode: 'samecode1' }).error, 'SAME_CODE');
  assert.equal(create({ classId: '501', teacherCode: 'teach501y', classCode: 'class501y' }).error, 'ALREADY_EXISTS');
  assert.equal(create({ classId: '5 01', teacherCode: 'teach501y', classCode: 'class501y' }).error, 'INVALID_INPUT');

  const list = g.post({ action: 'adminListClasses', adminPassword: ADMIN });
  assert.deepEqual(list.data.classes.map((c) => c.classId), ['501', '502']);
  list.data.classes.forEach((c) => assert.deepEqual(Object.keys(c).sort(), ['active', 'classId', 'createdAt', 'name']));

  const cells = allCells(g);
  [C501.teacher, C501.display, C502.teacher, C502.display, ADMIN].forEach((secret) => {
    assert.ok(!cells.some((v) => v.includes(secret)), '試算表不可以出現明碼：' + secret);
  });
  // 每班有 40 個號碼、16 張卡片
  assert.equal(api(g, C501)('getLottery').data.total, 40);
  assert.equal(api(g, C502)('getCards').data.cards.length, 16);
});

test('班級驗證：導師碼、班級碼、跨班代碼、停用班級', () => {
  const { g } = school();
  assert.equal(api(g, C501)('ping').data.role, 'teacher');
  assert.equal(api(g, C501, 'display')('ping').data.role, 'display');
  assert.equal(api(g, C501)('ping').data.className, '501 班');
  // 501 的導師碼拿去 502 用
  assert.equal(g.post({ action: 'ping', classId: '502', code: C501.teacher }).error, 'UNAUTHORIZED');
  // 不存在的班級與存在的班級回同樣的錯誤
  assert.equal(g.post({ action: 'ping', classId: '999', code: C501.teacher }).error, 'UNAUTHORIZED');
  assert.equal(g.post({ action: 'ping', code: C501.teacher }).error, 'UNAUTHORIZED');
  // 驗證失敗時，連不存在的 action 也只回 UNAUTHORIZED
  assert.equal(g.post({ action: 'nope', classId: '501', code: 'wrong-code' }).error, 'UNAUTHORIZED');
  // 班級碼不能用導師功能
  assert.equal(api(g, C501, 'display')('getState').error, 'FORBIDDEN');
  assert.equal(api(g, C501, 'display')('useCard', { cardId: 'abcd' }).error, 'FORBIDDEN');
  assert.equal(api(g, C501, 'display')('saveCard', {}).error, 'FORBIDDEN');
  // 班級碼不能用管理功能
  assert.equal(g.post({ action: 'adminListClasses', adminPassword: C501.teacher }).error, 'UNAUTHORIZED');

  // 停用後無法登入，重新啟用後恢復
  assert.equal(g.post({ action: 'adminSetActive', adminPassword: ADMIN, classId: '501', active: false }).ok, true);
  assert.equal(api(g, C501)('ping').error, 'UNAUTHORIZED');
  assert.equal(g.post({ action: 'adminSetActive', adminPassword: ADMIN, classId: '501', active: true }).ok, true);
  assert.equal(api(g, C501)('ping').ok, true);
});

test('班級驗證：同一班連錯 10 次後暫停，不影響其他班', () => {
  const { g } = school();
  for (let i = 0; i < 10; i++) assert.equal(g.post({ action: 'ping', classId: '501', code: 'wrong-code' }).error, 'UNAUTHORIZED');
  assert.equal(api(g, C501)('ping').error, 'TOO_MANY_ATTEMPTS');
  assert.equal(api(g, C502)('ping').ok, true);
});

test('資料隔離：名單、作業、缺交只看得到自己班', () => {
  const { t1, t2 } = school();
  assert.deepEqual(t1('getState').data.roster.map((r) => r.seat), [1, 2, 3]);
  assert.deepEqual(t2('getState').data.roster.map((r) => r.seat), [1, 2, 3, 4, 5]);
  assert.equal(t1('getState').data.roster[0].classCode, '501');

  const a = t1('createAssignment', { name: '數習 p.10', date: '2026-10-22' }).data;
  assert.equal(t1('saveMissing', { assignmentId: a.id, changes: [{ seat: 2, status: '缺交' }], markRecorded: true }).ok, true);
  assert.equal(t1('getState').data.assignments.length, 1);
  assert.equal(t2('getState').data.assignments.length, 0);
  assert.equal(t2('getBoard').data.items.length, 0);
  assert.deepEqual(t1('getBoard').data.items[0].missing, [2]);

  // 502 拿 501 的作業 ID 修改、刪除、點收、上投影，全部找不到
  assert.equal(t2('updateAssignment', { id: a.id, name: '改名', date: '2026-10-22' }).error, 'NOT_FOUND');
  assert.equal(t2('deleteAssignment', { id: a.id }).error, 'NOT_FOUND');
  assert.equal(t2('saveMissing', { assignmentId: a.id, changes: [{ seat: 1, status: '缺交' }] }).error, 'NOT_FOUND');
  assert.equal(t2('setBoard', { assignmentId: a.id, on: false }).error, 'NOT_FOUND');
  assert.equal(t1('getState').data.assignments[0].name, '數習 p.10');

  // 刪除 501 的作業，只刪自己班的缺交
  const b = t2('createAssignment', { name: '國習', date: '2026-10-22' }).data;
  t2('saveMissing', { assignmentId: b.id, changes: [{ seat: 4, status: '缺交' }] });
  assert.equal(t1('deleteAssignment', { id: a.id }).data.deletedMissing, 1);
  assert.equal(t2('getState').data.missing.length, 1);
});

test('名單：拒絕姓名等額外欄位，也拒絕其他班的班級代號', () => {
  const { t1 } = school();
  assert.equal(t1('importRoster', { mode: 'append', rows: [{ seat: 4, name: '某某某' }] }).error, 'INVALID_INPUT');
  assert.equal(t1('importRoster', { mode: 'append', rows: [{ seat: 4, classCode: '502' }] }).error, 'INVALID_INPUT');
  assert.equal(t1('importRoster', { mode: 'append', rows: [{ seat: 4, classCode: '501' }] }).ok, true);
  const r = t1('importRoster', { mode: 'replace', rows: [{ seat: 1 }, { seat: 4 }] }).data;
  assert.equal(r.deactivated, 2);
  assert.deepEqual(r.roster.filter((x) => x.active).map((x) => x.seat), [1, 4]);
});

test('抽籤：券、籤池、抽籤紀錄各班分開；requestId 重送不重複扣券', () => {
  const { t1, t2 } = school();
  assert.equal(t1('grantTickets', { seat: 1, amount: 2, reason: '發放' }).data.balance, 2);
  assert.equal(t2('getLottery').data.balances['1'], 0);
  assert.equal(t2('draw', { seat: 1, requestId: 'req-b-0001' }).error, 'NO_TICKET');

  const r1 = t1('draw', { seat: 1, requestId: 'req-a-0001' }).data;
  assert.equal(r1.balance, 1);
  const again = t1('draw', { seat: 1, requestId: 'req-a-0001' }).data;
  assert.equal(again.replay, true);
  assert.equal(again.number, r1.number);
  assert.equal(t1('getLottery').data.balances['1'], 1);
  assert.equal(t1('getLottery').data.drawnCount, 1);
  assert.equal(t2('getLottery').data.drawnCount, 0);
  assert.equal(t2('getLottery').data.recent.length, 0);

  // 另一班用同一個 requestId：不可以拿到 501 的結果
  t2('grantTickets', { seat: 1, amount: 1, reason: '發放' });
  const cross = t2('draw', { seat: 1, requestId: 'req-a-0001' });
  assert.notEqual(cross.data && cross.data.replay, true);
  // 不在 502 名單的座號不能抽
  assert.equal(t1('draw', { seat: 5, requestId: 'req-a-0002' }).error, 'INVALID_INPUT');

  // 重設籤池只影響自己班
  assert.equal(t1('resetPool', { confirm: '重設' }).data.reset, 40);
  assert.equal(t1('getLottery').data.drawnCount, 0);
});

test('卡片設定：欄位驗證、重複卡名、上限與機率', () => {
  const { t1, t2 } = school();
  const base = { name: '新卡', icon: 'gift', description: '說明', weight: 2, effect: '無', enabled: true };
  const bad = (p) => t1('saveCard', Object.assign({}, base, p)).error;
  assert.equal(bad({ icon: '<img src=x>' }), 'INVALID_INPUT');
  assert.equal(bad({ icon: 'https://example.com/a.png' }), 'INVALID_INPUT');
  assert.equal(bad({ effect: '幸運女神' }), 'INVALID_INPUT');
  assert.equal(bad({ weight: 0 }), 'INVALID_INPUT');
  assert.equal(bad({ weight: '2' }), 'INVALID_INPUT');
  assert.equal(bad({ weight: 101 }), 'INVALID_INPUT');
  assert.equal(bad({ name: '' }), 'INVALID_INPUT');
  assert.equal(bad({ name: 'x'.repeat(21) }), 'INVALID_INPUT');
  assert.equal(bad({ description: 'x'.repeat(61) }), 'INVALID_INPUT');
  assert.equal(bad({ enabled: 'yes' }), 'INVALID_INPUT');
  assert.equal(bad({ name: '導演' }), 'DUPLICATE_NAME');

  const saved = t1('saveCard', base).data;
  assert.match(saved.id, /^C/);
  assert.equal(t1('getCards').data.cards.length, 17);
  assert.equal(t2('getCards').data.cards.length, 16);
  // 502 不能改 501 的卡
  assert.equal(t2('saveCard', Object.assign({}, base, { id: saved.id })).error, 'NOT_FOUND');
  assert.equal(t2('deleteCard', { id: saved.id }).error, 'NOT_FOUND');

  // 機率：啟用中的卡加總約為 100%
  const sum = t1('getCards').data.cards.reduce((s, c) => s + c.percent, 0);
  assert.ok(Math.abs(sum - 100) < 1, '機率加總 ' + sum);
  const info = t1('getCards').data;
  assert.ok(info.icons.length > 10 && info.effects.length === 3);

  assert.equal(t1('deleteCard', { id: saved.id }).ok, true);
  for (let i = 0; i < 34; i++) assert.equal(t1('saveCard', Object.assign({}, base, { name: '卡' + i })).ok, true);
  assert.equal(t1('saveCard', Object.assign({}, base, { name: '第51張' })).error, 'TOO_MANY_CARDS');
});

test('效果「再抽一次」：看欄位不看卡名，可以復原', () => {
  const { t1 } = school();
  // 把再抽一次的卡改名成「超級卡」，效果不變
  onlyCard(t1, (c) => c.effect === '再抽一次', { name: '超級卡' });
  const got = drawCard(t1, 1);
  assert.equal(got.name, '超級卡');
  assert.equal(got.icon, 'redo');
  const before = t1('getLottery').data.balances['1'];
  const bag = t1('getBackpack', { seat: 1 }).data.cards.find((c) => c.status === '未使用');
  assert.equal(bag.effect, '再抽一次');
  const used = t1('useCard', { cardId: bag.id }).data;
  assert.equal(used.granted, 1);
  assert.equal(used.balance, before + 1);
  assert.equal(t1('undoUseCard', { cardId: bag.id }).data.balance, before);
  assert.equal(t1('useCard', { cardId: bag.id }).ok, true);
  assert.equal(t1('useCard', { cardId: bag.id }).error, 'ALREADY_USED');

  // 已經抽到的卡，之後改卡片設定也不會變
  onlyCard(t1, (c) => c.name === '超級卡', { effect: '無' });
  assert.equal(t1('getBackpack', { seat: 1 }).data.cards.find((c) => c.id === bag.id).effect, '再抽一次');
});

test('效果「自選卡片」：只能挑同班、啟用、允許的效果；可以復原', () => {
  const { t1, t2 } = school();
  onlyCard(t1, (c) => c.effect === '自選卡片', { name: '許願卡' });
  const got = drawCard(t1, 2);
  assert.equal(got.name, '許願卡');
  const card = t1('getBackpack', { seat: 2 }).data.cards.find((c) => c.status === '未使用');

  // 再加一張啟用中的自選卡片，確認它不在可選清單
  t1('saveCard', { name: '第二張許願', icon: 'clover', description: '', weight: 1, effect: '自選卡片', enabled: true });
  const choices = t1('getBackpack', { seat: 2 }).data.choices;
  assert.ok(!choices.some((c) => c.name === '許願卡' || c.name === '第二張許願'));

  // 讓幾張一般卡與再抽一次的卡啟用，可以出現在可選清單
  const all = t1('getCards').data.cards;
  const normal = all.find((c) => c.name === '導演');
  const redraw = all.find((c) => c.effect === '再抽一次');
  [normal, redraw].forEach((c) => t1('saveCard', Object.assign({}, c, { enabled: true })));
  const ids = t1('getBackpack', { seat: 2 }).data.choices.map((c) => c.id);
  assert.ok(ids.includes(normal.id) && ids.includes(redraw.id));

  const wish = t1('getCards').data.cards.find((c) => c.name === '第二張許願');
  const other = t2('getCards').data.cards[0];
  assert.equal(t1('useCard', { cardId: card.id, choiceId: wish.id }).error, 'INVALID_INPUT');
  assert.equal(t1('useCard', { cardId: card.id, choiceId: other.id }).error, 'INVALID_INPUT');
  assert.equal(t1('useCard', { cardId: card.id }).error, 'INVALID_INPUT');

  const r = t1('useCard', { cardId: card.id, choiceId: normal.id }).data;
  assert.equal(r.chosen.name, '導演');
  assert.equal(r.chosen.source, '自選卡片');
  assert.equal(t1('getBackpack', { seat: 2 }).data.cards.filter((c) => c.status === '未使用').length, 1);

  // 復原：挑到的卡被收回，自選卡片回到未使用
  t1('undoUseCard', { cardId: card.id });
  const after = t1('getBackpack', { seat: 2 }).data.cards;
  assert.equal(after.length, 1);
  assert.equal(after[0].id, card.id);
  // 502 看不到 501 的背包，也不能用 501 的卡
  assert.equal(t2('getBackpack', { seat: 2 }).data.cards.length, 0);
  assert.equal(t2('useCard', { cardId: card.id }).error, 'NOT_FOUND');
});

test('回收換券與清理：只動自己班', () => {
  const { t1, t2 } = school();
  onlyCard(t1, (c) => c.name === '導演');
  [1, 2, 3].forEach(() => drawCard(t1, 3));
  const cards = t1('getBackpack', { seat: 3 }).data.cards.filter((c) => c.status === '未使用').map((c) => c.id);
  assert.equal(cards.length, 3);
  assert.equal(t2('recycleCards', { cardIds: cards }).error, 'NOT_FOUND');
  const before = t1('getLottery').data.balances['3'];
  const rc = t1('recycleCards', { cardIds: cards }).data;
  assert.equal(rc.balance, before + 1);
  assert.equal(t1('undoRecycle', { recycleId: rc.recycleId }).data.restored, 3);
  t1('recycleCards', { cardIds: cards });
  assert.equal(t2('clearUsedCards', { confirm: '清除' }).data.removed, 0);
  assert.equal(t1('clearUsedCards', { confirm: '清除' }).data.removed, 3);
});

test('管理者：重設代碼', () => {
  const { g } = school();
  const set = (p) => g.post(Object.assign({ action: 'adminSetCodes', adminPassword: ADMIN, classId: '501' }, p));
  assert.equal(set({}).error, 'INVALID_INPUT');
  assert.equal(set({ teacherCode: C501.display }).error, 'SAME_CODE');
  assert.equal(set({ classCode: C501.teacher }).error, 'SAME_CODE');
  assert.equal(set({ classId: '999', teacherCode: 'newteach501' }).error, 'NOT_FOUND');
  assert.equal(set({ teacherCode: 'newteach501' }).ok, true);
  assert.equal(api(g, C501)('ping').error, 'UNAUTHORIZED');
  assert.equal(g.post({ action: 'ping', classId: '501', code: 'newteach501' }).data.role, 'teacher');
  assert.equal(api(g, C501, 'display')('ping').data.role, 'display');
});

test('管理者：刪除班級只清掉該班，其他班照常運作', () => {
  const { g, t1, t2 } = school();
  t1('createAssignment', { name: '501 作業', date: '2026-10-22' });
  t1('grantTickets', { seat: 1, amount: 3, reason: '發放' });
  drawCard(t1, 1);
  const b = t2('createAssignment', { name: '502 作業', date: '2026-10-22' }).data;
  t2('grantTickets', { seat: 5, amount: 2, reason: '發放' });

  assert.equal(g.post({ action: 'adminDeleteClass', adminPassword: ADMIN, classId: '501', confirm: '502' }).error, 'INVALID_INPUT');
  const r = g.post({ action: 'adminDeleteClass', adminPassword: ADMIN, classId: '501', confirm: '501' });
  assert.equal(r.ok, true);
  assert.equal(r.data.removed['籤池'], 40);

  // 全部工作表都沒有 501 的資料
  Object.values(g.sheets).forEach((s) => {
    s.dump().slice(1).forEach((line) => assert.notEqual(String(line[0]), '501', s.name + ' 還有 501 的資料'));
  });
  assert.equal(api(g, C501)('ping').error, 'UNAUTHORIZED');

  // 502 照常：資料還在，也能繼續寫入
  assert.equal(t2('getState').data.assignments[0].id, b.id);
  assert.equal(t2('getLottery').data.balances['5'], 2);
  assert.equal(t2('saveMissing', { assignmentId: b.id, changes: [{ seat: 1, status: '缺交' }] }).ok, true);
  assert.equal(drawCard(t2, 5).type, '抽卡');
  assert.equal(g.post({ action: 'adminListClasses', adminPassword: ADMIN }).data.classes.length, 1);
});

test('格式錯誤的請求', () => {
  const { g } = school();
  const raw = (s) => JSON.parse(g.ctx.doPost({ postData: { contents: s } }).getContent());
  assert.equal(raw('not json').error, 'INVALID_INPUT');
  assert.equal(raw('[]').error, 'INVALID_INPUT');
  assert.equal(api(g, C501)('noSuchAction').error, 'INVALID_INPUT');
  assert.equal(api(g, C501)('hasOwnProperty').error, 'INVALID_INPUT');
  assert.equal(g.post({ action: 'ping', classId: { a: 1 }, code: 'x' }).error, 'UNAUTHORIZED');
});
