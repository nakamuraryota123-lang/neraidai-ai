const STORE_KEY = "neraidai-v04";
const LEGACY_KEY = "neraidai-v03";
const DB_NAME = "neraidai-ai";
const DB_VERSION = 1;
const SCREENSHOT_STORE = "screenshots";
const isTestRuntime = globalThis.__NERAIDAI_TEST__ === true;
const API_URL = isTestRuntime ? "" : document.querySelector('meta[name="neraidai-api-url"]')?.content?.trim() || "";

const graphPatterns = {
  uptrend: "右肩上がり",
  downtrend: "右肩下がり",
  v_recovery: "V字回復",
  inverted_v: "山型",
  flat: "横ばい",
  spike: "一撃型",
  multiple_waves: "複数波",
  inactive: "未稼働",
  unknown: "不明"
};

const machineCatalog = [
  {
    id: "l_shinuchi_yoshimune",
    name: "L真打吉宗",
    aliases: ["L真打吉宗", "真打吉宗", "Ｌ真打吉宗", "L 真打吉宗", "スマスロ真打吉宗"]
  }
];

function machineKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[\s・･_＿\-ー]/g, "").replace(/[()（）【】\[\]]/g, "");
}

function canonicalMachine(value) {
  const raw = String(value || "").trim();
  const key = machineKey(raw);
  const known = machineCatalog.find((machine) => machine.aliases.some((alias) => machineKey(alias) === key))
    || (key.includes("真打") && key.includes("吉宗") ? machineCatalog[0] : null);
  if (known) return { machineId: known.id, machine: known.name };
  return { machineId: `custom:${key || "unknown"}`, machine: raw || "機種未設定" };
}

function placementKey(value) {
  const normalized = String(value || "").normalize("NFKC").trim();
  const digits = normalized.replace(/\D/g, "");
  if (digits) return String(Number.parseInt(digits, 10));
  return normalized.toLowerCase().replace(/\s/g, "");
}

function normalizeStoredRecord(record = {}) {
  return { ...record, ...canonicalMachine(record.machine) };
}

function normalizePrediction(prediction = {}) {
  return {
    ...prediction,
    entries: Array.isArray(prediction.entries) ? prediction.entries.map((entry) => ({
      ...entry,
      positionKey: placementKey(entry.positionKey || entry.position || entry.unit)
    })) : [],
    updatedAt: prediction.updatedAt || prediction.createdAt || ""
  };
}

const today = new Date().toISOString().slice(0, 10);
const state = loadState();
persist();
localStorage.removeItem(LEGACY_KEY);
let selectedFiles = [];
let previewUrls = [];
let reviewData = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  try {
    const current = JSON.parse(localStorage.getItem(STORE_KEY));
    if (current?.records) {
      const settings = current.settings || {};
      delete settings.openaiKey;
      return {
        records: current.records.map(normalizeStoredRecord),
        settings,
        deletedRecordIds: Array.isArray(current.deletedRecordIds) ? current.deletedRecordIds : [],
        predictions: Array.isArray(current.predictions) ? current.predictions.map(normalizePrediction) : []
      };
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy?.records) {
      return {
        records: legacy.records.map((record) => normalizeStoredRecord({
          ...record,
          maxPayout: Math.max(0, Number(record.maxPayout ?? record.difference ?? 0)),
          graphPattern: record.graphPattern || (Number(record.difference) > 0 ? "uptrend" : "unknown")
        })),
        settings: (() => { const settings = legacy.settings || {}; delete settings.openaiKey; return settings; })(),
        deletedRecordIds: [],
        predictions: []
      };
    }
  } catch (error) {
    console.warn("保存データを読み込めませんでした", error);
  }
  return { records: [], settings: {}, deletedRecordIds: [], predictions: [] };
}

function persist() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
}

