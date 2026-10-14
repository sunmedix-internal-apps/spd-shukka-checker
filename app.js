"use strict";

const STORAGE_KEYS = { master: "spd-shipping-master-v1", state: "spd-shipping-state-v2" };
const HISTORY_DB_NAME = "spd-shipping-history-v1";
const HISTORY_STORE_NAME = "scanHistory";
const HISTORY_SETTINGS_STORE_NAME = "settings";
const BACKUP_DIRECTORY_KEY = "historyBackupDirectory";
const PENDING_BACKUP_IDS_KEY = "pendingHistoryBackupIds";
const BACKUP_PATH = "C:\\システム\\SPD出荷チェッカー\\読取履歴";
const ADMIN_PASSWORD_KEY = "adminPasswordHash";
const ADMIN_PASSWORD_ITERATIONS = 150000;
const SKIP_COMMAND = "SPD-SKIP";
const APP_VERSION = "20261014-4";
const ALTERNATE_JAN_STORAGE_KEY = "spd-alternate-jans-v1";
let ALTERNATE_JANS = restoreAlternateJans(globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE
  || (typeof module !== "undefined" && module.exports ? require("./alternate-jans.js") : {}));
const alternateJanUpdate = { table: null, checking: null };
const appUpdate = { ready: false, pendingOperations: 0, version: "", deferred: false, reloading: false, timer: null };
let appInitializationPromise = null;
const CODE128_PATTERNS = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
const FACILITY_CENTER_MAP = Object.freeze({
  "東都文京病院": "0000000001",
  "東和病院": "0000000001",
  "荒木記念東京リバーサイド病院": "0000000001",
  "平成立石病院": "0000000001",
  "令和あらかわ病院": "0000000001",
  "石橋総合病院": "0000000001",
  "とちぎメディカルセンターしもつが": "0000000001",
  "とちぎメディカルセンターとちのき": "0000000001",
  "介護老人保健施設とちぎの郷": "0000000001",
  "総合健診センター": "0000000001",
  "千葉白井病院": "0000000002",
  "湘南ﾘﾊﾋﾞﾘﾃｰｼｮﾝ病院": "0000000002",
  "前橋協立病院": "0000000002",
  "高崎中央病院": "0000000002",
  "桐生協立診療所": "0000000002",
  "太田協立診療所": "0000000002",
  "北毛病院": "0000000002",
  "前橋協立診療所": "0000000002",
  "通町診療所": "0000000002",
  "北毛診療所": "0000000002",
  "善衆会病院": "0000000002",
  "佐野市民病院": "0000000003"
});
const REQUIRED_HEADERS = ["施設コード", "施設名称", "部署コード", "部署名称", "品名", "製品番号", "ラベルキー", "払出予定伝票日付"];
const PRODUCT_NUMBER_HEADER = "製品番号";

const state = {
  masterRows: [], masterInfo: null, labelIndex: new Map(), containerIndex: new Map(),
  readLabelKeys: new Set(), processedResults: new Map(), history: [],
  targetStartDate: "", targetEndDate: "", currentDepartment: null, workerCode: "",
  mode: "container", pendingSpdLabel: null, scannerBuffer: "", scannerTimer: null,
  backupDirectoryHandle: null, backupStatus: "checking", backupReason: "", backupPreparation: false,
  historySaveError: "", historySaving: false, failedHistoryRecord: null, workSessionId: "", backupSetupBusy: false, initializing: false
};
let successSound = null;
let productSuccessSound = null;
let alertSound = null;
let completionSound = null;
let historyDbPromise = null;
let elements = {};
let barcodePreviewReturnFocus = null;
let workerDialogReturnFocus = null;
let departmentSearchReturnFocus = null;
let adminPasswordReturnFocus = null;
let historyRestoreReturnFocus = null;
let pendingHistoryRestorePlan = null;
let backupWriteQueue = Promise.resolve();
const pendingHistoryBackupIds = new Set();
let historyPersistenceQueue = Promise.resolve();
let workerConfirmBusy = false;

function normalizeHeader(value) { return String(value ?? "").replace(/^\uFEFF/, "").trim(); }
function normalizeValue(value) { return String(value ?? "").trim(); }
function normalizeWorkerCode(value) {
  return normalizeValue(value).replace(/[！-～]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xFEE0));
}
// IMEの確定Enterを記憶し、compositionend後の最終inputを待って一度だけ送信する。
function bindWorkerCodeInput(input, confirm, isOpen, schedule = setTimeout, cancel = clearTimeout) {
  let composing = false, pendingEnter = false, timer = null;
  const reset = () => { composing = false; pendingEnter = false; if (timer !== null) cancel(timer); timer = null; };
  const submit = () => { if (!isOpen()) return; input.value = normalizeWorkerCode(input.value); confirm(); };
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => {
    composing = false;
    if (pendingEnter) timer = schedule(() => { timer = null; pendingEnter = false; submit(); }, 0);
  });
  input.addEventListener("input", (event) => {
    if (!composing && !event.isComposing) input.value = normalizeWorkerCode(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.code !== "Enter" && event.code !== "NumpadEnter") return;
    event.stopPropagation();
    if (event.repeat) { event.preventDefault(); return; }
    if (composing || event.isComposing) { pendingEnter = true; return; }
    event.preventDefault();
    if (timer !== null) return;
    pendingEnter = false; submit();
  });
  return { reset };
}
let workerInputController = null;
function hasWorkerCode() { return Boolean(normalizeWorkerCode(state.workerCode)); }
function setWorkerCode(value) {
  if (!state.masterInfo || !state.masterRows.length) return { ok: false, code: "NO_MASTER", title: "マスター未読込", message: "先にラベルマスタ.tsvを読み込んでください。" };
  if (!state.currentDepartment) return { ok: false, code: "NO_DEPARTMENT", title: "部署未指定", message: "先にオリコンラベルまたは部署検索で部署を指定してください。" };
  const workerCode = normalizeWorkerCode(value);
  if (!workerCode) return { ok: false, code: "WORKER_CODE_REQUIRED", title: "作業者コード未入力", message: "作業者コードを入力または読み取ってください。" };
  state.workerCode = workerCode; saveState();
  return { ok: true, code: "WORKER_SELECTED", workerCode };
}
function normalizeLabelKey(value) { return normalizeValue(value).replace(/\s+/g, ""); }
function getProductNumber(row) { return normalizeValue(row?.[PRODUCT_NUMBER_HEADER]) || "―"; }

// 通常のCode128 Code Set B。GS1用FNC1は追加せず、入力文字列だけを符号化する。
function getCode128BValues(value) {
  const text = String(value ?? "");
  if (!text || !/^[\x20-\x7E]+$/.test(text)) throw new Error("Code128には半角英数字・記号を指定してください。");
  const dataValues = [...text].map((character) => character.charCodeAt(0) - 32);
  const checksum = (104 + dataValues.reduce((sum, code, index) => sum + code * (index + 1), 0)) % 103;
  return [104, ...dataValues, checksum, 106];
}
function getCode128ModuleRuns(value) {
  const values = getCode128BValues(value);
  return { values, patterns: values.map((code) => CODE128_PATTERNS[code]) };
}
function renderCode128Svg(svg, value) {
  const { values, patterns } = getCode128ModuleRuns(value), quietZone = 12;
  const barcodeModules = patterns.reduce((total, pattern) => total + [...pattern].reduce((sum, width) => sum + Number(width), 0), 0);
  const totalModules = quietZone * 2 + barcodeModules;
  svg.replaceChildren(); svg.setAttribute("viewBox", `0 0 ${totalModules} 55`); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `Code128バーコード ${value}`); svg.setAttribute("data-code128-values", values.join(","));
  let x = quietZone;
  patterns.forEach((pattern) => {
    [...pattern].forEach((width, index) => {
      const moduleWidth = Number(width);
      if (index % 2 === 0) { const bar = document.createElementNS("http://www.w3.org/2000/svg", "rect"); bar.setAttribute("x", x); bar.setAttribute("y", "0"); bar.setAttribute("width", moduleWidth); bar.setAttribute("height", "55"); bar.setAttribute("fill", "#000"); svg.append(bar); }
      x += moduleWidth;
    });
  });
  return { values, totalModules, quietZone };
}

function splitTsvRecords(text) {
  const records = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === "\t") { row.push(cell); cell = ""; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) records.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("TSV内の引用符が閉じられていません。");
  if (cell !== "" || row.length) { row.push(cell); if (row.some((value) => value !== "")) records.push(row); }
  return records;
}

function isValidDateKey(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// 現調くんと同じく、13桁JANはチェックデジットを除いた先頭12桁で比較する。
function normalizeJanForComparison(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 13) return digits.slice(0, 12);
  if (digits.length === 12) return digits;
  return "";
}

function parseTsv(text) {
  const records = splitTsvRecords(String(text ?? "").replace(/^\uFEFF/, ""));
  if (records.length < 2) throw new Error("TSVに見出し行またはデータ行がありません。");
  const headers = records[0].map(normalizeHeader);
  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicates.length) throw new Error(`同じ見出しが複数あります：${[...new Set(duplicates)].join("、")}`);
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`必須列がありません：${missing.join("、")}`);
  const rows = [], errors = [];
  records.slice(1).forEach((record, recordIndex) => {
    const line = recordIndex + 2;
    if (record.length > headers.length && record.slice(headers.length).some((value) => normalizeValue(value))) {
      errors.push(`${line}行目：見出し数を超えるデータがあります。`); return;
    }
    const row = {};
    headers.forEach((header, index) => { if (header) row[header] = normalizeValue(record[index]); });
    const empty = REQUIRED_HEADERS.filter((header) => !row[header]);
    if (empty.length) { errors.push(`${line}行目：必須項目が空欄です（${empty.join("、")}）。`); return; }
    if (!isValidDateKey(row["払出予定伝票日付"])) { errors.push(`${line}行目：払出予定伝票日付「${row["払出予定伝票日付"]}」がyyyyMMdd形式の正しい日付ではありません。`); return; }
    // JANコードは任意。値がある場合だけ、照合可能な形式かを検証する。
    if (normalizeValue(row["JANコード"]) && !normalizeJanForComparison(row["JANコード"])) { errors.push(`${line}行目：JANコード「${row["JANコード"]}」を12桁比較値へ変換できません。`); return; }
    row["ラベルキー"] = normalizeLabelKey(row["ラベルキー"]);
    row.__lineNumber = line;
    rows.push(row);
  });
  if (errors.length) throw new Error(`${errors.slice(0, 5).join("\n")}${errors.length > 5 ? `\nほか${errors.length - 5}件のエラーがあります。` : ""}`);
  if (!rows.length) throw new Error("有効なデータ行がありません。");
  return { headers, rows };
}

function removeLeadingZeros(value) { const normalized = String(value).replace(/^0+/, ""); return normalized || "0"; }
function buildLabelKey(first, second, third) {
  if (!/^\d{15}$/.test(first) || !/^\d{4}$/.test(second) || !/^\d{3}$/.test(third)) throw new Error("QRのラベルキー部分が不正です。");
  return [first, second, third].map(removeLeadingZeros).join("-");
}
function normalizeQr(rawValue) {
  const raw = normalizeValue(rawValue);
  if (!/^\d{32}$/.test(raw)) return { ok: false, code: "QR_FORMAT", title: "QR形式エラー", message: "SPDラベルQRは数字32桁で読み取ってください。" };
  try { return { ok: true, raw, centerCode: raw.slice(0, 10), labelKey: buildLabelKey(raw.slice(10, 25), raw.slice(25, 29), raw.slice(29, 32)) }; }
  catch (error) { return { ok: false, code: "QR_FORMAT", title: "QR形式エラー", message: error.message }; }
}
function getExpectedCenterCode(facilityName) {
  const normalizedName = normalizeValue(facilityName);
  return Object.prototype.hasOwnProperty.call(FACILITY_CENTER_MAP, normalizedName) ? FACILITY_CENTER_MAP[normalizedName] : "";
}

function containerIndexKey(facilityCode, departmentCode) { return `${facilityCode}\u001f${departmentCode}`; }
function rebuildIndexes() {
  state.labelIndex = new Map(); state.containerIndex = new Map();
  state.masterRows.forEach((row) => {
    const labelKey = row["ラベルキー"], key = containerIndexKey(row["施設コード"], row["部署コード"]);
    if (!state.labelIndex.has(labelKey)) state.labelIndex.set(labelKey, []);
    if (!state.containerIndex.has(key)) state.containerIndex.set(key, []);
    state.labelIndex.get(labelKey).push(row); state.containerIndex.get(key).push(row);
  });
}
function findLabel(labelKey) {
  const candidates = state.labelIndex.get(normalizeLabelKey(labelKey)) || [];
  if (!candidates.length) return { ok: false, code: "NOT_FOUND", candidates };
  if (candidates.length > 1) return { ok: false, code: "AMBIGUOUS_LABEL", candidates };
  return { ok: true, row: candidates[0] };
}
function uniqueDepartmentCandidates(rows) {
  const unique = new Map();
  rows.forEach((row) => { const key = [row["施設コード"], row["施設名称"], row["部署コード"], row["部署名称"]].join("\u001f"); if (!unique.has(key)) unique.set(key, row); });
  return [...unique.values()];
}
function departmentFromRow(row) {
  return { facilityCode: row["施設コード"], facilityName: row["施設名称"], departmentCode: row["部署コード"], departmentName: row["部署名称"] };
}
function getMasterDepartments() { return uniqueDepartmentCandidates(state.masterRows).map(departmentFromRow); }
function selectDepartment(department) {
  if (state.historySaving || state.historySaveError) return historyStorageBlockResult();
  if (!state.masterInfo || !state.masterRows.length) return { ok: false, code: "NO_MASTER", title: "マスター未読込", message: "先にラベルマスタ.tsvを読み込んでください。" };
  const key = containerIndexKey(normalizeValue(department?.facilityCode), normalizeValue(department?.departmentCode));
  const candidates = uniqueDepartmentCandidates(state.containerIndex.get(key) || []).filter((row) => row["施設名称"] === normalizeValue(department?.facilityName) && row["部署名称"] === normalizeValue(department?.departmentName));
  if (candidates.length !== 1) return { ok: false, code: "DEPARTMENT_NOT_FOUND", title: "部署を指定できません", message: "選択した施設・部署をマスターから一意に特定できません。" };
  state.currentDepartment = departmentFromRow(candidates[0]);
  state.backupPreparation = false;
  state.workerCode = ""; state.pendingSpdLabel = null; state.mode = "spd"; saveState();
  return { ok: true, code: "DEPARTMENT_OK", department: state.currentDepartment };
}
function parseContainerBarcode(rawValue) {
  const raw = normalizeValue(rawValue);
  if (!/^\d{20}$/.test(raw)) return { ok: false, code: "CONTAINER_FORMAT", title: "オリコン形式エラー", message: "オリコンラベルは施設コード10桁＋部署コード10桁の数字20桁です。" };
  return { ok: true, raw, facilityCode: raw.slice(0, 10), departmentCode: raw.slice(10) };
}
function setContainerDepartment(rawValue) {
  if (!state.masterInfo || !state.masterRows.length) return { ok: false, code: "NO_MASTER", title: "マスター未読込", message: "先にラベルマスタ.tsvを読み込んでください。" };
  const parsed = parseContainerBarcode(rawValue);
  if (!parsed.ok) return parsed;
  const candidates = uniqueDepartmentCandidates(state.containerIndex.get(containerIndexKey(parsed.facilityCode, parsed.departmentCode)) || []);
  if (!candidates.length) return { ok: false, code: "CONTAINER_NOT_FOUND", title: "オリコンがマスターに存在しません", message: `施設コード：${parsed.facilityCode} ／ 部署コード：${parsed.departmentCode}` };
  if (candidates.length > 1) return { ok: false, code: "AMBIGUOUS_DEPARTMENT", title: "オリコンを一意に特定できません", message: "施設コード＋部署コードが複数の施設・部署名称に対応しています。マスターを確認してください。" };
  const selected = selectDepartment(departmentFromRow(candidates[0]));
  return selected.ok ? { ...selected, code: "CONTAINER_OK" } : selected;
}
function clearContainerDepartment() { state.currentDepartment = null; state.workerCode = ""; state.pendingSpdLabel = null; state.mode = "container"; saveState(); }
function isCurrentDepartmentAvailable() {
  if (!state.currentDepartment) return false;
  const candidates = uniqueDepartmentCandidates(state.containerIndex.get(containerIndexKey(state.currentDepartment.facilityCode, state.currentDepartment.departmentCode)) || []);
  if (candidates.length !== 1) return false;
  const row = candidates[0];
  return row["施設コード"] === state.currentDepartment.facilityCode && row["施設名称"] === state.currentDepartment.facilityName
    && row["部署コード"] === state.currentDepartment.departmentCode && row["部署名称"] === state.currentDepartment.departmentName;
}
function reconcileCurrentDepartment() {
  if (state.currentDepartment && !isCurrentDepartmentAvailable()) { state.currentDepartment = null; state.pendingSpdLabel = null; state.mode = "container"; return false; }
  return Boolean(state.currentDepartment);
}

function parseDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  date.setHours(0, 0, 0, 0); return date;
}
function parseMasterDate(value) { if (!isValidDateKey(value)) return null; const date = new Date(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))); date.setHours(0, 0, 0, 0); return date; }
function validateTargetPeriod(startValue = state.targetStartDate, endValue = state.targetEndDate) {
  if (!startValue) return { ok: false, code: "START_REQUIRED", message: "開始日を指定してください。" };
  if (!endValue) return { ok: false, code: "END_REQUIRED", message: "終了日を指定してください。" };
  const startDate = parseDateInput(startValue), endDate = parseDateInput(endValue);
  if (!startDate) return { ok: false, code: "START_INVALID", message: "開始日が正しくありません。" };
  if (!endDate) return { ok: false, code: "END_INVALID", message: "終了日が正しくありません。" };
  if (startDate > endDate) return { ok: false, code: "RANGE_REVERSED", message: "開始日は終了日以前の日付を指定してください。" };
  return { ok: true, startDate, endDate };
}
function isRowInTargetPeriod(row) { const period = validateTargetPeriod(), date = parseMasterDate(row?.["払出予定伝票日付"]); return Boolean(period.ok && date && date >= period.startDate && date <= period.endDate); }
function matchesCurrentDepartment(row, department = state.currentDepartment) {
  if (!department) return true;
  return row["施設コード"] === department.facilityCode && row["施設名称"] === department.facilityName
    && row["部署コード"] === department.departmentCode && row["部署名称"] === department.departmentName;
}
function getCurrentTargetLabels() { return validateTargetPeriod().ok ? state.masterRows.filter((row) => isRowInTargetPeriod(row) && matchesCurrentDepartment(row)) : []; }
function getUniqueLabelRows(rows) { const unique = new Map(); rows.forEach((row) => { if (!unique.has(row["ラベルキー"])) unique.set(row["ラベルキー"], row); }); return [...unique.values()]; }
function getUnreadLabels() { return getUniqueLabelRows(getCurrentTargetLabels()).filter((row) => !state.readLabelKeys.has(row["ラベルキー"])); }
function getTargetCounts() {
  const keys = new Set(getCurrentTargetLabels().map((row) => row["ラベルキー"]));
  const readKeys = [...keys].filter((key) => state.readLabelKeys.has(key));
  const skip = readKeys.filter((key) => state.processedResults.get(key) === "SKIP").length;
  return { target: keys.size, read: readKeys.length, unread: keys.size - readKeys.length, ok: readKeys.length - skip, skip };
}

function validateSpdLabel(rawValue) {
  if (!state.masterInfo || !state.masterRows.length) return { ok: false, code: "NO_MASTER", title: "マスター未読込", message: "先にラベルマスタ.tsvを読み込んでください。" };
  if (!state.currentDepartment) return { ok: false, code: "NO_DEPARTMENT", title: "オリコン未指定", message: "先にオリコンラベルを読み取ってください。" };
  if (!hasWorkerCode()) return { ok: false, code: "NO_WORKER", title: "作業者未指定", message: "作業者コードを指定してください。" };
  const period = validateTargetPeriod();
  if (!period.ok) return { ok: false, code: "TARGET_PERIOD_ERROR", title: "対象期間エラー", message: period.message };
  const qr = normalizeQr(rawValue);
  if (!qr.ok) return qr;
  const found = findLabel(qr.labelKey);
  if (found.code === "NOT_FOUND") return { ok: false, code: found.code, title: "マスターに存在しません", message: `ラベルキー：${qr.labelKey}`, labelKey: qr.labelKey, spdRaw: qr.raw };
  if (found.code === "AMBIGUOUS_LABEL") return { ok: false, code: found.code, title: "ラベルを特定できません", message: `ラベルキー「${qr.labelKey}」がマスターに複数あります。`, labelKey: qr.labelKey, spdRaw: qr.raw };
  const row = found.row, expectedCenterCode = normalizeValue(state.masterInfo.centerCode);
  if (!expectedCenterCode) return { ok: false, code: "MASTER_CENTER_CODE_MISSING", title: "センターコード未設定", message: "マスターを再度取り込んでください。", row, labelKey: qr.labelKey, spdRaw: qr.raw };
  if (qr.centerCode !== expectedCenterCode) return { ok: false, code: "CENTER_MISMATCH", title: "センターコード不一致", message: `読取：${qr.centerCode} ／ 正：${expectedCenterCode}`, row, labelKey: qr.labelKey, spdRaw: qr.raw };
  if (!matchesCurrentDepartment(row)) return { ok: false, code: "DEPARTMENT_MISMATCH", title: "部署違い", message: "オリコンとSPDラベルの施設・部署が一致しません。", row, labelKey: qr.labelKey, spdRaw: qr.raw };
  if (!isRowInTargetPeriod(row)) return { ok: false, code: "OUTSIDE_PERIOD", title: "対象期間外", message: `払出予定伝票日付：${row["払出予定伝票日付"]}`, row, labelKey: qr.labelKey, spdRaw: qr.raw };
  if (state.readLabelKeys.has(qr.labelKey)) return { ok: false, code: "DUPLICATE", title: "二重読取", message: `ラベルキー：${qr.labelKey}`, row, labelKey: qr.labelKey, spdRaw: qr.raw };
  return { ok: true, code: "SPD_PENDING", title: "SPDラベル受付", message: "商品のJAN / GS1-128を読み取ってください。", row, labelKey: qr.labelKey, spdRaw: qr.raw };
}
function setPendingSpdLabel(result, now = new Date()) {
  if (!result?.ok || !result.row || !result.labelKey) return false;
  state.pendingSpdLabel = { row: result.row, labelKey: result.labelKey, spdRaw: result.spdRaw || "", spdReadAt: now.toISOString(), lastProductAttempt: null };
  state.mode = "product"; saveState(); return true;
}
function acceptPendingSpdLabel(result, effects = {}) {
  const accepted = setPendingSpdLabel(result);
  if (accepted) (effects.playSuccess || playSuccessSound)();
  return accepted;
}
function cancelPendingSpdLabel() { if (!state.pendingSpdLabel) return false; state.pendingSpdLabel = null; state.mode = state.currentDepartment ? "spd" : "container"; saveState(); return true; }

function detectProductBarcodeType(rawValue) {
  const raw = normalizeValue(rawValue), digits = raw.replace(/^\]C1/, "").replace(/\D/g, "");
  if ((raw.startsWith("]C1") || digits.startsWith("01")) && digits.length >= 15) return "GS1-128";
  if (/^\d{12,13}$/.test(raw)) return "JAN";
  return "UNKNOWN";
}
// 現調くんのparseJANに合わせ、AI(01)の3文字目から12桁を抽出する。
function parseGs1Barcode(rawValue) {
  const raw = normalizeValue(rawValue), digits = raw.replace(/^\]C1/, "").replace(/\D/g, "");
  if (!digits.startsWith("01") || digits.length < 15) return { ok: false, code: "GS1_PARSE_ERROR", message: "GS1-128のAI(01)から商品コードを取得できません。" };
  const comparisonJan = digits.substring(3, 15);
  if (!/^\d{12}$/.test(comparisonJan)) return { ok: false, code: "GS1_PARSE_ERROR", message: "GS1-128の商品コードが不正です。" };
  const gtin = digits.length >= 16 ? digits.slice(2, 16) : "";
  let remaining = digits.slice(16), expiryDate = "", lotNumber = "";
  if (remaining.startsWith("17") && remaining.length >= 8) { expiryDate = remaining.slice(2, 8); remaining = remaining.slice(8); }
  if (remaining.startsWith("10")) lotNumber = remaining.slice(2);
  return { ok: true, raw, gtin, jan: comparisonJan, comparisonJan, expiryDate, lotNumber };
}
function extractJanFromBarcode(rawValue) {
  const raw = normalizeValue(rawValue), type = detectProductBarcodeType(raw), readAt = new Date().toISOString();
  if (type === "JAN") return { ok: true, type, raw, readAt, jan: raw, comparisonJan: normalizeJanForComparison(raw), gtin: "", expiryDate: "", lotNumber: "" };
  if (type === "GS1-128") { const parsed = parseGs1Barcode(raw); return parsed.ok ? { ...parsed, type, readAt } : { ...parsed, type, raw, readAt }; }
  return { ok: false, type: "不明", raw, readAt, code: "PRODUCT_FORMAT", message: "JANまたはGS1-128として解析できません。" };
}
function validateAlternateJanTable(table) {
  if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error("追加JAN表の形式が不正です。");
  const entries = Object.keys(table).sort().map((code) => {
    const item = table[code];
    if (!code || code.trim() !== code || !item || typeof item !== "object" || !Array.isArray(item.alternateJans)
      || !item.alternateJans.every((jan) => typeof jan === "string" && /^\d{12,13}$/.test(jan))
      || ["productNo", "name", "spec"].some((key) => item[key] !== undefined && typeof item[key] !== "string")) {
      throw new Error(`追加JAN表の商品コード「${code}」の設定が不正です。`);
    }
    return [code, { productNo: item.productNo || "", name: item.name || "", spec: item.spec || "",
      alternateJans: [...new Set(item.alternateJans)].sort() }];
  });
  return Object.fromEntries(entries);
}
function restoreAlternateJans(fallback) {
  try {
    const saved = globalThis.localStorage?.getItem?.(ALTERNATE_JAN_STORAGE_KEY);
    if (saved) return validateAlternateJanTable(JSON.parse(saved));
  } catch (error) { console.info("保存済み追加JAN表を取得できないため、同梱の表を使用します。", error); }
  try {
    const verified = validateAlternateJanTable(fallback);
    // 初回HTMLのスクリプト読込後に通信が切れても、その正常な表を次回起動へ残す。
    try { globalThis.localStorage?.setItem(ALTERNATE_JAN_STORAGE_KEY, JSON.stringify(verified)); }
    catch (error) { console.info("初回の追加JAN表を端末に保存できません。", error); }
    return fallback;
  }
  catch (error) { console.error("追加JAN表を読み込めません。通常JAN照合を継続します。", error); return {}; }
}
function detectAlternateJanUpdate(table) {
  const verified = validateAlternateJanTable(table);
  // 正常に取得・検証できた表だけを保存する。作業中の照合表はここでは変更しない。
  try { globalThis.localStorage?.setItem(ALTERNATE_JAN_STORAGE_KEY, JSON.stringify(verified)); }
  catch (error) { console.error("追加JAN表を端末に保存できません。", error); }
  try {
    if (typeof navigator !== "undefined") navigator.serviceWorker?.controller?.postMessage({ type: "SAVE_ALTERNATE_JANS", table: verified });
  } catch (error) { console.info("追加JAN表のオフラインキャッシュを更新できません。端末保存の表を使用します。", error); }
  alternateJanUpdate.table = JSON.stringify(verified) === JSON.stringify(validateAlternateJanTable(ALTERNATE_JANS)) ? null : verified;
  if (alternateJanUpdate.table && isAppUpdateSafe() && !appUpdate.version && !appUpdate.reloading) applyAppUpdate(true);
  else {
    renderAppUpdate();
    if (alternateJanUpdate.table && !appUpdate.timer) appUpdate.timer = window.setInterval(renderAppUpdate, 500);
    if (!alternateJanUpdate.table && !appUpdate.version) clearAppUpdate();
  }
}
async function checkAlternateJanUpdate() {
  if (alternateJanUpdate.checking) return alternateJanUpdate.checking;
  if (appInitializationPromise) await appInitializationPromise;
  if (alternateJanUpdate.checking) return alternateJanUpdate.checking;
  alternateJanUpdate.checking = new Promise((resolve) => {
    const script = document.createElement("script"), previous = globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE;
    // 固定URLのブラウザキャッシュも回避。SWはこのファイルだけno-storeのネットワーク優先。
    script.src = `./alternate-jans.js?check=${Date.now()}`;
    script.onload = () => {
      try {
        if (globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE === previous) throw new Error("追加JAN表の読込結果を取得できません。");
        detectAlternateJanUpdate(globalThis.ALTERNATE_JAN_BY_PRODUCT_CODE);
      } catch (error) { console.error("追加JAN表の最新版を使用できません。前回の表を継続します。", error); }
      script.remove(); resolve();
    };
    script.onerror = () => { console.info("追加JAN表の最新版を取得できないため、前回の表を継続します。"); script.remove(); resolve(); };
    document.head.append(script);
  });
  try { await alternateJanUpdate.checking; } finally { alternateJanUpdate.checking = null; }
}
function getAlternateJans(row) {
  const productCode = normalizeValue(row["商品コード"]);
  if (!productCode || !Object.prototype.hasOwnProperty.call(ALTERNATE_JANS, productCode)) return [];
  const candidates = ALTERNATE_JANS[productCode]?.alternateJans;
  return Array.isArray(candidates) ? candidates.filter((jan) => typeof jan === "string" && /^\d{12,13}$/.test(jan)) : [];
}
function matchesAlternateJan(row, comparisonJan) {
  return getAlternateJans(row).some((jan) => normalizeJanForComparison(jan) === comparisonJan);
}
function validateProductBarcode(rawValue) {
  if (!hasWorkerCode()) return { ok: false, code: "NO_WORKER", title: "作業者未指定", message: "作業者コードを指定してください。" };
  if (!state.pendingSpdLabel || state.mode !== "product") return { ok: false, code: "NO_PENDING", title: "SPDラベル未読取", message: "先にSPDラベルを読み取ってください。" };
  if (!state.masterInfo || !state.currentDepartment || !validateTargetPeriod().ok
    || !isRowInTargetPeriod(state.pendingSpdLabel.row) || !matchesCurrentDepartment(state.pendingSpdLabel.row)) {
    return { ok: false, code: "PENDING_CONDITION_CHANGED", title: "照合条件変更", message: "対象期間またはオリコン指定が変わりました。SPDラベル読取を取消して、再度読み取ってください。", pending: state.pendingSpdLabel };
  }
  const product = extractJanFromBarcode(rawValue);
  if (!product.ok) return { ...product, title: "商品バーコードエラー", pending: state.pendingSpdLabel };
  const row = state.pendingSpdLabel.row, masterJanRaw = normalizeValue(row["JANコード"]);
  const masterJan = normalizeJanForComparison(masterJanRaw);
  // 空欄・空白・列なしは未登録として扱い、追加JANがあれば通常の比較へ進む。
  if (!masterJanRaw && !getAlternateJans(row).length) return { ok: false, code: "MASTER_JAN_MISSING", title: "JAN未登録商品", message: "ラベルマスタにJANが登録されていません。SKIPで確認してください。", product, pending: state.pendingSpdLabel };
  if (masterJanRaw && !masterJan) return { ok: false, code: "MASTER_JAN_INVALID", title: "マスターJAN不正", message: "TSVのJANコードを12桁比較値へ変換できません。", product, pending: state.pendingSpdLabel };
  if (product.comparisonJan !== masterJan && !matchesAlternateJan(state.pendingSpdLabel.row, product.comparisonJan)) return { ok: false, code: "PRODUCT_MISMATCH", title: "商品違い", message: "SPDラベルの商品と読み取った商品が一致しません。", product, pending: state.pendingSpdLabel };
  return { ok: true, code: "PRODUCT_MATCH", title: "OK", message: "SPDラベルと商品が一致しました。", product, pending: state.pendingSpdLabel };
}

