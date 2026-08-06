const STORE_KEY = "neraidai-v04";
const LEGACY_KEY = "neraidai-v03";
const DB_NAME = "neraidai-ai";
const DB_VERSION = 1;
const SCREENSHOT_STORE = "screenshots";

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

const today = new Date().toISOString().slice(0, 10);
const state = loadState();
let selectedFiles = [];
let previewUrls = [];
let reviewData = [];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  try {
    const current = JSON.parse(localStorage.getItem(STORE_KEY));
    if (current?.records) return { records: current.records, settings: current.settings || {} };
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy?.records) {
      return {
        records: legacy.records.map((record) => ({
          ...record,
          maxPayout: Math.max(0, Number(record.maxPayout ?? record.difference ?? 0)),
          graphPattern: record.graphPattern || (Number(record.difference) > 0 ? "uptrend" : "unknown")
        })),
        settings: legacy.settings || {}
      };
    }
  } catch (error) {
    console.warn("保存データを読み込めませんでした", error);
  }
  return { records: [], settings: {} };
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
    hall: text(row.hall, $("#hall").value || "キクヤ堺本店"),
    machine: text(row.machine, $("#machine").value || "L真打吉宗"),
    position: text(row.position),
    unit: text(row.unit),
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

function parseResponseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.rows)) throw new Error("AI応答にrows配列がありません");
  return parsed.rows;
}

async function analyzeAll() {
  const key = state.settings.openaiKey?.trim();
  if (!key) {
    showPage("settings");
    toast("先に設定画面でOpenAI APIキーを保存してください", true);
    return;
  }
  if (!selectedFiles.length) return;
  const button = $("#analyzeAll");
  button.disabled = true;
  button.textContent = `${selectedFiles.length}枚を読み取り中…`;
  try {
    const images = await Promise.all(selectedFiles.map(fileToDataUrl));
    const prompt = `パチスロのデータ表示スクリーンショットをすべて読み取り、台ごとにJSONだけを返してください。形式は {"rows":[{"date":"YYYY-MM-DD","hall":"","machine":"","position":"","unit":"","games":0,"bb":0,"rb":0,"maxPayout":0,"graphPattern":"unknown","memo":""}]}。graphPatternは uptrend, downtrend, v_recovery, inverted_v, flat, spike, multiple_waves, inactive, unknown のいずれか。不明項目は空文字または0、日付不明なら${today}。台番号の先頭ゼロは保持してください。`;
    const content = [{ type: "input_text", text: prompt }, ...images.map((image_url) => ({ type: "input_image", image_url }))];
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4.1-mini", input: [{ role: "user", content }], max_output_tokens: 5000 })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || `APIエラー (${response.status})`);
    reviewData = parseResponseJson(payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text || "").map(normalizeRow);
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
  if (!games) return { score: 0, reason: "未稼働データ（ランキング対象外）" };
  const hitsPer1000 = ((Number(record.bb) || 0) + (Number(record.rb) || 0)) / games * 1000;
  const graphScore = { uptrend: 12, multiple_waves: 8, v_recovery: 6, flat: 1, unknown: 0, inverted_v: -2, spike: -3, downtrend: -8, inactive: -25 }[record.graphPattern] || 0;
  const score = Math.round(Math.max(0, Math.min(100, 35 + Math.min(25, games / 240) + Math.min(20, hitsPer1000 * 2) + graphScore + Math.min(8, (Number(record.maxPayout) || 0) / 800))));
  const reason = `${games.toLocaleString()}G・初当たり${hitsPer1000.toFixed(1)}/千G・${graphPatterns[record.graphPattern] || "不明"}`;
  return { score, reason };
}

function rankedRecords() {
  const latestByUnit = new Map();
  [...state.records].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).forEach((record) => latestByUnit.set(`${record.hall}|${record.machine}|${record.position}|${record.unit}`, record));
  return [...latestByUnit.values()].map((record) => ({ ...record, ...scoreRecord(record) })).sort((a, b) => b.score - a.score || Number(a.unit) - Number(b.unit));
}