function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.className = isError ? "show error" : "show";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.className = ""; }, 3200);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SCREENSHOT_STORE)) {
        const store = request.result.createObjectStore(SCREENSHOT_STORE, { keyPath: "id" });
        store.createIndex("batchId", "batchId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveScreenshots(batchId) {
  if (!selectedFiles.length) return [];
  const db = await openDb();
  const ids = selectedFiles.map(() => uid("shot"));
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE, "readwrite");
    const store = tx.objectStore(SCREENSHOT_STORE);
    selectedFiles.forEach((file, index) => store.add({
      id: ids[index], batchId, name: file.name, type: file.type,
      size: file.size, createdAt: new Date().toISOString(), blob: file
    }));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("画像保存が中断されました"));
  });
  db.close();
  return ids;
}

async function clearScreenshots() {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(SCREENSHOT_STORE, "readwrite");
    tx.objectStore(SCREENSHOT_STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function showPage(pageId) {
  $$(".page").forEach((page) => page.classList.toggle("active", page.id === pageId));
  $$(".nav").forEach((nav) => nav.classList.toggle("active", nav.dataset.page === pageId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setMode(mode) {
  $$(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("#screenshotPanel").classList.toggle("hidden", mode !== "screenshot");
  $("#recordForm").classList.toggle("hidden", mode !== "manual");
  if (mode !== "screenshot") $("#reviewForm").classList.add("hidden");
}

function populateGraphSelects() {
  const options = Object.entries(graphPatterns).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  $("#graphPattern").innerHTML = options;
}

function renderImages() {
  previewUrls.forEach(URL.revokeObjectURL);
  previewUrls = selectedFiles.map((file) => URL.createObjectURL(file));
  $("#imageList").innerHTML = selectedFiles.map((file, index) => `
    <article class="image-card">
      <img src="${previewUrls[index]}" alt="${escapeHtml(file.name)}">
      <div><b>${escapeHtml(file.name)}</b><small>${(file.size / 1024).toFixed(0)} KB</small></div>
      <button type="button" data-remove-file="${index}" aria-label="${escapeHtml(file.name)}を削除">×</button>
    </article>`).join("");
  $("#analyzeAll").disabled = !selectedFiles.length;
}

function normalizeRow(row = {}) {
  const text = (value, fallback = "") => value == null ? fallback : String(value);
  const number = (value) => Math.max(0, Number.parseInt(value, 10) || 0);
  return {
    date: /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : today,
    hall: "キクヤ堺本店",
    ...canonicalMachine(row.machine),
    position: text(row.position || row.unit),
    unit: text(row.unit || row.position),
    games: number(row.games), bb: number(row.bb), rb: number(row.rb),
    maxPayout: number(row.maxPayout),
    graphPattern: graphPatterns[row.graphPattern] ? row.graphPattern : "unknown",
    memo: text(row.memo)
  };
}

function rowInput(index, field, type = "text", extra = "") {
  const value = escapeHtml(reviewData[index][field]);
  return `<input data-row="${index}" data-field="${field}" type="${type}" value="${value}" ${extra}>`;
}

function renderReview() {
  $("#reviewRows").innerHTML = reviewData.map((row, index) => `
    <tr>
      <td>${rowInput(index, "date", "date", "required")}</td>
      <td>${rowInput(index, "hall", "text", "required")}</td>
      <td>${rowInput(index, "machine", "text", "required")}</td>
      <td>${rowInput(index, "position", "text", "required")}</td>
      <td>${rowInput(index, "unit", "text", "required inputmode=\"numeric\"")}</td>
      <td>${rowInput(index, "games", "number", "min=\"0\" required")}</td>
      <td>${rowInput(index, "bb", "number", "min=\"0\" required")}</td>
      <td>${rowInput(index, "rb", "number", "min=\"0\" required")}</td>
      <td>${rowInput(index, "maxPayout", "number", "min=\"0\" required")}</td>
      <td><select data-row="${index}" data-field="graphPattern">${Object.entries(graphPatterns).map(([value, label]) => `<option value="${value}" ${row.graphPattern === value ? "selected" : ""}>${label}</option>`).join("")}</select></td>
      <td>${rowInput(index, "memo")}</td>
      <td><button class="row-delete" type="button" data-remove-row="${index}" aria-label="行を削除">×</button></td>
    </tr>`).join("");
  $("#reviewForm").classList.remove("hidden");
}

function syncReviewData() {
  $$("#reviewRows [data-row][data-field]").forEach((input) => {
    reviewData[Number(input.dataset.row)][input.dataset.field] = input.value;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function analyzeAll() {
  if (!API_URL) {
    toast("AIバックエンドを準備中です。管理者へ確認してください", true);
    return;
  }
  if (!selectedFiles.length) return;
  const button = $("#analyzeAll");
  button.disabled = true;
  button.textContent = `${selectedFiles.length}枚を読み取り中…`;
  try {
    const images = await Promise.all(selectedFiles.map(fileToDataUrl));
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images, today })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `APIエラー (${response.status})`);
    if (!Array.isArray(payload.rows)) throw new Error("読取結果の形式が正しくありません");
    reviewData = payload.rows.map(normalizeRow);
    if (!reviewData.length) reviewData = [normalizeRow()];
    renderReview();
    $("#reviewForm").scrollIntoView({ behavior: "smooth" });
    toast(`${reviewData.length}台分を読み取りました`);
  } catch (error) {
    console.error(error);
    toast(`読み取りに失敗しました: ${error.message}`, true);
  } finally {
    button.disabled = !selectedFiles.length;
    button.textContent = "AIでまとめて読み取る";
  }
}

function makeRecord(row, extra = {}) {
  const normalized = normalizeRow(row);
  return { id: uid("record"), ...normalized, ...extra, createdAt: new Date().toISOString() };
}

async function saveReview(event) {
  event.preventDefault();
  syncReviewData();
  const rows = reviewData.map(normalizeRow);
  if (!rows.length || rows.some((row) => !row.date || !row.hall || !row.machine || !row.position || !row.unit)) {
    toast("日付・ホール・機種・配置番号・台番号を確認してください", true);
    return;
  }
  const submit = $("#reviewForm button[type=submit]");
  submit.disabled = true;
  try {
    const batchId = uid("batch");
    const screenshotIds = await saveScreenshots(batchId);
    state.records.push(...rows.map((row) => makeRecord(row, { batchId, screenshotIds })));
    persist();
    reviewData = [];
    selectedFiles = [];
    renderImages();
    $("#reviewForm").classList.add("hidden");
    renderAll();
    showPage("dashboard");
    toast(`${rows.length}台分と元画像${screenshotIds.length}枚を端末に保存し、ランキングを再計算しました`);
  } catch (error) {
    console.error(error);
    toast(`保存に失敗しました: ${error.message}`, true);
  } finally {
    submit.disabled = false;
  }
}

function saveManual(event) {
  event.preventDefault();
  const row = Object.fromEntries(["date", "hall", "machine", "position", "unit", "games", "bb", "rb", "maxPayout", "graphPattern", "memo"].map((id) => [id, $(`#${id}`).value]));
  state.records.push(makeRecord(row));
  persist();
  renderAll();
  showPage("dashboard");
  toast("保存してランキングを再計算しました");
}

function scoreRecord(record) {
  const games = Number(record.games) || 0;
  if (!games) return {
    score: 0,
    reason: "未稼働データ（ランキング対象外）",
    reasons: ["稼働0Gのため判定対象外"],
    scoreBreakdown: { base: 0, volume: 0, hitRate: 0, graph: 0, payout: 0, total: 0 }
  };
  const hitsPer1000 = ((Number(record.bb) || 0) + (Number(record.rb) || 0)) / games * 1000;
  const scoreBreakdown = {
    base: 35,
    volume: Math.min(25, games / 240),
    hitRate: Math.min(20, hitsPer1000 * 2),
    graph: { uptrend: 12, multiple_waves: 8, v_recovery: 6, flat: 1, unknown: 0, inverted_v: -2, spike: -3, downtrend: -8, inactive: -25 }[record.graphPattern] || 0,
    payout: Math.min(8, (Number(record.maxPayout) || 0) / 800)
  };
  const score = Math.round(Math.max(0, Math.min(100, Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0))));
  scoreBreakdown.total = score;
  const reason = `${games.toLocaleString()}G・初当たり${hitsPer1000.toFixed(1)}/千G・${graphPatterns[record.graphPattern] || "不明"}`;
  const reasons = [
    `${games.toLocaleString()}Gの稼働量`,
    `BIG+REGが${hitsPer1000.toFixed(1)}回/千G`,
    `グラフ形状は${graphPatterns[record.graphPattern] || "不明"}`,
    `最大放出${Number(record.maxPayout || 0).toLocaleString()}枚`
  ];
  return { score, reason, reasons, scoreBreakdown };
}

function rankedRecords(records = state.records) {
  const latestByUnit = new Map();
  [...records].sort((a, b) => String(a.updatedAt || a.createdAt).localeCompare(String(b.updatedAt || b.createdAt))).forEach((record) => {
    const stablePosition = placementKey(record.position || record.unit);
    latestByUnit.set(`${record.hall}|${record.machineId || canonicalMachine(record.machine).machineId}|${stablePosition}`, record);
  });
  return [...latestByUnit.values()].map((record) => ({ ...record, ...scoreRecord(record) })).sort((a, b) => b.score - a.score || Number(a.unit) - Number(b.unit));
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function createPredictionSnapshots(records, predictionDate, targetDate = addDays(predictionDate, 1), idFactory = uid) {
  const groups = new Map();
  rankedRecords(records).filter((record) => Number(record.games) > 0).forEach((record) => {
    const machine = canonicalMachine(record.machine);
    const key = `${record.hall}|${record.machineId || machine.machineId}`;
    if (!groups.has(key)) groups.set(key, { hall: record.hall, machineId: record.machineId || machine.machineId, entries: [] });
    groups.get(key).entries.push(record);
  });
  const now = new Date().toISOString();
  return [...groups.values()].map((group) => ({
    id: idFactory("prediction"),
    predictionDate,
    targetDate,
    hall: group.hall,
    machineId: group.machineId,
    createdAt: now,
    updatedAt: now,
    entries: group.entries.map((record, index) => ({
      rank: index + 1,
      positionKey: placementKey(record.position || record.unit),
      position: String(record.position || record.unit || ""),
      unit: String(record.unit || record.position || ""),
      score: record.score,
      scoreBreakdown: { ...record.scoreBreakdown },
      reasons: [...record.reasons]
    }))
  }));
}

function mergePredictions(remote = [], local = []) {
  const merged = new Map();
  [...remote, ...local].map(normalizePrediction).filter((item) => item.id).forEach((item) => {
    const current = merged.get(item.id);
    const itemTime = String(item.updatedAt || item.createdAt || "");
    const currentTime = String(current?.updatedAt || current?.createdAt || "");
    if (!current || itemTime >= currentTime) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function evaluatePrediction(prediction, records, evaluatedAt = new Date().toISOString()) {
  const latestResults = new Map();
  records.filter((record) => record.date === prediction.targetDate
    && record.hall === prediction.hall
    && (record.machineId || canonicalMachine(record.machine).machineId) === prediction.machineId)
    .sort((a, b) => String(a.updatedAt || a.createdAt).localeCompare(String(b.updatedAt || b.createdAt)))
    .forEach((record) => latestResults.set(placementKey(record.position || record.unit), record));

  const top3 = prediction.entries.filter((entry) => entry.rank <= 3);
  const results = top3.map((entry) => {
    const actual = latestResults.get(placementKey(entry.positionKey || entry.position || entry.unit));
    const eligible = Boolean(actual && Number(actual.games) > 0);
    return {
      rank: entry.rank,
      positionKey: entry.positionKey,
      unit: entry.unit,
      eligible,
      hit: eligible && Number(actual.maxPayout) >= 2000,
      games: actual ? Number(actual.games) || 0 : null,
      maxPayout: actual ? Number(actual.maxPayout) || 0 : null
    };
  });
  const eligibleCount = results.filter((item) => item.eligible).length;
  if (!eligibleCount) return null;
  const hitCount = results.filter((item) => item.hit).length;
  const misses = results.filter((item) => item.eligible && !item.hit).length;
  return {
    evaluatedAt,
    criteria: { maxPayoutAtLeast: 2000, inactiveExcluded: true },
    top3Count: top3.length,
    eligibleCount,
    hitCount,
    hitRate: Math.round(hitCount / eligibleCount * 100),
    results,
    goodPoints: hitCount ? [`上位3台から${hitCount}台が2,000枚以上を記録`] : ["予想時点の根拠と実績を同じ配置で比較できた"],
    reflectionPoints: misses ? [`判定対象${eligibleCount}台のうち${misses}台が2,000枚未満`] : ["判定対象の上位台はすべて的中"],
    improvements: misses ? ["外れた台のグラフ形状と初当たり比率を次回の重み調整候補にする"] : ["同じ基準で予想を継続し、再現性を確認する"]
  };
}

function evaluatePredictions(predictions, records, now = new Date().toISOString()) {
  let changed = false;
  const currentDate = now.slice(0, 10);
  const next = predictions.map((prediction) => {
    if (prediction.targetDate > currentDate) return prediction;
    const evaluation = evaluatePrediction(prediction, records, now);
    if (!evaluation) return prediction;
    const comparable = JSON.stringify({ ...evaluation, evaluatedAt: undefined });
    const previous = JSON.stringify({ ...prediction.evaluation, evaluatedAt: undefined });
    if (comparable === previous) return prediction;
    changed = true;
    return { ...prediction, evaluation, updatedAt: now };
  });
  return { predictions: next, changed };
}

function renderRanking() {
  const ranked = rankedRecords();
  const active = ranked.filter((record) => record.games > 0);
  $("#summary").innerHTML = `<div><b>${state.records.length}</b><span>保存件数</span></div><div><b>${active.length}</b><span>稼働台</span></div><div><b>${active[0]?.score ?? 0}</b><span>最高スコア</span></div>`;
  $("#ranking").className = ranked.length ? "ranking" : "ranking empty-card";
  $("#ranking").innerHTML = ranked.length ? ranked.map((record, index) => `
    <article class="rank-card ${index === 0 ? "top" : ""}">
      <span class="rank">${index + 1}</span><div class="rank-main"><b>配置 ${escapeHtml(record.position)} / 台 ${escapeHtml(record.unit)}</b><small>${escapeHtml(record.hall)}・${escapeHtml(record.machine)}</small><p>${escapeHtml(record.reason)}</p><button class="reason-toggle" type="button" data-reason-index="${index}" aria-expanded="false">狙い根拠を見る</button><div class="score-detail hidden" data-reason-detail="${index}"><div class="breakdown"><span>基礎 <b>${record.scoreBreakdown.base.toFixed(0)}</b></span><span>稼働 <b>${record.scoreBreakdown.volume.toFixed(1)}</b></span><span>初当たり <b>${record.scoreBreakdown.hitRate.toFixed(1)}</b></span><span>グラフ <b>${record.scoreBreakdown.graph.toFixed(0)}</b></span><span>放出 <b>${record.scoreBreakdown.payout.toFixed(1)}</b></span></div><ul>${record.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></div></div><strong>${record.score}<small>点</small></strong>
    </article>`).join("") : `<p>まだ記録がありません。入力画面から今日のスクリーンショットを追加してください。</p>`;
}

function savePrediction() {
  const snapshots = createPredictionSnapshots(state.records, today);
  if (!snapshots.length) {
    toast("稼働データがないため予想を保存できません", true);
    return;
  }
  const existingKeys = new Set(state.predictions.map((item) => `${item.predictionDate}|${item.targetDate}|${item.hall}|${item.machineId}`));
  const additions = snapshots.filter((item) => !existingKeys.has(`${item.predictionDate}|${item.targetDate}|${item.hall}|${item.machineId}`));
  if (!additions.length) {
    toast("明日分の予想はすでに保存されています。予想時点の内容は変更しません", true);
    return;
  }
  state.predictions.push(...additions);
  persist(); renderPredictionReview();
  toast(`明日（${additions[0].targetDate}）の予想を保存しました`);
}

function renderPredictionReview() {
  const saved = [...state.predictions].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  $("#predictionCount").textContent = `${saved.length}件保存`;
  const review = saved.find((item) => item.targetDate === today && item.evaluation)
    || saved.find((item) => item.evaluation);
  if (!review) {
    $("#predictionReview").className = "panel prediction-review empty-card";
    $("#predictionReview").innerHTML = "<p>予想を保存し、翌日の実績を入力すると上位3台を自動で答え合わせします。</p>";
    return;
  }
  const evaluation = review.evaluation;
  $("#predictionReview").className = "panel prediction-review";
  $("#predictionReview").innerHTML = `
    <div class="review-score"><div><span>昨日の予想・上位3台（${escapeHtml(review.targetDate)}実績）</span><b>${evaluation.hitCount}/${evaluation.eligibleCount}台 的中</b></div><strong>${evaluation.hitRate}<small>%</small></strong></div>
    <p class="hint">的中基準：最大放出2,000枚以上（0Gは対象外）</p>
    <div class="evaluation-results">${evaluation.results.map((item) => `<div class="${item.eligible ? (item.hit ? "hit" : "miss") : "excluded"}"><b>${item.rank}位・台${escapeHtml(item.unit)}</b><span>${item.eligible ? `${Number(item.maxPayout).toLocaleString()}枚 ${item.hit ? "的中" : "未的中"}` : "未入力または0G"}</span></div>`).join("")}</div>
    <div class="reflection-grid"><section><h3>良かった点</h3><ul>${evaluation.goodPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section><section><h3>反省点</h3><ul>${evaluation.reflectionPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section><section><h3>次回改善案</h3><ul>${evaluation.improvements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section></div>`;
}

function renderHistory() {
  const records = [...state.records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const max = Math.max(1, ...records.map((record) => Number(record.maxPayout) || 0));
  $("#chart").innerHTML = records.length ? `<div class="bars">${records.slice(0, 16).reverse().map((record) => `<div title="台${escapeHtml(record.unit)}: ${Number(record.maxPayout).toLocaleString()}枚"><span style="height:${Math.max(4, (Number(record.maxPayout) || 0) / max * 100)}%"></span><small>${escapeHtml(record.unit)}</small></div>`).join("")}</div>` : "<p>記録が増えると最大放出の比較を表示します。</p>";
  $("#historyList").innerHTML = records.map((record) => `
    <article class="history-card"><div class="history-card-heading"><div><b>${escapeHtml(record.date)}　${escapeHtml(record.hall)}</b><span>${escapeHtml(record.machine)} / 配置 ${escapeHtml(record.position)} / 台 ${escapeHtml(record.unit)}</span></div><div class="history-actions"><button class="history-edit" type="button" data-edit-record="${escapeHtml(record.id)}" aria-label="この履歴の機種名を編集">編集</button><button class="history-delete" type="button" data-delete-record="${escapeHtml(record.id)}" aria-label="この履歴を削除">削除</button></div></div><dl><div><dt>総回転</dt><dd>${Number(record.games).toLocaleString()}</dd></div><div><dt>BIG / REG</dt><dd>${record.bb} / ${record.rb}</dd></div><div><dt>最大放出</dt><dd>${Number(record.maxPayout).toLocaleString()}</dd></div><div><dt>グラフ</dt><dd>${graphPatterns[record.graphPattern] || "不明"}</dd></div></dl>${record.memo ? `<p>${escapeHtml(record.memo)}</p>` : ""}</article>`).join("");
}

function editRecordMachine(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  const entered = prompt("正しい機種名を入力してください", record.machine);
  if (entered == null) return;
  const canonical = canonicalMachine(entered);
  const oldKey = machineKey(record.machine);
  const sameVariant = state.records.filter((item) => machineKey(item.machine) === oldKey);
  const updateAll = sameVariant.length > 1 && confirm(`同じ表記「${record.machine}」の履歴 ${sameVariant.length}件を、すべて「${canonical.machine}」へ統合しますか？`);
  const targets = updateAll ? sameVariant : [record];
  targets.forEach((item) => Object.assign(item, canonical, { updatedAt: new Date().toISOString() }));
  persist(); renderAll();
  toast(`${targets.length}件の機種名を「${canonical.machine}」へ統合しました。Drive同期で他端末にも反映されます`);
}

function deleteRecord(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  if (!confirm(`${record.date} / 台 ${record.unit} の履歴を削除しますか？`)) return;
  state.records = state.records.filter((item) => item.id !== recordId);
  state.deletedRecordIds = [...new Set([...(state.deletedRecordIds || []), recordId])];
  persist();
  renderAll();
  toast("履歴を1件削除しました。次回のDrive同期で他端末にも反映されます");
}

function renderAll() {
  const evaluated = evaluatePredictions(state.predictions || [], state.records);
  if (evaluated.changed) {
    state.predictions = evaluated.predictions;
    persist();
  }
  renderRanking();
  renderHistory();
  renderPredictionReview();
}

function exportJson() {
  const data = JSON.stringify({ version: "0.5", exportedAt: new Date().toISOString(), records: state.records, deletedRecordIds: state.deletedRecordIds || [], predictions: state.predictions || [] }, null, 2);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  link.download = `neraidai-v04-${today}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function addDemoData() {
  const samples = [
    { position: "101", unit: "0531", games: 7240, bb: 32, rb: 24, maxPayout: 4200, graphPattern: "uptrend", memo: "終日安定" },
    { position: "102", unit: "0532", games: 6080, bb: 25, rb: 19, maxPayout: 2800, graphPattern: "multiple_waves", memo: "後半持ち直し" },
    { position: "103", unit: "0533", games: 0, bb: 0, rb: 0, maxPayout: 0, graphPattern: "inactive", memo: "未稼働" }
  ];
  state.records.push(...samples.map((sample) => makeRecord({ date: today, hall: "キクヤ堺本店", machine: "L真打吉宗", ...sample })));
  persist(); renderAll(); toast("サンプル3台分を追加しました");
}

async function clearAll() {
  if (!confirm("記録と端末内スクリーンショットをすべて削除しますか？")) return;
  state.deletedRecordIds = [...new Set([...(state.deletedRecordIds || []), ...state.records.map((record) => record.id).filter(Boolean)])];
  state.records = [];
  persist();
  await clearScreenshots();
  renderAll();
  toast("すべてのデータを削除しました");
}

function saveSettings(event) {
  event.preventDefault();
  state.settings.googleClientId = $("#googleClientId").value.trim();
  persist(); toast("この端末に設定を保存しました");
}

function extractDriveRecords(payload) {
  return Array.isArray(payload?.records) ? payload.records.map(normalizeStoredRecord) : [];
}

function extractDeletedRecordIds(payload) {
  return Array.isArray(payload?.deletedRecordIds) ? payload.deletedRecordIds : [];
}

function extractDrivePredictions(payload) {
  return Array.isArray(payload?.predictions) ? payload.predictions.map(normalizePrediction) : [];
}

async function syncDrive() {
  const clientId = state.settings.googleClientId?.trim();
  if (!clientId || !window.google?.accounts?.oauth2) {
    showPage("settings"); toast("Google OAuth クライアントIDを設定してください", true); return;
  }
  const button = $("#syncBtn");
  button.disabled = true;
  try {
    const token = await new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: "https://www.googleapis.com/auth/drive.appdata", callback: (response) => response.error ? reject(new Error(response.error)) : resolve(response.access_token) });
      client.requestAccessToken({ prompt: "" });
    });
    const headers = { Authorization: `Bearer ${token}` };
    const list = await fetch("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27neraidai-v04.json%27&fields=files(id,modifiedTime)", { headers }).then((response) => response.json());
    if (list.files?.length) {
      const remote = await fetch(`https://www.googleapis.com/drive/v3/files/${list.files[0].id}?alt=media`, { headers }).then((response) => response.json());
      state.deletedRecordIds = [...new Set([...(state.deletedRecordIds || []), ...extractDeletedRecordIds(remote)])];
      const deleted = new Set(state.deletedRecordIds);
      const merged = new Map([...extractDriveRecords(remote), ...state.records].filter((record) => record.id && !deleted.has(record.id)).map((record) => [record.id, record]));
      state.records = [...merged.values()].map(normalizeStoredRecord);
      state.predictions = mergePredictions(extractDrivePredictions(remote), state.predictions || []);
    }
    const metadata = { name: "neraidai-v04.json", parents: list.files?.length ? undefined : ["appDataFolder"] };
    const boundary = `neraidai_${Date.now()}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ version: "0.5", records: state.records, deletedRecordIds: state.deletedRecordIds || [], predictions: state.predictions || [] })}\r\n--${boundary}--`;
    const fileId = list.files?.[0]?.id;
    const url = fileId ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart` : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const response = await fetch(url, { method: fileId ? "PATCH" : "POST", headers: { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    if (!response.ok) throw new Error(`Drive APIエラー (${response.status})`);
    persist(); renderAll(); $("#syncDot").classList.add("online"); toast("Google Driveと記録を同期しました");
  } catch (error) {
    console.error(error); toast(`Drive同期に失敗しました: ${error.message}`, true);
  } finally { button.disabled = false; }
}

if (!isTestRuntime) {
$$('.nav').forEach((button) => button.addEventListener('click', () => showPage(button.dataset.page)));
$$('.mode').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
$("#pickScreenshots").addEventListener("click", () => $("#screenshots").click());
$("#screenshots").addEventListener("change", (event) => { selectedFiles = [...selectedFiles, ...event.target.files].filter((file, index, files) => files.findIndex((other) => other.name === file.name && other.size === file.size && other.lastModified === file.lastModified) === index); event.target.value = ""; renderImages(); });
$("#imageList").addEventListener("click", (event) => { const index = event.target.dataset.removeFile; if (index != null) { selectedFiles.splice(Number(index), 1); renderImages(); } });
$("#analyzeAll").addEventListener("click", analyzeAll);
$("#reviewForm").addEventListener("submit", saveReview);
$("#addReviewRow").addEventListener("click", () => { syncReviewData(); reviewData.push(normalizeRow()); renderReview(); });
$("#reviewRows").addEventListener("click", (event) => { const index = event.target.dataset.removeRow; if (index != null) { syncReviewData(); reviewData.splice(Number(index), 1); renderReview(); } });
$("#recordForm").addEventListener("submit", saveManual);
$("#settingsForm").addEventListener("submit", saveSettings);
$("#refreshScore").addEventListener("click", () => { renderRanking(); toast("ランキングを再計算しました"); });
$("#savePrediction").addEventListener("click", savePrediction);
$("#ranking").addEventListener("click", (event) => {
  const index = event.target.dataset.reasonIndex;
  if (index == null) return;
  const detail = $(`[data-reason-detail="${index}"]`);
  const expanded = !detail.classList.contains("hidden");
  detail.classList.toggle("hidden", expanded);
  event.target.setAttribute("aria-expanded", String(!expanded));
  event.target.textContent = expanded ? "狙い根拠を見る" : "根拠を閉じる";
});
$("#exportBtn").addEventListener("click", exportJson);
$("#historyList").addEventListener("click", (event) => {
  const editId = event.target.dataset.editRecord;
  const deleteId = event.target.dataset.deleteRecord;
  if (editId) editRecordMachine(editId);
  if (deleteId) deleteRecord(deleteId);
});
$("#demoBtn").addEventListener("click", addDemoData);
$("#clearBtn").addEventListener("click", clearAll);
$("#syncBtn").addEventListener("click", syncDrive);

$("#date").value = today;
$("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date());
$("#googleClientId").value = state.settings.googleClientId || "";
populateGraphSelects();
renderAll();

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

export {
  addDays,
  canonicalMachine,
  createPredictionSnapshots,
  evaluatePrediction,
  evaluatePredictions,
  loadState,
  mergePredictions,
  normalizePrediction,
  placementKey,
  rankedRecords,
  scoreRecord
};