function formatLocalDateTime(isoValue) { if (!isoValue) return "―"; const date = new Date(isoValue); return Number.isNaN(date.getTime()) ? "―" : new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "medium" }).format(date); }
function createHistoryId(cryptoRef = globalThis.crypto) {
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function createHistoryRecord({ result, detail = "", pending = null, product = null, skipReason = "", employeeCode = state.workerCode, completedAt = "" }) {
  const source = pending || state.pendingSpdLabel, row = source?.row || {}, now = new Date().toISOString();
  return {
    historyId: createHistoryId(),
    workSessionId: state.workSessionId,
    eventAt: now, completedAt, spdReadAt: source?.spdReadAt || "", productReadAt: product?.readAt || (product ? now : ""),
    facilityCode: row["施設コード"] || state.currentDepartment?.facilityCode || "", facilityName: row["施設名称"] || state.currentDepartment?.facilityName || "",
    departmentCode: row["部署コード"] || state.currentDepartment?.departmentCode || "", departmentName: row["部署名称"] || state.currentDepartment?.departmentName || "",
    plannedDate: row["払出予定伝票日付"] || "", labelKey: source?.labelKey || "", productNumber: row["製品番号"] || "", productName: row["品名"] || "",
    masterJan: row["JANコード"] || "", scannedJan: product?.jan || "", productBarcodeType: product?.type || "",
    spdRaw: source?.spdRaw || "", productRaw: product?.raw || "", result, detail, skipReason, employeeCode: normalizeValue(employeeCode)
  };
}
function openHistoryDb(indexedDbRef = globalThis.indexedDB) {
  if (!indexedDbRef) return Promise.resolve(null);
  if (historyDbPromise) return historyDbPromise;
  historyDbPromise = new Promise((resolve, reject) => {
    const request = indexedDbRef.open(HISTORY_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) { const store = db.createObjectStore(HISTORY_STORE_NAME, { keyPath: "id", autoIncrement: true }); store.createIndex("eventAt", "eventAt"); store.createIndex("result", "result"); }
      if (!db.objectStoreNames.contains(HISTORY_SETTINGS_STORE_NAME)) db.createObjectStore(HISTORY_SETTINGS_STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return historyDbPromise;
}
async function getHistorySetting(key) {
  const db = await openHistoryDb();
  if (!db) return null;
  return new Promise((resolve, reject) => { const request = db.transaction(HISTORY_SETTINGS_STORE_NAME, "readonly").objectStore(HISTORY_SETTINGS_STORE_NAME).get(key); request.onsuccess = () => resolve(request.result?.value ?? null); request.onerror = () => reject(request.error); });
}
async function setHistorySetting(key, value) {
  const db = await openHistoryDb();
  if (!db) throw new Error("ブラウザ保存領域を利用できません。");
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_SETTINGS_STORE_NAME, "readwrite"), request = transaction.objectStore(HISTORY_SETTINGS_STORE_NAME).put({ key, value });
    request.onsuccess = () => {};
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error("設定を保存できません。"));
  });
}
async function saveScanHistory(record) {
  if (!record.historyId) record.historyId = createHistoryId();
  state.historySaving = true;
  try {
    const db = await openHistoryDb();
    if (!db) throw new Error("ブラウザの履歴保存領域を利用できません。");
    // 履歴とCSV未保存IDを同じトランザクションで確定する。外部CSVの成功とは分離する。
    const persist = async () => new Promise((resolve, reject) => {
      const backup = isHistoryBackupSupported();
      const nextIds = new Set(pendingHistoryBackupIds);
      if (backup) nextIds.add(record.historyId);
      const transaction = db.transaction([HISTORY_STORE_NAME, HISTORY_SETTINGS_STORE_NAME], "readwrite");
      const request = transaction.objectStore(HISTORY_STORE_NAME).add(record);
      let id;
      request.onsuccess = () => { id = request.result; };
      if (backup) transaction.objectStore(HISTORY_SETTINGS_STORE_NAME).put({ key: PENDING_BACKUP_IDS_KEY, value: [...nextIds] });
      transaction.oncomplete = () => { record.id = id; if (backup) pendingHistoryBackupIds.add(record.historyId); resolve(); };
      transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error("履歴を保存できません。"));
    });
    const saving = historyPersistenceQueue.then(persist);
    historyPersistenceQueue = saving.catch(() => {});
    await saving;
    state.history.push(record); renderHistoryIfReady(); renderShippingBackupGate();
    void enqueueHistoryBackup(record);
    return record;
  } catch (error) {
    state.historySaveError = error.message || "履歴を保存できません。";
    state.failedHistoryRecord = record;
    showResult("ng", "履歴保存失敗・作業停止", "ブラウザ内履歴を保存できません。読取状態は保持しています。再読込やマスター再取込をせず、保存を再試行してください。", []);
    throw error;
  } finally { state.historySaving = false; renderShippingBackupGate(); }
}
async function loadScanHistory() {
  try {
    const db = await openHistoryDb();
    if (!db) throw new Error("内部履歴保存領域を利用できません。");
    state.history = await new Promise((resolve, reject) => { const request = db.transaction(HISTORY_STORE_NAME, "readonly").objectStore(HISTORY_STORE_NAME).getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error); });
  } catch (error) { state.historySaveError = "内部履歴を読み込めません。管理者へ連絡してください。"; console.error("読取履歴を読み込めません。", error); }
  renderHistoryIfReady(); return state.history;
}
async function loadPendingHistoryBackupIds() {
  try {
    const saved = await getHistorySetting(PENDING_BACKUP_IDS_KEY);
    pendingHistoryBackupIds.clear();
    if (Array.isArray(saved)) saved.map(normalizeValue).filter(Boolean).forEach((historyId) => pendingHistoryBackupIds.add(historyId));
  } catch (error) { console.error("保留中の履歴バックアップ情報を読み込めません。", error); }
  return pendingHistoryBackupIds;
}
async function clearScanHistory() {
  if (pendingHistoryBackupIds.size) throw new Error("バックアップ保留履歴があります。バックアップ完了後に削除してください。");
  const db = await openHistoryDb();
  if (db) await new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE_NAME, "readwrite"), request = transaction.objectStore(HISTORY_STORE_NAME).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || request.error || new Error("履歴を削除できません。"));
  });
  state.history = []; renderHistoryIfReady();
}
function saveNgHistory(result, product = null) {
  const pending = result.pending || (result.row ? { row: result.row, labelKey: result.labelKey || "", spdRaw: result.spdRaw || "", spdReadAt: "" } : state.pendingSpdLabel);
  return saveScanHistory(createHistoryRecord({ result: "NG", detail: result.title || result.code || "NG", pending, product }));
}
function didCompleteTarget(before, after) { return Boolean(state.currentDepartment) && validateTargetPeriod().ok && before.target > 0 && before.unread > 0 && after.unread === 0; }
async function completeItemCheck(rawValue, effects = {}) {
  if (state.historySaveError || state.historySaving) return historyStorageBlockResult();
  const validation = validateProductBarcode(rawValue);
  if (!validation.ok) {
    if (state.pendingSpdLabel && validation.product) state.pendingSpdLabel.lastProductAttempt = validation.product;
    saveState();
    try { await saveNgHistory(validation, validation.product || null); } catch { return historyStorageBlockResult(); }
    (effects.playAlert || playAlertSound)();
    return { ...validation, completed: false, counts: getTargetCounts() };
  }
  const beforeCounts = getTargetCounts(), pending = state.pendingSpdLabel;
  const record = createHistoryRecord({ result: "OK", detail: "商品一致", pending, product: validation.product, completedAt: new Date().toISOString() });
  try { await saveScanHistory(record); } catch { return historyStorageBlockResult(); }
  state.readLabelKeys.add(pending.labelKey); state.processedResults.set(pending.labelKey, "OK");
  state.pendingSpdLabel = null; state.mode = "spd"; saveState();
  const afterCounts = getTargetCounts(), targetCompleted = didCompleteTarget(beforeCounts, afterCounts);
  if (targetCompleted) (effects.playCompletion || playCompletionSound)();
  else (effects.playProductSuccess || effects.playSuccess || playProductSuccessSound)();
  return { ...validation, completed: true, targetCompleted, beforeCounts, afterCounts, record };
}
function canSkip() {
  return Boolean(state.masterInfo && hasWorkerCode() && state.currentDepartment && state.pendingSpdLabel && state.mode === "product"
    && validateTargetPeriod().ok && isRowInTargetPeriod(state.pendingSpdLabel.row) && matchesCurrentDepartment(state.pendingSpdLabel.row));
}
function canConfirmSkip() {
  return Boolean(state.masterInfo && hasWorkerCode() && state.currentDepartment && state.pendingSpdLabel && state.mode === "employee"
    && validateTargetPeriod().ok && isRowInTargetPeriod(state.pendingSpdLabel.row) && matchesCurrentDepartment(state.pendingSpdLabel.row));
}
function startSkipProcess() {
  if (state.historySaving || state.historySaveError) return historyStorageBlockResult();
  if (!hasWorkerCode()) return { ok: false, code: "NO_WORKER", title: "作業者未指定", message: "作業者コードを指定してください。" };
  if (!canSkip()) return { ok: false, code: "SKIP_NOT_ALLOWED", title: "SKIPできません", message: "SPDラベル受付後の商品バーコード待ち状態でのみSKIPできます。" };
  state.mode = "employee"; saveState();
  return { ok: true, code: "SKIP_APPROVER_REQUIRED", title: "SKIP承認者コード待ち", message: "承認した作業リーダーの名札バーコードを読み取ってください。", pending: state.pendingSpdLabel };
}
async function executeSkip(approverCode, effects = {}) {
  if (state.historySaveError || state.historySaving) return historyStorageBlockResult();
  const employeeCode = normalizeWorkerCode(approverCode);
  if (!employeeCode) return { ok: false, code: "WORKER_CODE_REQUIRED", title: "承認者コード未入力", message: "SKIPを承認した作業リーダーの作業者コードを入力または読み取ってください。" };
  if (!canConfirmSkip()) return { ok: false, code: "SKIP_NOT_ALLOWED", title: "SKIPできません", message: "SKIP承認者コード待ち状態でのみ確定できます。" };
  const beforeCounts = getTargetCounts(), pending = state.pendingSpdLabel, product = pending.lastProductAttempt || null;
  const skipReason = normalizeValue(pending.row["JANコード"]) ? "作業者SKIP" : "マスターJANなし";
  const detail = skipReason === "マスターJANなし" ? "マスターJANなし・リーダー承認済み" : "作業リーダー承認SKIP";
  const record = createHistoryRecord({ result: "SKIP", detail, pending, product, skipReason, employeeCode, completedAt: new Date().toISOString() });
  try { await saveScanHistory(record); } catch { return historyStorageBlockResult(); }
  state.readLabelKeys.add(pending.labelKey); state.processedResults.set(pending.labelKey, "SKIP");
  state.pendingSpdLabel = null; state.mode = "spd"; saveState();
  const afterCounts = getTargetCounts(), completed = didCompleteTarget(beforeCounts, afterCounts);
  if (completed) (effects.playCompletion || playCompletionSound)();
  else (effects.playProductSuccess || playProductSuccessSound)();
  return { ok: true, code: "SKIP", title: "SKIP", message: "承認者コードを記録してSKIPを完了しました。", record, completed, beforeCounts, afterCounts };
}
function cancelSkipProcess() {
  if (!state.pendingSpdLabel || state.mode !== "employee") return false;
  state.mode = "product"; saveState(); return true;
}
function processProductScanValue(rawValue, effects = {}) {
  const value = normalizeValue(rawValue);
  return value === SKIP_COMMAND ? startSkipProcess() : completeItemCheck(value, effects);
}

function formatDateForDisplay(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.replaceAll("-", "/") : "―"; }
function keyToDateInput(value) { return /^\d{8}$/.test(value || "") ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : ""; }
function todayInputValue() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function getUniqueFacilityNames(rows) { return [...new Set(rows.map((row) => normalizeValue(row["施設名称"])).filter(Boolean))]; }
function getMasterFacilityName(rows) {
  const facilityNames = getUniqueFacilityNames(rows);
  if (facilityNames.length !== 1) throw new Error(`施設名称は1ファイルにつき1種類にしてください。検出数：${facilityNames.length}`);
  return facilityNames[0];
}
function getMasterFacilitySettings(rows) {
  const facilityName = getMasterFacilityName(rows);
  const centerCode = getExpectedCenterCode(facilityName);
  if (!centerCode) throw new Error(`未登録の施設名です。\n管理者へ連絡して、施設追加のプログラム修正を依頼してください。\n\n施設名：${facilityName}`);
  return { facilityName, centerCode };
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEYS.state, JSON.stringify({ readLabelKeys: [...state.readLabelKeys], processedResults: [...state.processedResults.entries()], targetStartDate: state.targetStartDate, targetEndDate: state.targetEndDate, currentDepartment: state.currentDepartment, workerCode: state.workerCode, workSessionId: state.workSessionId, masterFingerprint: state.masterInfo?.fingerprint || null }));
    return true;
  } catch (error) { console.error("作業状態の保存に失敗しました。", error); showImportMessage("ブラウザに作業状態を保存できませんでした。空き容量やSafariの設定を確認してください。", true); return false; }
}
function saveMaster(rows, info) { const headers = Object.keys(rows[0] || {}).filter((header) => header !== "__lineNumber"); const records = rows.map((row) => headers.map((header) => row[header] ?? "")); localStorage.setItem(STORAGE_KEYS.master, JSON.stringify({ formatVersion: 2, headers, records, info })); }
function restoreState() {
  state.targetStartDate = todayInputValue(); state.targetEndDate = todayInputValue();
  try {
    const savedMaster = JSON.parse(localStorage.getItem(STORAGE_KEYS.master) || "null");
    let restoredRows = null;
    if (savedMaster?.info && Array.isArray(savedMaster.records) && Array.isArray(savedMaster.headers)) restoredRows = savedMaster.records.map((record) => Object.fromEntries(savedMaster.headers.map((header, index) => [header, record[index] ?? ""])));
    else if (savedMaster?.info && Array.isArray(savedMaster.rows)) restoredRows = savedMaster.rows;
    if (restoredRows) { const facilitySettings = getMasterFacilitySettings(restoredRows); state.masterInfo = { ...savedMaster.info, ...facilitySettings }; state.masterRows = restoredRows; rebuildIndexes(); }
  } catch (error) { console.error("保存済みマスターを読み込めません。", error); localStorage.removeItem(STORAGE_KEYS.master); }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.state) || localStorage.getItem("spd-shipping-state-v1") || "null");
    if (saved) {
      const legacy = saved.targetDate || ""; state.targetStartDate = saved.targetStartDate || legacy || state.targetStartDate; state.targetEndDate = saved.targetEndDate || legacy || state.targetEndDate;
      if (state.masterInfo && saved.masterFingerprint === state.masterInfo.fingerprint) {
        state.readLabelKeys = new Set(Array.isArray(saved.readLabelKeys) ? saved.readLabelKeys : []);
        state.processedResults = new Map(Array.isArray(saved.processedResults) ? saved.processedResults : [...state.readLabelKeys].map((key) => [key, "OK"]));
        state.currentDepartment = saved.currentDepartment || null; reconcileCurrentDepartment();
        state.workerCode = normalizeWorkerCode(saved.workerCode);
        state.workSessionId = saved.workSessionId || createHistoryId();
      }
    }
  } catch (error) { console.error("保存済み作業状態を読み込めません。", error); localStorage.removeItem(STORAGE_KEYS.state); }
  // pendingは再起動後に別商品へ引き継がないよう、意図的に保存・復元しない。
  state.pendingSpdLabel = null; state.mode = state.currentDepartment ? "spd" : "container"; if (state.masterInfo) { state.workSessionId ||= createHistoryId(); saveState(); }
}
async function decodeMasterFile(file) { const buffer = await file.arrayBuffer(); try { return new TextDecoder("shift-jis", { fatal: true }).decode(buffer); } catch { throw new Error("TSVをCP932（Shift-JIS系）として読み込めませんでした。文字コードを確認してください。"); } }
async function loadMasterFile(file) {
  if (!file) throw new Error("TSVファイルが選択されていません。");
  if (!/\.tsv$/i.test(file.name)) throw new Error(".tsvファイルを選択してください。");
  const parsed = parseTsv(await decodeMasterFile(file)), dates = parsed.rows.map((row) => row["払出予定伝票日付"]).sort();
  const facilitySettings = getMasterFacilitySettings(parsed.rows);
  return { rows: parsed.rows, info: { fileName: file.name, ...facilitySettings, importedAt: new Date().toISOString(), rowCount: parsed.rows.length, maxDate: dates.at(-1), fingerprint: createFingerprint(file, parsed.rows) } };
}
function applyMasterData(rows, info) {
  const validatedInfo = { ...info, ...getMasterFacilitySettings(rows) };
  const today = todayInputValue();
  saveMaster(rows, validatedInfo); state.masterRows = rows; state.masterInfo = validatedInfo; rebuildIndexes();
  state.readLabelKeys = new Set(); state.processedResults = new Map(); state.currentDepartment = null; state.workerCode = ""; state.pendingSpdLabel = null; state.mode = "container";
  state.targetStartDate = today; state.targetEndDate = today;
  state.workSessionId = createHistoryId(); state.backupPreparation = true;
  saveState();
}
function createFingerprint(file, rows) { return `${file.name}:${file.size}:${file.lastModified}:${rows.length}:${rows[0]?.["ラベルキー"] || ""}:${rows.at(-1)?.["ラベルキー"] || ""}`; }
async function importMaster(file) {
  if (state.historySaving || state.historySaveError) { showImportMessage("履歴保存が完了していないため、マスター再取込はできません。履歴保存を再試行してください。", true); return; }
  if (!file) return; showImportMessage("TSVを読み込み、内容を検証しています…", false);
  try { const data = await loadMasterFile(file); applyMasterData(data.rows, data.info); showImportMessage(`${data.rows.length}件を取り込みました。以前の作業状態はリセットしました。`, false, true); renderAll(); showResult("idle", "部署指定待ち", "20桁のオリコンラベルを読み取るか、検索から部署を選択してください。", []); }
  catch (error) { console.error("TSV取込エラー", error); showImportMessage(`取込を中止しました。現在のマスターは変更していません。\n${error.message}`, true); playAlertSound(); }
  finally { elements.masterFile.value = ""; }
}

