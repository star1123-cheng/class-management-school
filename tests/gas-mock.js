/*
 * 本機測試用：模擬 Google Apps Script 的試算表與服務，讓 gas/Code.gs 可以在 Node 裡執行。
 * 只模擬 Code.gs 用到的功能；不會連到 Google。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const NUMERIC = /^-?\d+(\.\d+)?$/;

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    // 和真正的 GAS 一樣：資料大小必須剛好等於範圍大小
    if (values.length !== this.numRows || values.some((v) => v.length !== this.numCols)) {
      throw new Error('資料大小與範圍不符');
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  setNumberFormat(fmt) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this.sheet.formats[(this.row + r) + ',' + (this.col + c)] = fmt;
    }
    return this;
  }
  setFontWeight() { return this; }
  clearContent() {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) this.sheet.set(this.row + r, this.col + c, '');
    }
    return this;
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.rows = [];      // rows[r-1][c-1]
    this.formats = {};   // 'r,c' -> '@'
  }
  get(r, c) {
    const line = this.rows[r - 1];
    const v = line ? line[c - 1] : undefined;
    return v === undefined || v === null ? '' : v;
  }
  set(r, c, v) {
    // 沒設純文字格式的儲存格，數字字串會被試算表轉成數字
    if (typeof v === 'string' && this.formats[r + ',' + c] !== '@' && NUMERIC.test(v)) v = Number(v);
    while (this.rows.length < r) this.rows.push([]);
    this.rows[r - 1][c - 1] = v;
  }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) {
      if ((this.rows[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.rows.forEach((line) => line.forEach((v, i) => { if (v !== '' && v !== undefined && v !== null) max = Math.max(max, i + 1); }));
    return max;
  }
  getMaxRows() { return 1000; }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows || 1, numCols || 1); }
  deleteRow(n) {
    this.rows.splice(n - 1, 1);
    // 格式也跟著往上移
    const next = {};
    Object.keys(this.formats).forEach((k) => {
      const [r, c] = k.split(',').map(Number);
      if (r < n) next[k] = this.formats[k];
      else if (r > n) next[(r - 1) + ',' + c] = this.formats[k];
    });
    this.formats = next;
  }
  setFrozenRows() {}
  /** 測試用：回傳全部內容（含標題列） */
  dump() { return this.rows.map((line) => line.slice()); }
}

function createGas(options) {
  options = options || {};
  const sheets = {};
  const props = Object.assign({}, options.properties || {});
  const cache = {};
  const logs = [];

  const spreadsheet = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => {
      if (sheets[name]) throw new Error('工作表已存在：' + name);
      sheets[name] = new Sheet(name);
      return sheets[name];
    }
  };

  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: (k) => { delete cache[k]; }
      })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, str) => Array.from(new Int8Array(crypto.createHash('sha256').update(str, 'utf8').digest())),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => d.toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    ContentService: {
      MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s })
    },
    console: { log: (m) => logs.push(m), error: (m) => logs.push('ERROR ' + m) },
    Math, Date, JSON, Object, Array, String, Number, Error, isFinite, parseInt
  };
  vm.createContext(context);
  const code = fs.readFileSync(process.env.CODE_GS || path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
  vm.runInContext(code, context, { filename: 'Code.gs' });

  return {
    ctx: context,
    sheets,
    props,
    cache,
    logs,
    /** 模擬前端送出 POST，回傳解析後的 JSON */
    post(body) {
      const res = context.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(res.getContent());
    }
  };
}

module.exports = { createGas };