function renderRanking() {
  const ranked = rankedRecords();
  const active = ranked.filter((record) => record.games > 0);
  $("#summary").innerHTML = `<div><b>${state.records.length}</b><span>保存件数</span></div><div><b>${active.length}</b><span>稼働台</span></div><div><b>${active[0]?.score ?? 0}</b><span>最高スコア</span></div>`;
  $("#ranking").className = ranked.length ? "ranking" : "ranking empty-card";
  $("#ranking").innerHTML = ranked.length ? ranked.map((record, index) => `
    <article class="rank-card ${index === 0 ? "top" : ""}">
      <span class="rank">${index + 1}</span><div class="rank-main"><b>配置 ${escapeHtml(record.position)} / 台 ${escapeHtml(record.unit)}</b><small>${escapeHtml(record.hall)}・${escapeHtml(record.machine)}</small><p>${escapeHtml(record.reason)}</p></div><strong>${record.score}<small>点</small></strong>
    </article>`).join("") : `<p>まだ記録がありません。入力画面から今日のスクリーンショットを追加してください。</p>`;
}

function renderHistory() {
  const records = [...state.records].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const max = Math.max(1, ...records.map((record) => Number(record.maxPayout) || 0));
  $("#chart").innerHTML = records.length ? `<div class="bars">${records.slice(0, 16).reverse().map((record) => `<div title="台${escapeHtml(record.unit)}: ${Number(record.maxPayout).toLocaleString()}枚"><span style="height:${Math.max(4, (Number(record.maxPayout) || 0) / max * 100)}%"></span><small>${escapeHtml(record.unit)}</small></div>`).join("")}</div>` : "<p>記録が増えると最大放出の比較を表示します。</p>";
  $("#historyList").innerHTML = records.map((record) => `
    <article class="history-card"><div><b>${escapeHtml(record.date)}　${escapeHtml(record.hall)}</b><span>${escapeHtml(record.machine)} / 配置 ${escapeHtml(record.position)} / 台 ${escapeHtml(record.unit)}</span></div><dl><div><dt>総回転</dt><dd>${Number(record.games).toLocaleString()}</dd></div><div><dt>BIG / REG</dt><dd>${record.bb} / ${record.rb}</dd></div><div><dt>最大放出</dt><dd>${Number(record.maxPayout).toLocaleString()}</dd></div><div><dt>グラフ</dt><dd>${graphPatterns[record.graphPattern] || "不明"}</dd></div></dl>${record.memo ? `<p>${escapeHtml(record.memo)}</p>` : ""}</article>`).join("");
}

function renderAll() {
  renderRanking();
  renderHistory();
}

function exportJson() {
  const data = JSON.stringify({ version: "0.4", exportedAt: new Date().toISOString(), records: state.records }, null, 2);
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
  state.records = [];
  persist();
  await clearScreenshots();
  renderAll();
  toast("すべてのデータを削除しました");
}

function saveSettings(event) {
  event.preventDefault();
  state.settings.openaiKey = $("#openaiKey").value.trim();
  state.settings.googleClientId = $("#googleClientId").value.trim();
  persist(); toast("この端末に設定を保存しました");
}

function extractDriveRecords(payload) {
  return Array.isArray(payload?.records) ? payload.records : [];
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
      const merged = new Map([...extractDriveRecords(remote), ...state.records].map((record) => [record.id, record]));
      state.records = [...merged.values()];
    }
    const metadata = { name: "neraidai-v04.json", parents: list.files?.length ? undefined : ["appDataFolder"] };
    const boundary = `neraidai_${Date.now()}`;
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ version: "0.4", records: state.records })}\r\n--${boundary}--`;
    const fileId = list.files?.[0]?.id;
    const url = fileId ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart` : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const response = await fetch(url, { method: fileId ? "PATCH" : "POST", headers: { ...headers, "Content-Type": `multipart/related; boundary=${boundary}` }, body });
    if (!response.ok) throw new Error(`Drive APIエラー (${response.status})`);
    persist(); renderAll(); $("#syncDot").classList.add("online"); toast("Google Driveと記録を同期しました");
  } catch (error) {
    console.error(error); toast(`Drive同期に失敗しました: ${error.message}`, true);
  } finally { button.disabled = false; }
}

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
$("#exportBtn").addEventListener("click", exportJson);
$("#demoBtn").addEventListener("click", addDemoData);
$("#clearBtn").addEventListener("click", clearAll);
$("#syncBtn").addEventListener("click", syncDrive);

$("#date").value = today;
$("#todayLabel").textContent = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date());
$("#openaiKey").value = state.settings.openaiKey || "";
$("#googleClientId").value = state.settings.googleClientId || "";
populateGraphSelects();
renderAll();

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(console.warn);