function initAudio() { if (!successSound) { successSound = new Audio("ok.wav"); successSound.preload = "auto"; } if (!productSuccessSound) { productSuccessSound = new Audio("product-ok.wav"); productSuccessSound.preload = "auto"; } if (!alertSound) { alertSound = new Audio("alert.wav"); alertSound.preload = "auto"; } if (!completionSound) { completionSound = new Audio("complete.wav"); completionSound.preload = "auto"; } successSound.load(); productSuccessSound.load(); alertSound.load(); completionSound.load(); }
async function unlockAudio() {
  initAudio(); const sounds = [successSound, productSuccessSound, alertSound, completionSound];
  try { sounds.forEach((sound) => { sound.muted = true; }); await Promise.all(sounds.map((sound) => sound.play())); sounds.forEach((sound) => { sound.pause(); sound.currentTime = 0; sound.muted = false; }); elements.audioStatus.textContent = "有効"; }
  catch (error) { sounds.forEach((sound) => { if (sound) sound.muted = false; }); elements.audioStatus.textContent = "有効化できません"; console.error("音声の有効化に失敗しました。", error); }
}
function playSound(label) { if (!successSound) initAudio(); const target = label === "success" ? successSound : label === "product-success" ? productSuccessSound : label === "completion" ? completionSound : alertSound; target.currentTime = 0; target.play().catch((error) => { console.error("音声を再生できません。", error); if (elements.audioStatus) elements.audioStatus.textContent = "要タップ確認"; }); }
function playSuccessSound() { playSound("success"); }
function playProductSuccessSound() { playSound("product-success"); }
function playAlertSound() { playSound("alert"); }
function playCompletionSound() { playSound("completion"); }
function handleContainerDepartmentScan(rawValue, effects = {}) { const result = setContainerDepartment(rawValue); if (result.ok) (effects.playSuccess || playSuccessSound)(); else (effects.playAlert || playAlertSound)(); return result; }

function getResultDetails(result) {
  const details = [], row = result.row || result.pending?.row;
  if (result.code === "DEPARTMENT_MISMATCH" && row) details.push(["オリコン側", `${state.currentDepartment.facilityName} ／ ${state.currentDepartment.departmentName}`], ["SPDラベル側", `${row["施設名称"]} ／ ${row["部署名称"]}`]);
  if (row) details.push(["製品番号", getProductNumber(row)], ["品名", row["品名"]]);
  if (["PRODUCT_MISMATCH", "PRODUCT_MATCH"].includes(result.code)) details.push(["TSV側JAN", result.pending.row["JANコード"]], ["読取種類", result.product.type], ["抽出JAN", result.product.jan]);
  if (result.labelKey) details.push(["ラベルキー", result.labelKey]);
  return details;
}
async function processScan(rawValue) {
  const value = normalizeValue(rawValue); if (!value) return;
  const backupBlock = getShippingBackupBlockResult();
  if (backupBlock) { showResult("ng", backupBlock.title, backupBlock.message, []); playAlertSound(); return backupBlock; }
  if (!state.masterInfo || !state.masterRows.length) { showResult("ng", "マスター未読込", "先にラベルマスタ.tsvを読み込んでください。", []); playAlertSound(); return; }
  if (state.mode === "container") {
    // 部署・作業者が未確定の準備段階では、帰属先のないNG履歴を作らず画面警告だけにする。
    if (/^\d{32}$/.test(value)) { const result = { code: "NO_DEPARTMENT", title: "オリコン未指定", message: "先に20桁のオリコンラベルを読み取ってください。", spdRaw: value }; showResult("ng", result.title, result.message, []); playAlertSound(); }
    else { const result = handleContainerDepartmentScan(value); if (result.ok) { renderAll(); showResult("ok", "オリコン指定 OK", "続けて作業者コードを指定してください。", [["施設名称", result.department.facilityName], ["部署名称", result.department.departmentName], ["施設コード", result.department.facilityCode], ["部署コード", result.department.departmentCode]]); openWorkerCodeDialog(true, "worker"); } else showResult("ng", result.title, result.message, []); }
  } else if (!hasWorkerCode()) {
    showResult("ng", "作業者未指定", "作業者コードを指定してください。", []); playAlertSound(); openWorkerCodeDialog(true, "worker");
  } else if (state.mode === "employee") {
    const result = await executeSkip(value); renderAll();
    if (result.ok) showResult("skip", result.title, result.message, [["製品番号", result.record.productNumber], ["品名", result.record.productName], ["承認者コード", result.record.employeeCode], ["通常作業者", state.workerCode], ["SKIP理由", result.record.skipReason], ["ラベルキー", result.record.labelKey]]);
    else { showResult("ng", result.title, result.message, []); playAlertSound(); }
  } else if (state.mode === "spd") {
    if (!/^\d{32}$/.test(value)) { const result = { code: "SCAN_ORDER", title: "読取順序エラー", message: "SPDラベルを先に読み取ってください。" }; try { await saveNgHistory(result); } catch { return historyStorageBlockResult(); } showResult("ng", result.title, result.message, []); playAlertSound(); }
    else {
      const result = validateSpdLabel(value);
      if (result.ok) {
        acceptPendingSpdLabel(result);
        renderAll();
        const noJan = !normalizeValue(result.row["JANコード"]) && !getAlternateJans(result.row).length;
        showResult("pending", noJan ? "JAN未登録商品" : "商品バーコード待ち", noJan ? "ラベルマスタにJANが登録されていません。SKIPで確認してください。" : result.message, [["製品番号", getProductNumber(result.row)], ["品名", result.row["品名"]], ["JAN", result.row["JANコード"] || "なし"], ["ラベルキー", result.labelKey]]);
      } else { try { await saveNgHistory(result); } catch { return historyStorageBlockResult(); } showResult("ng", result.title, result.message, getResultDetails(result)); playAlertSound(); }
    }
  } else if (detectProductBarcodeType(value) === "UNKNOWN" && (/^\d{20}$/.test(value) || /^\d{32}$/.test(value))) {
    // 商品として認識される32桁GS1は商品照合へ進め、オリコン・SPD系入力だけを順序エラーにする。
    const result = { code: "SCAN_ORDER", title: "読取順序エラー", message: "現在の商品照合を完了するか、SPDラベル読取を取消してください。", pending: state.pendingSpdLabel };
    try { await saveNgHistory(result); } catch { return historyStorageBlockResult(); } showResult("ng", result.title, result.message, getResultDetails(result)); playAlertSound();
  } else {
    const result = await processProductScanValue(value); renderAll();
    if (result.code === "SKIP_APPROVER_REQUIRED") { showResult("pending", result.title, result.message, [["通常作業者", state.workerCode], ["製品番号", getProductNumber(result.pending.row)], ["品名", result.pending.row["品名"]], ["ラベルキー", result.pending.labelKey]]); openWorkerCodeDialog(true, "skip"); }
    else showResult(result.ok ? "ok" : "ng", result.ok ? "OK" : result.title, result.message, getResultDetails(result));
  }
}
function handleClearDepartment() { if (state.historySaving || state.historySaveError) return; clearContainerDepartment(); renderAll(); showResult("idle", "オリコン指定解除", "作業者コードも解除しました。20桁のオリコンラベルを読み取るか、検索から部署を選択してください。", []); }
function handleCancelPending() {
  if (state.historySaving || state.historySaveError) return;
  if (state.mode === "employee") {
    if (cancelSkipProcess()) { closeWorkerCodeDialog(); renderAll(); showResult("pending", "SKIP取消", "商品バーコード待ちへ戻りました。", []); }
  } else if (cancelPendingSpdLabel()) { renderAll(); showResult("idle", "キャンセル", "SPDラベル待ちへ戻りました。", []); }
}
function handleSkip() {
  const result = startSkipProcess();
  renderAll();
  if (result.ok) { showResult("pending", result.title, result.message, [["通常作業者", state.workerCode], ["製品番号", getProductNumber(result.pending.row)], ["品名", result.pending.row["品名"]], ["ラベルキー", result.pending.labelKey]]); openWorkerCodeDialog(true, "skip"); }
  else { showResult("ng", result.title, result.message, []); playAlertSound(); }
}
function handleGlobalKeydown(event) {
  if (elements.skipBarcodePreview && !elements.skipBarcodePreview.hidden) { if (event.key === "Escape") closeSkipBarcodePreview(); event.preventDefault(); return; }
  if (elements.departmentSearchDialog && !elements.departmentSearchDialog.hidden) { if (event.key === "Escape") closeDepartmentSearchDialog(); return; }
  if (elements.historyRestoreDialog && !elements.historyRestoreDialog.hidden) { if (event.key === "Escape") closeHistoryRestoreDialog(); return; }
  if (elements.adminPasswordDialog && !elements.adminPasswordDialog.hidden) { if (event.key === "Escape") closeAdminPasswordDialog(); return; }
  if (elements.workerCodeDialog && !elements.workerCodeDialog.hidden) { if (event.key === "Escape") cancelWorkerCodeDialog(); return; }
  const ignored = [elements.workerCodeInput, elements.departmentSearchInput, elements.adminPasswordInput, elements.adminPasswordConfirmInput, elements.targetStartDate, elements.targetEndDate, elements.masterFile, elements.historySearch, elements.historyStartDate, elements.historyEndDate, elements.historyFacility, elements.historyDepartment, elements.historyResult];
  if (ignored.includes(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === "Enter") { if (state.scannerBuffer) { event.preventDefault(); const scan = state.scannerBuffer; state.scannerBuffer = ""; clearTimeout(state.scannerTimer); renderScannerStatus(); void processScan(scan); } return; }
  if (event.key.length === 1) { state.scannerBuffer += event.key; clearTimeout(state.scannerTimer); state.scannerTimer = setTimeout(() => { state.scannerBuffer = ""; renderScannerStatus(); }, 1500); renderScannerStatus(); }
}

function showResult(kind, title, message, details) {
  if (!elements.resultPanel) return;
  elements.resultPanel.className = `result-panel result-panel--${kind}`; elements.resultTitle.textContent = title; elements.resultMessage.textContent = message;
  elements.resultDetails.replaceChildren(...details.map(([term, description]) => { const wrapper = document.createElement("div"), dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = term; dd.textContent = description; wrapper.append(dt, dd); return wrapper; }));
}
function showImportMessage(message, isError, isSuccess = false) { if (elements.importMessage) { elements.importMessage.textContent = message; elements.importMessage.className = `import-message${isError ? " is-error" : isSuccess ? " is-ok" : ""}`; } }
function renderMode() { const modes = { container: ["mode-status--container", "● オリコンラベル待ち"], spd: ["mode-status--spd", "● SPDラベル待ち"], product: ["mode-status--product", "● 商品バーコード待ち"], employee: ["mode-status--worker", "● SKIP承認者コード待ち"] }, current = state.currentDepartment && !hasWorkerCode() ? ["mode-status--worker", "● 作業者コード待ち"] : modes[state.mode] || modes.container; elements.modeStatus.className = `mode-status ${current[0]}`; elements.modeStatus.textContent = current[1]; elements.clearDepartmentButton.disabled = !state.currentDepartment; elements.searchDepartmentButton.disabled = !state.masterInfo || !isShippingBackupReady(); }
function renderDepartment() { const department = state.currentDepartment; elements.currentFacility.textContent = department?.facilityName || "施設未指定"; elements.currentDepartment.textContent = department?.departmentName || "オリコンラベルを読み取ってください"; elements.currentDepartmentCode.textContent = `施設コード：${department?.facilityCode || "―"}　部署コード：${department?.departmentCode || "―"}`; }
function renderPendingPanel() {
  const pending = state.pendingSpdLabel;
  elements.pendingProductPanel.hidden = !pending;
  if (!pending) return;
  const noJan = !normalizeValue(pending.row["JANコード"]) && !getAlternateJans(pending.row).length;
  elements.pendingProductNumber.textContent = getProductNumber(pending.row); elements.pendingProductName.textContent = pending.row["品名"];
  elements.pendingInstruction.textContent = state.mode === "employee" ? "SKIPを承認する作業リーダーのコードを入力してください" : noJan ? "SKIPボタンまたはSPD-SKIPを読み取ってください" : "商品JAN / GS1-128を読み取ってください";
  elements.skipButton.disabled = !canSkip() || !canContinueCurrentShippingWork();
  elements.cancelPendingButton.textContent = state.mode === "employee" ? "SKIP取消" : "キャンセル";
}
function renderWorker() { elements.currentWorkerCode.textContent = hasWorkerCode() ? `作業者：${state.workerCode}` : "作業者：未指定"; elements.changeWorkerButton.disabled = !state.currentDepartment || state.mode === "employee" || !isShippingBackupReady(); }
function renderCounts() {
  const period = validateTargetPeriod(), counts = getTargetCounts();
  elements.targetCount.textContent = counts.target; elements.readCount.textContent = counts.read; elements.unreadCount.textContent = counts.unread; elements.processingBreakdown.textContent = `OK：${counts.ok}件　SKIP：${counts.skip}件`;
  elements.unreadTargetCount.textContent = counts.target; elements.unreadReadCount.textContent = counts.read; elements.unreadRemainingCount.textContent = counts.unread; elements.periodError.textContent = period.ok ? "" : period.message;
  elements.unreadPeriodLabel.textContent = period.ok ? `対象期間：${formatDateForDisplay(state.targetStartDate)} ～ ${formatDateForDisplay(state.targetEndDate)}` : `対象期間：エラー（${period.message}）`;
  elements.unreadDepartmentLabel.textContent = state.currentDepartment ? `対象部署：${state.currentDepartment.facilityName} / ${state.currentDepartment.departmentName}` : "対象部署：指定なし（全体）";
}
function createEmptyState(message) { const element = document.createElement("p"); element.className = "empty-state"; element.textContent = message; return element; }

// 印刷は現在の未読取集合のスナップショットだけを使い、履歴や完了状態へ書き込まない。
let unreadPdfPreviewUrl = "";
let unreadPdfPreview = null;
let unreadPdfBusy = false;
function createUnreadPdfReport(now = new Date()) {
  if (!state.masterInfo || !state.masterRows.length) throw new Error("先にラベルマスタ.tsvを読み込んでください。");
  const period = validateTargetPeriod();
  if (!period.ok) throw new Error(period.message);
  const rows = getUnreadLabels().slice().sort((a, b) => {
    for (const key of ["施設名称", "部署名称", "品名", "商品コード", "ラベルキー"]) {
      const compared = String(a[key] || "").localeCompare(String(b[key] || ""), "ja");
      if (compared) return compared;
    }
    return 0;
  });
  const missingColumns = ["商品コード", "規格"].filter((key) => !state.masterRows.some((row) => Object.hasOwn(row, key)));
  const dates = [...new Set(rows.map((row) => row["払出予定伝票日付"]))].sort();
  return {
    title: "SPD出荷 未読取ラベル一覧",
    scope: state.currentDepartment ? `指定部署：${state.currentDepartment.facilityName} / ${state.currentDepartment.departmentName}` : "全体（全施設・全部署）",
    period: `${formatDateForDisplay(state.targetStartDate)} ～ ${formatDateForDisplay(state.targetEndDate)}`,
    plannedDates: dates.map((date) => date.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1/$2/$3")).join("、"),
    printedAt: formatLocalDateTime(now), fileDate: todayInputValue(now), missingColumns,
    rows: rows.map((row, index) => [String(index + 1), "", row["施設名称"], row["部署名称"],
      row["商品コード"] ?? "", row["品名"] ?? "", row["規格"] ?? "", row["製品番号"] ?? "", "1" + normalizeValue(row["単位名"]), row["ラベルキー"]])
  };
}
function openUnreadPdfLoadingWindow(windowRef = window) {
  try {
    const preview = windowRef.open("about:blank", "_blank");
    if (preview) { preview.document.title = "SPD出荷 PDF生成中"; preview.document.body.textContent = "PDFを生成しています。しばらくお待ちください。"; }
    return preview;
  } catch { return null; }
}
function usesDesktopPdfSave(env = globalThis) {
  // 既存のPC向け保存APIとマウス操作の能力で判断する。画面幅やUser-Agentは使わない。
  return isHistoryBackupSupported(env)
    || Boolean(env.matchMedia?.("(hover: hover) and (pointer: fine)").matches);
}
function renderUnreadPdfActions(env = globalThis) {
  const desktop = usesDesktopPdfSave(env);
  const disabled = unreadPdfBusy || !state.masterInfo || !state.masterRows.length || !validateTargetPeriod().ok;
  elements.printUnreadButton.disabled = disabled;
  elements.saveUnreadPdfButton.hidden = !desktop;
  elements.saveUnreadPdfButton.disabled = disabled;
  elements.shareUnreadPdfButton.hidden = desktop;
  elements.shareUnreadPdfButton.disabled = disabled;
}

async function generateUnreadPdf(report, env = globalThis) {
  if (!env.ShippingPdf?.generateShippingPdf) throw new Error("PDF生成機能を読み込めません。画面を再読み込みしてください。");
  const base = new URL("./", (env.document || document).baseURI);
  const result = await env.ShippingPdf.generateShippingPdf(report, {
    fontUrl: new URL("vendor/NotoSansCJKjp-PdfCommon.ttf", base).href
  });
  if (!result.bytes?.byteLength) throw new Error("PDFデータが空です。");
  return result;
}

function downloadUnreadPdf(result, env = globalThis) {
  const documentRef = env.document || document;
  const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/pdf" }));
  const link = documentRef.createElement("a");
  link.href = url; link.download = result.fileName;
  try {
    documentRef.body.append(link);
    link.click();
  } finally {
    link.remove();
    // ダウンロード開始前のURL失効を避け、作業中のPDFデータとしては保持しない。
    const timer = setTimeout(() => URL.revokeObjectURL(url), 60000);
    timer?.unref?.();
  }
}

async function generateUnreadPdfOutput(action, env = globalThis) {
  if (unreadPdfBusy) return false;
  unreadPdfBusy = true;
  appUpdate.pendingOperations += 1;
  renderUnreadPdfActions(env);
  renderShippingBackupGate();
  let preview = null;
  try {
    // クリック時に期間・部署・マスター・完了集合から文字列のコピーを作る。
    // 生成中に作業状態が変わっても、帳票と完了案内はこの同じコピーを使用する。
    const report = createUnreadPdfReport();
    if (!report.rows.length) {
      elements.unreadPrintMessage.textContent = "未読取ラベルは0件です。出力対象はありません。";
      return false;
    }
    if (action === "preview") {
      // ポップアップの表示先は、最初のawaitより前に利用者のクリック中に確保する。
      preview = openUnreadPdfLoadingWindow(env.window || window);
      if (!preview) throw new Error("PDF表示画面を開けません。ブラウザのポップアップ設定を確認して再度押してください。");
    }
    elements.unreadPrintMessage.textContent = "PDF作成中... " + report.scope + "／対象期間：" + report.period;
    const result = await generateUnreadPdf(report, env);
    let method;
    if (action === "preview") {
      if (preview.closed) throw new Error("PDF表示画面が閉じられています。もう一度印刷プレビューを押してください。");
      const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/pdf" }));
      preview.location.href = url;
      if (unreadPdfPreviewUrl) URL.revokeObjectURL(unreadPdfPreviewUrl);
      unreadPdfPreviewUrl = url; unreadPdfPreview = preview;
      method = "プレビュー表示";
    } else if (action === "share") {
      const file = new env.File([result.bytes], result.fileName, { type: "application/pdf" });
      if (env.navigator?.canShare?.({ files: [file] }) && env.navigator.share) {
        await env.navigator.share({ title: "SPD出荷 未読取ラベル一覧", files: [file] });
        method = "共有";
      } else {
        downloadUnreadPdf(result, env); method = "保存";
      }
    } else {
      downloadUnreadPdf(result, env); method = "保存";
    }
    const substitutions = result.substitutions?.length
      ? "表示できない文字をPDF内だけ置換しました（" + result.substitutions.map((item) =>
        "U+" + item.codePoint.toString(16).toUpperCase() + "→" + item.replacement).join("、") + "）。" : "";
    elements.unreadPrintMessage.textContent = method + "用PDF：" + result.pageCount + "ページ。"
      + "出力対象期間：" + report.period + "／出力対象：" + report.scope + "／未読取：" + report.rows.length + "件。"
      + substitutions + (report.missingColumns.length ? "マスターにない列は空欄です：" + report.missingColumns.join("、") : "");
    return true;
  } catch (error) {
    preview?.close();
    elements.unreadPrintMessage.textContent = error.name === "AbortError"
      ? "PDFの共有をキャンセルしました。"
      : "PDFを作成・出力できませんでした。" + error.message;
    return false;
  } finally {
    unreadPdfBusy = false;
    appUpdate.pendingOperations -= 1;
    renderUnreadPdfActions(env);
    renderShippingBackupGate();
  }
}
function printUnreadList(env = globalThis) { return generateUnreadPdfOutput("preview", env); }
function saveUnreadPdf(env = globalThis) { return generateUnreadPdfOutput("save", env); }
function shareUnreadPdf(env = globalThis) {
  return generateUnreadPdfOutput(usesDesktopPdfSave(env) ? "save" : "share", env);
}

function renderUnreadList() {
  renderUnreadPdfActions();
  elements.unreadList.replaceChildren();
  if (!state.masterInfo) { elements.unreadList.append(createEmptyState("マスターを読み込んでください。")); return; }
  const period = validateTargetPeriod(); if (!period.ok) { elements.unreadList.append(createEmptyState(`対象期間を修正してください。${period.message}`)); return; }
  const rows = getUnreadLabels(); if (!rows.length) { elements.unreadList.append(createEmptyState(getTargetCounts().target ? "未読取ラベルはありません。" : "対象条件に該当するラベルはありません。")); return; }
  rows.forEach((row) => { const article = document.createElement("article"), title = document.createElement("h3"), product = document.createElement("p"), place = document.createElement("p"), key = document.createElement("p"); article.className = "unread-item"; title.textContent = row["品名"]; product.className = "item-product"; product.textContent = `製品番号：${getProductNumber(row)}　JAN：${row["JANコード"] || "―"}`; place.textContent = `${row["施設名称"]} ／ ${row["部署名称"]}`; key.className = "item-key"; key.textContent = `ラベルキー：${row["ラベルキー"]}`; article.append(title, product, place, key); elements.unreadList.append(article); });
}
function renderMasterInfo() {
  const info = state.masterInfo;
  const savedFacilityName = normalizeValue(info?.facilityName);
  const restoredFacilityNames = getUniqueFacilityNames(state.masterRows);
  const facilityName = savedFacilityName || (restoredFacilityNames.length === 1 ? restoredFacilityNames[0] : restoredFacilityNames.length > 1 ? "複数施設（再取込してください）" : "―");
  elements.masterStatusBadge.textContent = info ? "マスター読込済み" : "マスター未読込";
  elements.masterStatusBadge.className = `status-badge ${info ? "status-badge--ok" : "status-badge--ng"}`;
  elements.masterLoaded.textContent = info ? "読込済み" : "未読込";
  elements.masterFileName.textContent = info?.fileName || "―";
  elements.masterFacilityName.textContent = info ? facilityName : "―";
  elements.masterImportedAt.textContent = formatLocalDateTime(info?.importedAt);
  elements.masterRowCount.textContent = `${info?.rowCount || 0}件`;
  elements.masterMaxDate.textContent = info ? formatDateForDisplay(keyToDateInput(info.maxDate)) : "―";
}
function renderScannerStatus() { elements.scannerBufferStatus.textContent = state.scannerBuffer ? `Bluetoothリーダー入力中（${state.scannerBuffer.length}文字）` : "Bluetoothリーダー入力待機中"; renderShippingBackupGate(); }

function getHistoryFiltersFromUi() { return { startDate: elements.historyStartDate.value, endDate: elements.historyEndDate.value, facility: elements.historyFacility.value, department: elements.historyDepartment.value, result: elements.historyResult.value, search: elements.historySearch.value }; }
function filterHistory(records, filters = {}) {
  const start = filters.startDate ? `${filters.startDate}T00:00:00` : "", end = filters.endDate ? `${filters.endDate}T23:59:59.999` : "", search = normalizeValue(filters.search).toLowerCase();
  return records.filter((record) => { const timestamp = record.completedAt || record.eventAt || ""; if (start && timestamp < start || end && timestamp > end || filters.facility && record.facilityName !== filters.facility || filters.department && record.departmentName !== filters.department || filters.result && record.result !== filters.result) return false; return !search || [record.productNumber, record.productName, record.labelKey, record.masterJan, record.scannedJan, record.employeeCode].join(" ").toLowerCase().includes(search); });
}
function updateHistoryFilterOptions() {
  const setOptions = (select, values, label) => { const current = select.value; select.replaceChildren(new Option(label, ""), ...[...new Set(values.filter(Boolean))].sort().map((value) => new Option(value, value))); select.value = current; };
  setOptions(elements.historyFacility, state.history.map((item) => item.facilityName), "すべての施設"); setOptions(elements.historyDepartment, state.history.map((item) => item.departmentName), "すべての部署");
}
function renderHistory() {
  renderShippingBackupGate();
  updateHistoryFilterOptions(); const records = filterHistory(state.history, getHistoryFiltersFromUi()).sort((a, b) => (b.eventAt || "").localeCompare(a.eventAt || ""));
  elements.historyCount.textContent = `${records.length}件`; elements.historyList.replaceChildren();
  if (!records.length) { elements.historyList.append(createEmptyState("条件に該当する履歴はありません。")); return; }
  records.slice(0, 500).forEach((record) => { const article = document.createElement("article"), heading = document.createElement("div"), result = document.createElement("strong"), time = document.createElement("time"), title = document.createElement("h3"), place = document.createElement("p"), detail = document.createElement("p"); article.className = `history-item history-item--${record.result.toLowerCase()}`; heading.className = "history-item-heading"; result.textContent = record.result; time.textContent = formatLocalDateTime(record.completedAt || record.eventAt); heading.append(result, time); title.textContent = `${record.productNumber || "―"}　${record.productName || ""}`; place.textContent = `${record.facilityName || "―"} ／ ${record.departmentName || "―"}`; detail.className = "item-key"; detail.textContent = `ラベル：${record.labelKey || "―"}　JAN：${record.scannedJan || record.masterJan || "―"}${record.skipReason ? `　理由：${record.skipReason}` : ""}${record.employeeCode ? `　作業者：${record.employeeCode}` : "　作業者：記録なし"}`; article.append(heading, title, place, detail); elements.historyList.append(article); });
}
function renderHistoryIfReady() { if (elements.historyList) renderHistory(); }
function csvEscape(value) { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
const HISTORY_CSV_COLUMNS = [["完了日時", "completedAt"], ["SPDラベル読取日時", "spdReadAt"], ["商品バーコード読取日時", "productReadAt"], ["施設コード", "facilityCode"], ["施設名称", "facilityName"], ["部署コード", "departmentCode"], ["部署名称", "departmentName"], ["払出予定伝票日付", "plannedDate"], ["ラベルキー", "labelKey"], ["製品番号", "productNumber"], ["品名", "productName"], ["TSV側JANコード", "masterJan"], ["読取商品JANコード", "scannedJan"], ["商品バーコード種別", "productBarcodeType"], ["SPD QR", "spdRaw"], ["商品バーコード", "productRaw"], ["判定結果", "result"], ["判定詳細", "detail"], ["SKIP理由", "skipReason"], ["作業者社員コード", "employeeCode"]];
const LEGACY_HISTORY_BACKUP_COLUMNS = [["履歴ID", "historyId"], ...HISTORY_CSV_COLUMNS];
const HISTORY_BACKUP_COLUMNS = [["履歴ID", "historyId"], ["記録日時", "eventAt"], ...HISTORY_CSV_COLUMNS];
function buildHistoryCsv(records, includeHistoryId = false) {
  const columns = includeHistoryId ? [["履歴ID", "historyId"], ...HISTORY_CSV_COLUMNS] : HISTORY_CSV_COLUMNS;
  return [columns.map(([label]) => csvEscape(label)).join(","), ...records.map((record) => columns.map(([, key]) => csvEscape(record[key])).join(","))].join("\r\n");
}
function createHistoryCsvFile(records, name = `SPD読取履歴_${todayInputValue().replaceAll("-", "")}.csv`) { return new File(["\uFEFF", buildHistoryCsv(records)], name, { type: "text/csv;charset=utf-8" }); }
function downloadFile(file, documentRef = document) { const url = URL.createObjectURL(file), anchor = documentRef.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
// 現調くんと同じWeb Share APIを使い、非対応時だけダウンロードへ戻す。
async function shareHistoryCsv(records = filterHistory(state.history, getHistoryFiltersFromUi()), env = {}) {
  if (!records.length) throw new Error("共有対象の履歴がありません。");
  const navigatorRef = env.navigatorRef || navigator, documentRef = env.documentRef || document, file = createHistoryCsvFile(records);
  if (navigatorRef.canShare?.({ files: [file] }) && navigatorRef.share) { await navigatorRef.share({ title: "SPD出荷チェッカー 読取履歴", text: "読取履歴CSVです。", files: [file] }); return "shared"; }
  downloadFile(file, documentRef); return "downloaded";
}

function isHistoryBackupSupported(windowRef = globalThis) { return typeof windowRef?.showDirectoryPicker === "function"; }
function isShippingBackupReady() { return !state.historySaveError && !state.historySaving && !state.backupSetupBusy; }
function isShippingWorkInProgress() {
  return Boolean(state.pendingSpdLabel) && ["product", "employee"].includes(state.mode);
}
function canContinueCurrentShippingWork(windowRef = globalThis) {
  return isShippingBackupReady(windowRef);
}
function historyStorageBlockResult() {
  return { ok: false, completed: false, code: state.historySaveError ? "HISTORY_SAVE_FAILED" : "HISTORY_SAVING",
    title: state.historySaveError ? "履歴保存失敗・作業停止" : "履歴保存中",
    message: state.historySaveError ? "ブラウザ内履歴を保存できません。読取状態は保持しています。履歴保存を再試行してください。" : "履歴保存が完了するまで次の読取をお待ちください。" };
}
function getShippingBackupBlockResult() {
  if (state.initializing) return { ok: false, code: "INITIALIZING", title: "内部履歴確認中", message: "起動処理が終わるまでお待ちください。" };
  if (state.backupSetupBusy) return { ok: false, code: "BACKUP_SETTING", title: "バックアップ設定中", message: "設定操作が終わるまでお待ちください。" };
  return isShippingBackupReady() ? null : historyStorageBlockResult();
}
function getBackupSettingBlockReason(ownOperations = 0) {
  if (state.initializing) return "起動時の履歴確認中のため設定できません。";
  if (state.backupSetupBusy) return "バックアップ設定処理中のため設定できません。";
  if (state.historySaving) return "履歴保存処理中のため設定できません。";
  if (state.historySaveError) return "内部履歴の保存エラーを解消してから設定してください。";
  if (state.mode === "employee") return "SKIP承認中のため設定できません。";
  if (state.pendingSpdLabel || state.mode === "product") return "商品照合中のため設定できません。";
  if (state.scannerBuffer) return "バーコード入力途中のため設定できません。";
  if (appUpdate.reloading) return "PWA更新処理中のため設定できません。";
  if (appUpdate.pendingOperations > ownOperations) return `履歴保存・CSV書込み・復元等の処理中のため設定できません。（実行中：${appUpdate.pendingOperations - ownOperations}）`;
  if (unreadPdfBusy || (unreadPdfPreview && !unreadPdfPreview.closed)) return "PDF出力・プレビュー中のため設定できません。";
  const dialogs = { workerCodeDialog: "作業者コード入力", departmentSearchDialog: "部署検索", adminPasswordDialog: "管理者認証", historyRestoreDialog: "履歴復元", skipBarcodePreview: "バーコードプレビュー" };
  for (const [id, name] of Object.entries(dialogs)) if (elements[id] && !elements[id].hidden) return `${name}画面が開いているため設定できません。`;
  return "";
}
function isBackupPreparationSafe(ownOperations = 0) { return !getBackupSettingBlockReason(ownOperations); }
async function retryFailedHistorySave() {
  const record = state.failedHistoryRecord;
  if (state.historySaving) return false;
  if (!record) {
    state.historySaving = true; state.historySaveError = "";
    try { await loadScanHistory(); if (!state.historySaveError) { renderAll(); showResult("ok", "内部履歴を確認しました", "出荷チェックを再開できます。", []); } return !state.historySaveError; }
    finally { state.historySaving = false; renderShippingBackupGate(); if (state.historySaveError) showResult("ng", "内部履歴確認失敗・作業停止", state.historySaveError, []); }
  }
  try {
    await saveScanHistory(record);
    state.historySaveError = ""; state.failedHistoryRecord = null;
    if (["OK", "SKIP"].includes(record.result)) {
      state.readLabelKeys.add(record.labelKey); state.processedResults.set(record.labelKey, record.result);
      state.pendingSpdLabel = null; state.mode = "spd"; saveState();
      if (elements.workerCodeDialog && !elements.workerCodeDialog.hidden) closeWorkerCodeDialog();
    }
    renderAll(); showResult("ok", "履歴を保存しました", "内部保存を確認しました。出荷チェックを再開できます。", []);
    return true;
  } catch { return false; }
}
function historyBackupFileName(record) {
  const date = new Date(record.eventAt || record.completedAt || Date.now());
  const local = Number.isNaN(date.getTime()) ? todayInputValue() : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `読取履歴_${local.replaceAll("-", "")}.csv`;
}
function historyBackupRow(record, columns = HISTORY_BACKUP_COLUMNS) { return columns.map(([, key]) => csvEscape(record[key])).join(","); }
function historyBackupHeader(columns = HISTORY_BACKUP_COLUMNS) { return columns.map(([label]) => csvEscape(label)).join(","); }
function backupTextContainsHistoryId(text, historyId) {
  if (!historyId) return false;
  const escaped = csvEscape(historyId);
  return String(text || "").split(/\r?\n/).slice(1).some((line) => line.startsWith(`${escaped},`));
}
function setBackupStatus(status, message) {
  state.backupStatus = status;
  state.backupReason = message;
  if (elements.historyBackupStatus) {
    elements.historyBackupStatus.textContent = `${status === "ready" && !pendingHistoryBackupIds.size ? "バックアップ正常" : "バックアップ保留：" + pendingHistoryBackupIds.size + "件"}　${message}`;
    elements.historyBackupStatus.className = `backup-status${status === "ready" ? " is-ok" : ["error", "unset", "permission"].includes(status) ? " is-warning" : ""}`;
  }
  renderShippingBackupGate();
  if (elements.modeStatus) { renderMode(); renderPendingPanel(); renderWorker(); }
}
function renderShippingBackupGate() {
  if (!elements.shippingBackupGate) return;
  const supported = isHistoryBackupSupported(), status = state.backupStatus, safe = isBackupPreparationSafe();
  let title = !supported ? "履歴はブラウザ内に保存" : status === "ready" && !pendingHistoryBackupIds.size ? "バックアップ正常" : `バックアップ保留：${pendingHistoryBackupIds.size}件`;
  let message = state.backupReason || "内部履歴を保存して作業を継続できます。";
  if (safe && supported && status !== "ready") message += state.backupDirectoryHandle ? " 待機中にアクセスを許可できます。" : " 待機中に保存先を登録できます。";
  elements.shippingBackupGateTitle.textContent = title; elements.shippingBackupGateMessage.textContent = message;
  elements.shippingBackupGate.className = `card shipping-backup-gate${safe ? "" : " is-compact"}${status === "ready" ? " is-ready" : !supported ? " is-unsupported" : ""}`;
  elements.shippingBackupSetupButton.hidden = !supported || !safe || state.backupDirectoryHandle?.name !== "読取履歴" || !["permission", "error"].includes(status);
  elements.shippingBackupSetupButton.disabled = !safe; elements.shippingBackupSetupButton.textContent = "アクセスを許可";
  if (elements.configureHistoryBackupButton) {
    elements.configureHistoryBackupButton.textContent = "バックアップ先登録・再設定";
    elements.configureHistoryBackupButton.disabled = !supported || !safe;
    const reason = !supported ? "この端末ではローカル履歴バックアップ機能は利用できません。" : getBackupSettingBlockReason();
    elements.configureHistoryBackupButton.title = reason;
    if (elements.backupSettingDisabledReason) elements.backupSettingDisabledReason.textContent = reason;
  }
  if (elements.retryHistorySaveButton) { elements.retryHistorySaveButton.hidden = !state.historySaveError; elements.retryHistorySaveButton.disabled = state.historySaving; }
  if (elements.historyBackupStatus) elements.historyBackupStatus.textContent = !supported ? "この端末ではローカル履歴バックアップを利用できません。" : `${title}　${state.backupReason}`;
}
async function restoreHistoryBackup() {
  if (!isHistoryBackupSupported()) { state.backupDirectoryHandle = null; setBackupStatus("unsupported", "この端末では利用できません"); return; }
  try {
    state.backupDirectoryHandle = await getHistorySetting(BACKUP_DIRECTORY_KEY);
    if (!state.backupDirectoryHandle) { setBackupStatus("unset", "保存先未設定"); return; }
    if (state.backupDirectoryHandle.name !== "読取履歴") { setBackupStatus("registration", "指定先の登録が必要です。安全な待機状態で登録してください。"); return; }
    const permission = await state.backupDirectoryHandle.queryPermission({ mode: "readwrite" });
    setBackupStatus(permission === "granted" ? "ready" : "permission", permission === "granted" ? `設定済み（${state.backupDirectoryHandle.name}）` : "再度アクセス許可が必要です");
  } catch (error) { console.error("履歴バックアップ設定を読み込めません。", error); state.backupDirectoryHandle = null; setBackupStatus("error", "保存先設定を読み込めません"); }
}
function describeBackupFailure(stage, error) {
  if (stage === "settings") return "設定情報を保存できませんでした。";
  if (error?.name === "NotAllowedError" || stage === "permission") return "フォルダへの書込み権限がありません。アクセス許可を確認してください。";
  if (stage === "folder") return error.message;
  if (stage === "picker") return "フォルダを選択できませんでした。";
  return "フォルダへの書込みに失敗しました。保存先フォルダを確認してください。";
}
async function configureHistoryBackup(windowRef = globalThis, { reuseExisting = false } = {}) {
  if (!isHistoryBackupSupported(windowRef)) { setBackupStatus("unsupported", "この端末ではローカル履歴バックアップ機能は利用できません"); return { ok: false, code: "UNSUPPORTED" }; }
  // ラッパー自身の1操作だけを除外し、保存・CSV書込み・入力・画面操作中は設定しない。
  const blockReason = getBackupSettingBlockReason(1);
  if (blockReason) return { ok: false, code: "WORK_IN_PROGRESS", message: blockReason };
  state.backupSetupBusy = true;
  let stage = "picker";
  try {
    let handle = reuseExisting ? state.backupDirectoryHandle : null;
    if (reuseExisting && (!handle || handle.name !== "読取履歴")) {
      const message = "保存済みフォルダを利用できません。バックアップ先を登録してください。";
      setBackupStatus("registration", message); return { ok: false, code: "NOT_CONFIGURED", message };
    }
    if (!handle) handle = await windowRef.showDirectoryPicker({ mode: "readwrite", id: "spd-history-backup" });
    stage = "folder";
    if (handle.name !== "読取履歴") throw new Error(`指定先 ${BACKUP_PATH} の「読取履歴」フォルダを選択してください。`);
    stage = "permission";
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted") throw Object.assign(new Error("書込み権限が許可されませんでした。"), { name: "NotAllowedError" });
    stage = "settings";
    await setHistorySetting(BACKUP_DIRECTORY_KEY, handle);
    state.backupDirectoryHandle = handle;
    // 設定はここで確定済み。CSV再保存の失敗で設定失敗へ読み替えない。
    const before = pendingHistoryBackupIds.size;
    try {
      const retried = await flushPendingHistoryBackups(handle);
      const message = `保存先を登録しました。保留${retried}件を保存しました。`;
      setBackupStatus("ready", message);
      return { ok: true, backupOk: true, code: "REGISTERED", handle, retried, message };
    } catch (error) {
      const detail = error.message || String(error);
      const message = `保存先は登録されましたが、バックアップ保留履歴の保存に失敗しました。理由：${detail}`;
      console.error("バックアップ設定成功・保留CSV再保存失敗", { stage: error.backupStage || "pending-csv", name: error.name, message: detail }, error);
      setBackupStatus("error", message);
      return { ok: true, backupOk: false, code: "REGISTERED_BACKUP_PENDING", handle, retried: before - pendingHistoryBackupIds.size, message, error };
    }
  } catch (error) {
    if (stage === "picker" && error?.name === "AbortError") return { ok: false, code: "CANCELLED", message: "フォルダ選択をキャンセルしました。現在の設定を維持します。" };
    const message = describeBackupFailure(stage, error);
    console.error("履歴バックアップ先の登録失敗", { stage, name: error.name, message: error.message }, error);
    setBackupStatus(stage === "permission" ? "permission" : "error", message);
    return { ok: false, code: stage === "settings" ? "SETTINGS_SAVE_FAILED" : stage === "permission" ? "PERMISSION_REQUIRED" : "SETUP_FAILED", stage, message, error };
  } finally {
    state.backupSetupBusy = false; renderShippingBackupGate();
    if (elements.modeStatus) { renderMode(); renderPendingPanel(); renderWorker(); }
  }
}
async function writeHistoryBackupRecord(record, handle = state.backupDirectoryHandle) {
  if (!isHistoryBackupSupported()) return { ok: false, code: "UNSUPPORTED" };
  if (!handle) return { ok: false, code: "NOT_CONFIGURED" };
  if (handle.name && handle.name !== "読取履歴") return { ok: false, code: "WRONG_DIRECTORY" };
  let stage = "csv-permission";
  try {
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") return { ok: false, code: "PERMISSION_REQUIRED" };
  stage = "csv-open";
  const fileHandle = await handle.getFileHandle(historyBackupFileName(record), { create: true });
  stage = "csv-read";
  const existingFile = await fileHandle.getFile();
  const existingText = existingFile.size ? await existingFile.text() : "";
  const existingHeader = existingText.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0];
  stage = "csv-format";
  const columns = !existingFile.size || existingHeader === historyBackupHeader() ? HISTORY_BACKUP_COLUMNS : existingHeader === historyBackupHeader(LEGACY_HISTORY_BACKUP_COLUMNS) ? LEGACY_HISTORY_BACKUP_COLUMNS : null;
  if (!columns) throw new Error(`${fileHandle.name}の列構成が現在のバックアップ形式と一致しません。`);
  if (backupTextContainsHistoryId(existingText, record.historyId)) return { ok: true, code: "DUPLICATE_SKIPPED" };
  const separator = existingFile.size && !/\r?\n$/.test(existingText) ? "\r\n" : "";
  const content = existingFile.size ? `${separator}${historyBackupRow(record, columns)}\r\n` : `\uFEFF${historyBackupHeader(columns)}\r\n${historyBackupRow(record, columns)}\r\n`;
  stage = "csv-write";
  const writable = await fileHandle.createWritable({ keepExistingData: true });
  try { await writable.seek(existingFile.size); await writable.write(content); stage = "csv-close"; await writable.close(); }
  catch (error) { try { await writable.abort?.(); } catch {} throw error; }
  return { ok: true, code: "SAVED", fileName: fileHandle.name };
  } catch (error) { error.backupStage ||= stage; throw error; }
}
async function flushPendingHistoryBackups(handle = state.backupDirectoryHandle) {
  const flushing = backupWriteQueue.then(async () => {
    const recordsById = new Map(state.history.map((record) => [normalizeValue(record.historyId), record]));
    let savedCount = 0;
    for (const historyId of [...pendingHistoryBackupIds]) {
      const record = recordsById.get(historyId);
      if (!record) throw Object.assign(new Error("保留履歴に対応する内部履歴が見つかりません。管理者へ連絡してください。"), { backupStage: "pending-history-lookup" });
      const result = await writeHistoryBackupRecord(record, handle);
      if (!result.ok) throw Object.assign(new Error(result.code === "PERMISSION_REQUIRED" ? "保留履歴の保存にアクセス許可が必要です。" : "保留履歴をバックアップできません。"), { backupStage: "pending-csv", code: result.code });
      try { await acknowledgeHistoryBackup(historyId); }
      catch (error) { error.backupStage = "pending-idb-acknowledge"; throw error; }
      savedCount += 1;
    }
    return savedCount;
  });
  backupWriteQueue = flushing.catch(() => {});
  return flushing;
}
async function acknowledgeHistoryBackup(historyId) {
  const acknowledge = historyPersistenceQueue.then(async () => {
    const remaining = [...pendingHistoryBackupIds].filter((id) => id !== historyId);
    await setHistorySetting(PENDING_BACKUP_IDS_KEY, remaining);
    pendingHistoryBackupIds.delete(historyId); renderShippingBackupGate();
  });
  historyPersistenceQueue = acknowledge.catch(() => {});
  return acknowledge;
}
function enqueueHistoryBackup(record) {
  backupWriteQueue = backupWriteQueue.then(async () => {
    const result = await writeHistoryBackupRecord(record);
    if (result.ok) {
      if (pendingHistoryBackupIds.has(record.historyId)) await acknowledgeHistoryBackup(record.historyId);
      setBackupStatus("ready", `保存済み（${result.fileName || state.backupDirectoryHandle?.name || "設定フォルダ"}）`);
    }
    else if (result.code === "NOT_CONFIGURED") setBackupStatus("unset", "保存先未設定（ブラウザ内には保存済み）");
    else if (result.code === "WRONG_DIRECTORY") setBackupStatus("registration", "指定先の登録が必要です（ブラウザ内には保存済み）");
    else if (result.code === "PERMISSION_REQUIRED") setBackupStatus("permission", "アクセス許可が必要です（ブラウザ内には保存済み）");
  }).catch((error) => { console.error("履歴バックアップに失敗しました。", { stage: error.backupStage, name: error.name, message: error.message }, error); setBackupStatus("error", "フォルダへの書込みに失敗しました。保存先フォルダを確認してください。（ブラウザ内には保存済み）"); });
  return backupWriteQueue;
}

function parseCsvRecords(text) {
  const records = [], source = String(text ?? "").replace(/^\uFEFF/, "");
  let row = [], field = "", quoted = false, quoteClosed = false;
  const pushField = () => { row.push(field); field = ""; quoteClosed = false; };
  const pushRow = () => { pushField(); if (row.some((value) => value !== "")) records.push(row); row = []; };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') { quoted = false; quoteClosed = true; }
      else field += character;
    } else if (character === '"') {
      if (field || quoteClosed) throw new Error("CSVの引用符の位置が不正です。");
      quoted = true;
    } else if (character === ",") pushField();
    else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      if (quoteClosed) throw new Error("CSVの引用符の後に不正な文字があります。");
      field += character;
    }
  }
  if (quoted) throw new Error("CSV内の引用符が閉じられていません。");
  if (field || row.length || quoteClosed) pushRow();
  return records;
}
function isValidHistoryId(value) { const id = normalizeValue(value); return Boolean(id && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id)); }
function isValidHistoryTimestamp(value) { return Boolean(value && !Number.isNaN(new Date(value).getTime())); }
function parseHistoryBackupCsv(text, fileName = "") {
  if (fileName && !/^読取履歴_\d{8}\.csv$/i.test(fileName)) throw new Error(`${fileName}：SPD出荷チェッカーの履歴バックアップファイルではありません。`);
  const rows = parseCsvRecords(text);
  if (rows.length < 2) throw new Error(`${fileName || "CSV"}：ヘッダーまたは履歴データがありません。`);
  const headers = rows[0].map(normalizeHeader), duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) throw new Error(`${fileName || "CSV"}：同じヘッダーが複数あります。`);
  const requiredHeaders = LEGACY_HISTORY_BACKUP_COLUMNS.map(([label]) => label);
  const missing = requiredHeaders.filter((label) => !headers.includes(label));
  if (missing.length) throw new Error(`${fileName || "CSV"}：SPD出荷チェッカーの履歴バックアップファイルではありません（不足列：${missing.join("、")}）。`);
  const columnByLabel = new Map([...HISTORY_BACKUP_COLUMNS, ...LEGACY_HISTORY_BACKUP_COLUMNS]);
  const fileDateMatch = /^読取履歴_(\d{4})(\d{2})(\d{2})\.csv$/i.exec(fileName);
  const legacyFileDate = fileDateMatch ? `${fileDateMatch[1]}-${fileDateMatch[2]}-${fileDateMatch[3]}T00:00:00` : "";
  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) throw new Error(`${fileName || "CSV"} ${rowIndex + 2}行目：列数がヘッダーと一致しません。`);
    const record = {};
    headers.forEach((label, index) => { const key = columnByLabel.get(label); if (key) record[key] = String(values[index] ?? ""); });
    record.historyId = normalizeValue(record.historyId); record.result = normalizeValue(record.result).toUpperCase(); record.employeeCode = normalizeValue(record.employeeCode);
    record.eventAt = normalizeValue(record.eventAt) || normalizeValue(record.completedAt) || normalizeValue(record.productReadAt) || normalizeValue(record.spdReadAt) || legacyFileDate;
    if (!isValidHistoryId(record.historyId)) throw new Error(`${fileName || "CSV"} ${rowIndex + 2}行目：履歴IDが不正です。`);
    if (!isValidHistoryTimestamp(record.eventAt)) throw new Error(`${fileName || "CSV"} ${rowIndex + 2}行目：有効な日時がありません。`);
    if (!["OK", "NG", "SKIP"].includes(record.result)) throw new Error(`${fileName || "CSV"} ${rowIndex + 2}行目：判定がOK・NG・SKIPではありません。`);
    if (!normalizeValue(record.facilityName) || !normalizeValue(record.departmentName)) throw new Error(`${fileName || "CSV"} ${rowIndex + 2}行目：施設または部署が空欄です。`);
    if (!record.employeeCode) throw new Error(`${fileName || "CSV"} ${rowIndex + 2}行目：作業者社員コードが空欄です。`);
    delete record.id;
    return record;
  });
}
async function prepareHistoryRestore(files, existingRecords = state.history) {
  const selectedFiles = Array.from(files || []);
  if (!selectedFiles.length) throw new Error("復元するバックアップCSVを選択してください。");
  const parsed = [];
  for (const file of selectedFiles) parsed.push(...parseHistoryBackupCsv(await file.text(), file.name));
  const knownIds = new Set(existingRecords.map((record) => normalizeValue(record.historyId)).filter(Boolean)), records = [];
  let duplicateCount = 0;
  parsed.forEach((record) => { if (knownIds.has(record.historyId)) duplicateCount += 1; else { knownIds.add(record.historyId); records.push(record); } });
  return { fileCount: selectedFiles.length, totalCount: parsed.length, records, restoreCount: records.length, duplicateCount };
}
async function persistRestoredHistoryRecords(records) {
  if (!records.length) return;
  const db = await openHistoryDb();
  if (!db) throw new Error("ブラウザの履歴保存領域を利用できません。");
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE_NAME, "readwrite"), store = transaction.objectStore(HISTORY_STORE_NAME);
    records.forEach((record) => store.add({ ...record }));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("履歴を保存できません。"));
    transaction.onabort = () => reject(transaction.error || new Error("履歴の一括保存を中止しました。"));
  });
}
async function commitHistoryRestore(plan, persist = persistRestoredHistoryRecords) {
  if (!plan || !Array.isArray(plan.records)) throw new Error("復元内容が準備されていません。");
  await persist(plan.records);
  state.history.push(...plan.records); renderHistoryIfReady();
  return { restored: plan.records.length, duplicates: plan.duplicateCount || 0 };
}

function bytesToBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function base64ToBytes(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
async function deriveAdminPasswordHash(password, salt, iterations = ADMIN_PASSWORD_ITERATIONS, cryptoRef = globalThis.crypto) {
  const key = await cryptoRef.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await cryptoRef.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}
async function createAdminPasswordCredential(password, cryptoRef = globalThis.crypto) {
  if (String(password).length < 8) throw new Error("管理者パスワードは8文字以上で設定してください。");
  const salt = cryptoRef.getRandomValues(new Uint8Array(16));
  return { algorithm: "PBKDF2-SHA-256", iterations: ADMIN_PASSWORD_ITERATIONS, salt: bytesToBase64(salt), hash: await deriveAdminPasswordHash(password, salt, ADMIN_PASSWORD_ITERATIONS, cryptoRef) };
}
async function verifyAdminPassword(password, credential, cryptoRef = globalThis.crypto) {
  if (!credential?.salt || !credential?.hash) return false;
  return (await deriveAdminPasswordHash(password, base64ToBytes(credential.salt), credential.iterations || ADMIN_PASSWORD_ITERATIONS, cryptoRef)) === credential.hash;
}

function renderAll() { elements.targetStartDate.value = state.targetStartDate; elements.targetEndDate.value = state.targetEndDate; renderShippingBackupGate(); renderMode(); renderDepartment(); renderPendingPanel(); renderCounts(); renderUnreadList(); renderMasterInfo(); renderWorker(); renderScannerStatus(); renderHistory(); }
function switchSection(sectionId) { document.querySelectorAll(".screen").forEach((section) => section.classList.toggle("is-active", section.id === sectionId)); document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("is-active", button.dataset.section === sectionId)); if (sectionId === "unreadSection") renderUnreadList(); if (sectionId === "historySection") renderHistory(); window.scrollTo({ top: 0, behavior: "smooth" }); }
function openSkipBarcodePreview() {
  barcodePreviewReturnFocus = document.activeElement;
  renderCode128Svg(elements.skipBarcodeSvg, SKIP_COMMAND);
  elements.skipBarcodePreview.hidden = false; document.body.classList.add("barcode-preview-open"); elements.printSkipBarcodeButton.focus();
  renderShippingBackupGate();
}
function closeSkipBarcodePreview() {
  elements.skipBarcodePreview.hidden = true; document.body.classList.remove("barcode-preview-open");
  renderShippingBackupGate();
  if (barcodePreviewReturnFocus?.focus) barcodePreviewReturnFocus.focus(); barcodePreviewReturnFocus = null;
}
function printSkipBarcode(windowRef = window) { windowRef.print(); }
function openWorkerCodeDialog(required = !hasWorkerCode(), purpose = "worker") {
  const backupBlock = getShippingBackupBlockResult(globalThis, { allowActiveWork: purpose === "skip" });
  if (backupBlock) { showResult("ng", backupBlock.title, backupBlock.message, []); return false; }
  if (!state.masterInfo) { showResult("ng", "マスター未読込", "先にラベルマスタ.tsvを読み込んでください。", []); return false; }
  if (!state.currentDepartment) { showResult("ng", "部署未指定", "先にオリコンラベルまたは部署検索で部署を指定してください。", []); return false; }
  workerDialogReturnFocus = document.activeElement;
  workerInputController?.reset();
  clearTimeout(state.scannerTimer); state.scannerBuffer = "";
  elements.workerCodeDialog.dataset.purpose = purpose;
  elements.workerCodeHeading.textContent = purpose === "skip" ? "SKIP承認者コード" : required ? "作業者コード指定" : "作業者変更";
  elements.workerCodeInput.value = purpose === "skip" || required ? "" : state.workerCode;
  elements.workerCodeDialog.querySelector(".worker-code-help").textContent = purpose === "skip" ? "SKIPを承認した作業リーダーの名札バーコードを読み取るか、キーボードで入力してください。通常作業者は変更されません。" : "作業者の名札バーコードを読み取るか、キーボードで入力してください。";
  elements.workerCodeError.textContent = "";
  elements.cancelWorkerButton.hidden = false;
  elements.cancelWorkerButton.textContent = purpose === "skip" ? "SKIP取消" : "キャンセル";
  elements.workerCodeDialog.dataset.required = required ? "true" : "false";
  elements.workerCodeDialog.hidden = false; document.body.classList.add("worker-code-dialog-open");
  renderShippingBackupGate();
  elements.workerCodeInput.focus(); elements.workerCodeInput.select();
  return true;
}
function closeWorkerCodeDialog() {
  workerInputController?.reset();
  elements.workerCodeDialog.hidden = true; document.body.classList.remove("worker-code-dialog-open");
  renderShippingBackupGate();
  if (workerDialogReturnFocus?.focus) workerDialogReturnFocus.focus(); workerDialogReturnFocus = null;
}
async function confirmWorkerCode() {
  if (workerConfirmBusy) return { ok: false, code: "SAVING" };
  workerConfirmBusy = true;
  try {
  if (elements.workerCodeDialog.hidden) return { ok: false };
  const purpose = elements.workerCodeDialog.dataset.purpose || "worker";
  const backupBlock = getShippingBackupBlockResult(globalThis, { allowActiveWork: purpose === "skip" });
  if (backupBlock) { elements.workerCodeError.textContent = backupBlock.message; return backupBlock; }
  const result = await confirmWorkerCodeValue(elements.workerCodeInput.value, purpose);
  if (!result.ok) {
    if (result.code === "HISTORY_SAVE_FAILED") { closeWorkerCodeDialog(); showResult("ng", result.title, result.message, []); return result; }
    elements.workerCodeError.textContent = result.message; elements.workerCodeInput.focus(); return result;
  }
  closeWorkerCodeDialog(); renderAll();
  if (purpose === "skip") showResult("skip", result.title, result.message, [["製品番号", result.record.productNumber], ["品名", result.record.productName], ["承認者コード", result.record.employeeCode], ["通常作業者", state.workerCode], ["SKIP理由", result.record.skipReason], ["ラベルキー", result.record.labelKey]]);
  else showResult("ok", "作業者指定 OK", `作業者：${result.workerCode}`, [["次の操作", "SPDラベルQRを読み取ってください。"]]);
  return result;
  } finally { workerConfirmBusy = false; }
}
function confirmWorkerCodeValue(value, purpose = "worker", effects = {}) {
  if (purpose === "skip") return executeSkip(value, effects);
  const result = setWorkerCode(value);
  if (result.ok) (effects.playSuccess || playSuccessSound)();
  return result;
}
function cancelWorkerCodeDialog() {
  if (state.historySaving || state.historySaveError) return false;
  const purpose = elements.workerCodeDialog.dataset.purpose || "worker";
  if (purpose === "skip") { cancelSkipProcess(); closeWorkerCodeDialog(); renderAll(); showResult("pending", "SKIP取消", "商品バーコード待ちへ戻りました。", []); return true; }
  if (elements.workerCodeDialog.dataset.required === "true" || !hasWorkerCode()) { clearContainerDepartment(); closeWorkerCodeDialog(); renderAll(); showResult("idle", "作業者指定取消", "部署指定へ戻りました。20桁のオリコンラベルを読み取るか、検索から部署を選択してください。", []); return true; }
  closeWorkerCodeDialog(); return true;
}

function getDepartmentProgress(department) {
  const validPeriod = validateTargetPeriod().ok;
  const rows = state.containerIndex.get(containerIndexKey(department.facilityCode, department.departmentCode)) || [];
  const keys = new Set(rows.filter((row) => validPeriod && isRowInTargetPeriod(row) && matchesCurrentDepartment(row, department)).map((row) => row["ラベルキー"]));
  const read = [...keys].filter((key) => state.readLabelKeys.has(key)).length;
  return { target: keys.size, read, unread: keys.size - read, complete: validPeriod && keys.size > 0 && read >= keys.size, validPeriod };
}
function filterMasterDepartments(query = "", incompleteOnly = false) {
  const keyword = normalizeValue(query).toLocaleLowerCase("ja-JP");
  return getMasterDepartments().filter((department) => {
    const progress = getDepartmentProgress(department);
    if (!progress.validPeriod || progress.target < 1) return false;
    if (keyword && !`${department.facilityName} ${department.departmentName}`.toLocaleLowerCase("ja-JP").includes(keyword)) return false;
    return !incompleteOnly || !progress.complete;
  });
}
function renderDepartmentSearchList() {
  const departments = filterMasterDepartments(elements.departmentSearchInput.value, document.getElementById("incompleteDepartmentsOnly").checked);
  elements.departmentSearchCount.textContent = `${departments.length}件`;
  elements.departmentSearchList.replaceChildren();
  if (!departments.length) { elements.departmentSearchList.append(createEmptyState("該当する部署はありません。")); return; }
  departments.forEach((department) => {
    const button = document.createElement("button"), name = document.createElement("strong"), detail = document.createElement("span");
    button.type = "button"; button.className = "department-search-item"; name.textContent = department.departmentName; detail.textContent = `${department.facilityName}　施設：${department.facilityCode}　部署：${department.departmentCode}`;
    const progress = getDepartmentProgress(department), status = document.createElement("span");
    status.className = `department-progress${progress.complete ? " is-complete" : ""}`;
    status.textContent = progress.complete ? "完了" : `未完了：残り ${progress.unread} / ${progress.target}`;
    button.append(name, detail, status); button.addEventListener("click", () => selectDepartmentFromSearch(department)); elements.departmentSearchList.append(button);
  });
}
function openDepartmentSearchDialog() {
  const backupBlock = getShippingBackupBlockResult();
  if (backupBlock) { showResult("ng", backupBlock.title, backupBlock.message, []); return false; }
  if (!state.masterInfo) { showResult("ng", "マスター未読込", "先にラベルマスタ.tsvを読み込んでください。", []); return false; }
  departmentSearchReturnFocus = document.activeElement; elements.departmentSearchInput.value = ""; renderDepartmentSearchList();
  elements.departmentSearchDialog.hidden = false; document.body.classList.add("department-search-dialog-open"); renderShippingBackupGate(); requestAnimationFrame(() => elements.departmentSearchInput.focus()); return true;
}
function closeDepartmentSearchDialog() { elements.departmentSearchDialog.hidden = true; document.body.classList.remove("department-search-dialog-open"); renderShippingBackupGate(); if (departmentSearchReturnFocus?.focus) departmentSearchReturnFocus.focus(); departmentSearchReturnFocus = null; }
function selectDepartmentFromSearch(department) {
  const result = selectDepartment(department);
  if (!result.ok) { closeDepartmentSearchDialog(); showResult("ng", result.title, result.message, []); playAlertSound(); return result; }
  closeDepartmentSearchDialog(); renderAll(); showResult("ok", "部署指定 OK", "続けて作業者コードを指定してください。", [["施設名称", result.department.facilityName], ["部署名称", result.department.departmentName], ["施設コード", result.department.facilityCode], ["部署コード", result.department.departmentCode]]); openWorkerCodeDialog(true, "worker"); return result;
}

async function handleConfigureHistoryBackup() {
  const result = await configureHistoryBackup();
  elements.historyMessage.textContent = result.message || "現在の照合作業・保存・入力を完了してから設定してください。";
  return result;
}
async function handleReauthorizeHistoryBackup() {
  const result = await configureHistoryBackup(globalThis, { reuseExisting: true });
  elements.historyMessage.textContent = result.message || "現在の照合作業・保存・入力を完了してから再許可してください。";
  return result;
}
function openHistoryRestoreDialog() {
  historyRestoreReturnFocus = document.activeElement; pendingHistoryRestorePlan = null;
  elements.historyRestoreFiles.value = ""; elements.historyRestoreSummary.textContent = "CSVを選択してください。"; elements.historyRestoreError.textContent = ""; elements.confirmHistoryRestoreButton.disabled = true;
  elements.historyRestoreDialog.hidden = false; document.body.classList.add("history-restore-dialog-open");
  renderShippingBackupGate();
  requestAnimationFrame(() => elements.chooseHistoryRestoreFilesButton.focus());
}
function closeHistoryRestoreDialog() {
  elements.historyRestoreDialog.hidden = true; document.body.classList.remove("history-restore-dialog-open"); pendingHistoryRestorePlan = null;
  renderShippingBackupGate();
  if (historyRestoreReturnFocus?.focus) historyRestoreReturnFocus.focus(); historyRestoreReturnFocus = null;
}
async function analyzeSelectedHistoryBackups() {
  pendingHistoryRestorePlan = null; elements.confirmHistoryRestoreButton.disabled = true; elements.historyRestoreError.textContent = ""; elements.historyRestoreSummary.textContent = "CSVを検証しています…";
  try {
    await loadScanHistory();
    pendingHistoryRestorePlan = await prepareHistoryRestore(elements.historyRestoreFiles.files, state.history);
    const plan = pendingHistoryRestorePlan;
    elements.historyRestoreSummary.textContent = `選択ファイル：${plan.fileCount}件\n読込履歴：${plan.totalCount}件\n新規復元予定：${plan.restoreCount}件\n重複スキップ：${plan.duplicateCount}件`;
    elements.confirmHistoryRestoreButton.disabled = plan.restoreCount === 0;
    if (!plan.restoreCount) elements.historyRestoreError.textContent = "新しく復元できる履歴はありません。";
    return plan;
  } catch (error) {
    elements.historyRestoreSummary.textContent = "復元はまだ実行されていません。"; elements.historyRestoreError.textContent = error.message || "バックアップCSVを検証できません。";
    return null;
  }
}
async function confirmHistoryRestore() {
  if (!pendingHistoryRestorePlan || elements.confirmHistoryRestoreButton.disabled) return false;
  elements.confirmHistoryRestoreButton.disabled = true;
  try {
    const result = await commitHistoryRestore(pendingHistoryRestorePlan);
    closeHistoryRestoreDialog(); renderHistory();
    elements.historyMessage.textContent = `${result.restored}件を復元しました。${result.duplicates}件は既に存在するためスキップしました。`;
    return true;
  } catch (error) {
    elements.historyRestoreError.textContent = `履歴を復元できませんでした。${error.message || "ブラウザ保存領域を確認してください。"}`; elements.confirmHistoryRestoreButton.disabled = false;
    return false;
  }
}

async function openAdminPasswordDialog(action = "delete") {
  try {
    const credential = await getHistorySetting(ADMIN_PASSWORD_KEY);
    adminPasswordReturnFocus = document.activeElement; elements.adminPasswordDialog.dataset.mode = credential ? "verify" : "setup"; elements.adminPasswordDialog.dataset.action = action;
    elements.adminPasswordHeading.textContent = credential ? "管理者認証" : "管理者パスワード初期設定";
    elements.adminPasswordHelp.textContent = credential ? action === "restore" ? "バックアップCSVから履歴を復元するには管理者パスワードを入力してください。" : "ブラウザ内の履歴を削除するには管理者パスワードを入力してください。バックアップCSVは削除されません。" : "初回のみ、履歴管理用の管理者パスワードを8文字以上で設定してください。パスワード自体は保存しません。";
    elements.adminPasswordConfirmArea.hidden = Boolean(credential); elements.adminPasswordInput.value = ""; elements.adminPasswordConfirmInput.value = ""; elements.adminPasswordError.textContent = "";
    elements.adminPasswordDialog.hidden = false; document.body.classList.add("admin-password-dialog-open"); requestAnimationFrame(() => elements.adminPasswordInput.focus());
    return true;
  } catch (error) {
    console.error("管理者パスワード設定を読み込めません。", error);
    elements.historyMessage.textContent = "管理者認証の設定を読み込めないため、履歴を管理できません。";
    return false;
  }
}
function closeAdminPasswordDialog() { elements.adminPasswordDialog.hidden = true; document.body.classList.remove("admin-password-dialog-open"); renderShippingBackupGate(); if (adminPasswordReturnFocus?.focus) adminPasswordReturnFocus.focus(); adminPasswordReturnFocus = null; }
async function confirmAdminPassword() {
  const password = elements.adminPasswordInput.value, mode = elements.adminPasswordDialog.dataset.mode, action = elements.adminPasswordDialog.dataset.action || "delete";
  try {
    if (mode === "setup") {
      if (password !== elements.adminPasswordConfirmInput.value) throw new Error("確認用パスワードが一致しません。");
      await setHistorySetting(ADMIN_PASSWORD_KEY, await createAdminPasswordCredential(password));
    } else if (!await verifyAdminPassword(password, await getHistorySetting(ADMIN_PASSWORD_KEY))) throw new Error("管理者パスワードが正しくありません。");
    closeAdminPasswordDialog();
    if (action === "restore") { openHistoryRestoreDialog(); return true; }
    if (!confirm("ブラウザ内の読取履歴をすべて削除します。ローカルのバックアップCSVは削除されません。実行しますか？")) return false;
    await clearScanHistory(); elements.historyMessage.textContent = "ブラウザ内の読取履歴をすべて削除しました。バックアップCSVは残っています。"; return true;
  } catch (error) { elements.adminPasswordError.textContent = error.message || "管理者認証に失敗しました。"; elements.adminPasswordInput.focus(); return false; }
}
function cacheElements() {
  elements.backupSettingDisabledReason = document.getElementById("backupSettingDisabledReason");
  ["retryHistorySaveButton", "masterStatusBadge", "shippingBackupGate", "shippingBackupGateTitle", "shippingBackupGateMessage", "shippingBackupSetupButton", "targetStartDate", "targetEndDate", "periodError", "modeStatus", "clearDepartmentButton", "searchDepartmentButton", "currentFacility", "currentDepartment", "currentDepartmentCode", "resultPanel", "resultTitle", "resultMessage", "resultDetails", "pendingProductPanel", "pendingProductNumber", "pendingProductName", "pendingInstruction", "skipButton", "cancelPendingButton", "processingBreakdown", "targetCount", "readCount", "unreadCount", "currentWorkerCode", "changeWorkerButton", "workerCodeDialog", "workerCodeHeading", "workerCodeInput", "workerCodeError", "confirmWorkerButton", "cancelWorkerButton", "departmentSearchDialog", "departmentSearchInput", "departmentSearchCount", "departmentSearchList", "closeDepartmentSearchButton", "adminPasswordDialog", "adminPasswordHeading", "adminPasswordHelp", "adminPasswordInput", "adminPasswordConfirmArea", "adminPasswordConfirmInput", "adminPasswordError", "confirmAdminPasswordButton", "cancelAdminPasswordButton", "historyRestoreDialog", "chooseHistoryRestoreFilesButton", "historyRestoreFiles", "historyRestoreSummary", "historyRestoreError", "confirmHistoryRestoreButton", "cancelHistoryRestoreButton", "scannerBufferStatus", "unreadPeriodLabel", "unreadDepartmentLabel", "unreadTargetCount", "unreadReadCount", "unreadRemainingCount", "unreadList", "printUnreadButton", "shareUnreadPdfButton", "saveUnreadPdfButton", "unreadPrintMessage", "historyStartDate", "historyEndDate", "historyFacility", "historyDepartment", "historyResult", "historySearch", "historyCount", "historyList", "shareHistoryButton", "configureHistoryBackupButton", "historyBackupStatus", "restoreHistoryButton", "clearHistoryButton", "historyMessage", "masterFile", "importMessage", "masterLoaded", "masterFileName", "masterFacilityName", "masterImportedAt", "masterRowCount", "masterMaxDate", "enableAudioButton", "audioStatus", "showSkipBarcodeButton", "skipBarcodePreview", "skipBarcodeSvg", "printSkipBarcodeButton", "closeSkipBarcodeButton"].forEach((id) => { elements[id] = document.getElementById(id); });
}
function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => switchSection(button.dataset.section)));
  elements.clearDepartmentButton.addEventListener("click", handleClearDepartment); elements.searchDepartmentButton.addEventListener("click", openDepartmentSearchDialog); elements.cancelPendingButton.addEventListener("click", handleCancelPending); elements.skipButton.addEventListener("click", handleSkip);
  const handlePeriodChange = () => {
    if (state.historySaving || state.historySaveError) { elements.targetStartDate.value = state.targetStartDate; elements.targetEndDate.value = state.targetEndDate; return; }
    state.targetStartDate = elements.targetStartDate.value; state.targetEndDate = elements.targetEndDate.value;
    if (state.pendingSpdLabel && (!validateTargetPeriod().ok || !isRowInTargetPeriod(state.pendingSpdLabel.row))) cancelPendingSpdLabel();
    saveState(); renderMode(); renderPendingPanel(); renderCounts(); renderUnreadList();
  };
  elements.targetStartDate.addEventListener("change", handlePeriodChange); elements.targetEndDate.addEventListener("change", handlePeriodChange); elements.masterFile.addEventListener("change", () => importMaster(elements.masterFile.files[0]));
  elements.changeWorkerButton.addEventListener("click", () => openWorkerCodeDialog(false, "worker")); elements.confirmWorkerButton.addEventListener("click", confirmWorkerCode); elements.cancelWorkerButton.addEventListener("click", cancelWorkerCodeDialog);
  workerInputController = bindWorkerCodeInput(elements.workerCodeInput, confirmWorkerCode, () => !elements.workerCodeDialog.hidden);
  document.getElementById("incompleteDepartmentsOnly").addEventListener("change", renderDepartmentSearchList);
  elements.departmentSearchInput.addEventListener("input", renderDepartmentSearchList); elements.closeDepartmentSearchButton.addEventListener("click", closeDepartmentSearchDialog);
  [elements.historyStartDate, elements.historyEndDate, elements.historyFacility, elements.historyDepartment, elements.historyResult].forEach((input) => input.addEventListener("change", renderHistory)); elements.historySearch.addEventListener("input", renderHistory);
  elements.shareHistoryButton.addEventListener("click", async () => { try { const method = await shareHistoryCsv(); elements.historyMessage.textContent = method === "shared" ? "共有画面を開きました。メールアプリを選択できます。" : "共有非対応のためCSVをダウンロードしました。"; } catch (error) { if (error.name !== "AbortError") elements.historyMessage.textContent = error.message; } });
  elements.configureHistoryBackupButton.addEventListener("click", handleConfigureHistoryBackup); elements.shippingBackupSetupButton.addEventListener("click", handleReauthorizeHistoryBackup); elements.retryHistorySaveButton.addEventListener("click", retryFailedHistorySave);
  elements.restoreHistoryButton.addEventListener("click", () => openAdminPasswordDialog("restore")); elements.clearHistoryButton.addEventListener("click", () => openAdminPasswordDialog("delete")); elements.confirmAdminPasswordButton.addEventListener("click", confirmAdminPassword); elements.cancelAdminPasswordButton.addEventListener("click", closeAdminPasswordDialog); elements.adminPasswordInput.addEventListener("keydown", (event) => { if (event.key === "Enter" && elements.adminPasswordConfirmArea.hidden) { event.preventDefault(); void confirmAdminPassword(); } }); elements.adminPasswordConfirmInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void confirmAdminPassword(); } });
  elements.chooseHistoryRestoreFilesButton.addEventListener("click", () => { elements.historyRestoreFiles.value = ""; pendingHistoryRestorePlan = null; elements.confirmHistoryRestoreButton.disabled = true; elements.historyRestoreFiles.click(); }); elements.historyRestoreFiles.addEventListener("change", analyzeSelectedHistoryBackups); elements.confirmHistoryRestoreButton.addEventListener("click", confirmHistoryRestore); elements.cancelHistoryRestoreButton.addEventListener("click", closeHistoryRestoreDialog);
  elements.printUnreadButton.addEventListener("click", () => { void printUnreadList(); });
  elements.saveUnreadPdfButton.addEventListener("click", () => { void saveUnreadPdf(); });
  elements.shareUnreadPdfButton.addEventListener("click", () => { void shareUnreadPdf(); });
  elements.enableAudioButton.addEventListener("click", unlockAudio); elements.showSkipBarcodeButton.addEventListener("click", openSkipBarcodePreview); elements.printSkipBarcodeButton.addEventListener("click", () => printSkipBarcode()); elements.closeSkipBarcodeButton.addEventListener("click", closeSkipBarcodePreview); window.addEventListener("keydown", handleGlobalKeydown);
}
async function init() {
  state.initializing = true;
  cacheElements(); restoreState(); initAudio(); bindEvents(); renderAll();
  await Promise.all([loadScanHistory(), restoreHistoryBackup(), loadPendingHistoryBackupIds()]);
  // 同じ作業セッションの内部履歴から、保存直後の終了で失われた処理済状態を補う。
  for (const record of state.history) {
    if (state.workSessionId && record.workSessionId === state.workSessionId && ["OK", "SKIP"].includes(record.result)) {
      state.readLabelKeys.add(record.labelKey); state.processedResults.set(record.labelKey, record.result);
    }
  }
  if (state.masterInfo) saveState();
  if (state.backupStatus === "ready" && pendingHistoryBackupIds.size) {
    try { await flushPendingHistoryBackups(); setBackupStatus("ready", "保留履歴を保存しました"); }
    catch (error) { setBackupStatus("error", "保留履歴を書き込めません（内部保存は維持）"); }
  }
  renderAll();
  state.initializing = false;
  renderShippingBackupGate();
  if (state.historySaveError) showResult("ng", "内部履歴確認失敗・作業停止", state.historySaveError, []);
  else if (!state.masterInfo) showResult("idle", "待機中", "マスターを読み込んでください。", []);
  else if (!state.currentDepartment) showResult("idle", "部署指定待ち", "20桁のオリコンラベルを読み取るか、検索から部署を選択してください。", []);
  else if (!hasWorkerCode()) { showResult("idle", "作業者指定待ち", "作業者コードを指定してください。", []); openWorkerCodeDialog(true, "worker"); }
  else showResult("idle", "待機中", "SPDラベルQRを読み取ってください。", []);
  document.body.dataset.appReady = "true";
}
function isAppUpdateSafe() {
  return appUpdate.ready && !state.historySaveError && !state.historySaving && appUpdate.pendingOperations === 0 && !unreadPdfBusy && (!unreadPdfPreview || unreadPdfPreview.closed) && !state.pendingSpdLabel
    && !["product", "employee"].includes(state.mode) && !state.scannerBuffer
    && !["workerCodeDialog", "departmentSearchDialog", "adminPasswordDialog", "historyRestoreDialog", "skipBarcodePreview"]
      .some((id) => elements[id] && !elements[id].hidden);
}
function renderAppUpdate() {
  const notice = document.getElementById("appUpdateNotice"), button = document.getElementById("applyAppUpdateButton");
  if (!notice || !button) return;
  const pending = Boolean(appUpdate.version || alternateJanUpdate.table);
  notice.hidden = !pending;
  button.disabled = !pending || !isAppUpdateSafe() || appUpdate.reloading;
  button.textContent = appUpdate.version ? "更新して再起動" : "追加JAN表を反映";
  const message = notice.querySelector?.("p");
  if (message) message.textContent = appUpdate.version ? "新しいバージョンがあります。作業完了後に更新してください。" : "新しい追加JAN表があります。作業完了後に反映してください。";
}
function clearAppUpdate() {
  appUpdate.version = "";
  appUpdate.deferred = false;
  appUpdate.reloading = false;
  if (!alternateJanUpdate.table) {
    if (appUpdate.timer !== null) window.clearInterval(appUpdate.timer);
    appUpdate.timer = null;
  }
  renderAppUpdate();
}
function applyAppUpdate(automatic = false) {
  if ((!appUpdate.version && !alternateJanUpdate.table) || appUpdate.reloading || !isAppUpdateSafe()) return false;
  if (!appUpdate.version) {
    // 表だけの変更は安全状態で差し替える。本体PWAの再読込フラグには触れない。
    ALTERNATE_JANS = alternateJanUpdate.table;
    alternateJanUpdate.table = null;
    clearAppUpdate();
    return true;
  }
  {
    // 更新単位の印を再読込後も保持し、古いHTMLが再配信されても無限リロードしない。
    try {
      const key = `spd-update-reloaded:${location.pathname}:${appUpdate.version}`;
      if (automatic && sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
    } catch { if (automatic) return false; }
  }
  appUpdate.reloading = true;
  location.reload();
  return true;
}
function detectAppUpdate(version) {
  if (!version) return;
  // SWの表示だけで完了とせず、実行中のJavaScriptも同じ版になったことを確認する。
  if (version === APP_VERSION) { clearAppUpdate(); return; }
  if (appUpdate.reloading) return;
  if (appUpdate.version === version) return;
  appUpdate.version = version;
  appUpdate.deferred = !isAppUpdateSafe();
  if (!appUpdate.deferred && applyAppUpdate(true)) return;
  renderAppUpdate();
  // 保留した更新は作業完了後も自動実行せず、ボタンの有効状態だけを更新する。
  if (!appUpdate.timer) appUpdate.timer = window.setInterval(renderAppUpdate, 500);
}
function readServiceWorkerVersion(worker) {
  return new Promise((resolve) => {
    if (!worker || typeof MessageChannel === "undefined") { resolve({ version: "" }); return; }
    const channel = new MessageChannel();
    const finish = (version) => { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); resolve(version); };
    const timeout = setTimeout(() => finish({ version: "" }), 3000);
    channel.port1.onmessage = (event) => finish(event.data || { version: "" });
    try { worker.postMessage({ type: "GET_APP_VERSION" }, [channel.port2]); } catch { finish({ version: "" }); }
  });
}
async function checkControlledAppVersion() {
  if (appInitializationPromise) await appInitializationPromise;
  const worker = navigator.serviceWorker.controller;
  const reply = await readServiceWorkerVersion(worker);
  const version = reply.version || "";
  if (worker === navigator.serviceWorker.controller) {
    const label = document.getElementById("serviceWorkerVersion");
    if (label) { label.textContent = version ? `Ver.${version}` : ""; label.hidden = !version; }
    detectAppUpdate(version);
    return version;
  }
  return "";
}
async function handleAppUpdateClick() {
  // すでに反映済みなら通知解除だけ行い、不要な再読込はしない。
  const version = await checkControlledAppVersion();
  if (version || (!appUpdate.version && alternateJanUpdate.table)) return applyAppUpdate();
  return false;
}
function trackUpdateOperation(operation) {
  return async function (...args) {
    appUpdate.pendingOperations += 1;
    renderShippingBackupGate();
    try { return await operation.apply(this, args); }
    finally { appUpdate.pendingOperations -= 1; renderShippingBackupGate(); }
  };
}
// 非同期処理開始から完了までを数え、照合完了直後の未保存時間帯も更新を止める。
saveScanHistory = trackUpdateOperation(saveScanHistory);
setHistorySetting = trackUpdateOperation(setHistorySetting);
clearScanHistory = trackUpdateOperation(clearScanHistory);
enqueueHistoryBackup = trackUpdateOperation(enqueueHistoryBackup);
importMaster = trackUpdateOperation(importMaster);
configureHistoryBackup = trackUpdateOperation(configureHistoryBackup);
commitHistoryRestore = trackUpdateOperation(commitHistoryRestore);
analyzeSelectedHistoryBackups = trackUpdateOperation(analyzeSelectedHistoryBackups);
confirmAdminPassword = trackUpdateOperation(confirmAdminPassword);
openAdminPasswordDialog = trackUpdateOperation(openAdminPasswordDialog);
shareHistoryCsv = trackUpdateOperation(shareHistoryCsv);

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.addEventListener("controllerchange", () => { void checkControlledAppVersion(); });
    window.addEventListener("load", async () => {
      document.getElementById("applyAppUpdateButton")?.addEventListener("click", handleAppUpdateClick);
      try {
        const registration = await navigator.serviceWorker.register("./service-worker.js", { updateViaCache: "none" });
        try { await registration.update(); } catch (error) { console.info("最新版確認ができないため、現在の版を継続します。", error); }
        await checkControlledAppVersion();
      } catch (error) { console.error("オフライン機能を登録できません。", error); }
      await checkAlternateJanUpdate();
    });
  }
}
if (typeof window !== "undefined") registerServiceWorker();
if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  appInitializationPromise = init().then(() => { appUpdate.ready = true; if (appUpdate.version) renderAppUpdate(); });
});

if (typeof module !== "undefined" && module.exports) module.exports = {
  state, FACILITY_CENTER_MAP, parseTsv, normalizeQr, buildLabelKey, getExpectedCenterCode, rebuildIndexes, findLabel,
  parseContainerBarcode, setContainerDepartment, clearContainerDepartment, reconcileCurrentDepartment, getMasterDepartments, filterMasterDepartments, selectDepartment,
  validateSpdLabel, setPendingSpdLabel, acceptPendingSpdLabel, cancelPendingSpdLabel, validateTargetPeriod, getCurrentTargetLabels,
  usesDesktopPdfSave, saveUnreadPdf, createUnreadPdfReport, printUnreadList, shareUnreadPdf, openUnreadPdfLoadingWindow, getUnreadLabels, getTargetCounts, normalizeJanForComparison, detectProductBarcodeType, parseGs1Barcode,
  extractJanFromBarcode, validateProductBarcode, completeItemCheck, canSkip, canConfirmSkip, startSkipProcess, executeSkip, cancelSkipProcess, processProductScanValue,
  createHistoryRecord, saveScanHistory, loadScanHistory, clearScanHistory, filterHistory, buildHistoryCsv,
  shareHistoryCsv, handleContainerDepartmentScan, applyMasterData, isValidDateKey, normalizeLabelKey,
  parseDateInput, todayInputValue, getProductNumber, getUniqueFacilityNames, getMasterFacilityName, getMasterFacilitySettings, getCode128BValues, getCode128ModuleRuns, printSkipBarcode,
  normalizeWorkerCode, bindWorkerCodeInput, getDepartmentProgress, hasWorkerCode, setWorkerCode, confirmWorkerCodeValue, createHistoryId, historyBackupFileName, historyBackupRow, historyBackupHeader, backupTextContainsHistoryId, writeHistoryBackupRecord, isHistoryBackupSupported, isShippingBackupReady, isShippingWorkInProgress, canContinueCurrentShippingWork, getShippingBackupBlockResult, configureHistoryBackup,
  parseCsvRecords, parseHistoryBackupCsv, prepareHistoryRestore, commitHistoryRestore,
  deriveAdminPasswordHash, createAdminPasswordCredential, verifyAdminPassword, SKIP_COMMAND
};
