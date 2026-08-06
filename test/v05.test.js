import test from "node:test";
import assert from "node:assert/strict";

const memory = new Map();
globalThis.__NERAIDAI_TEST__ = true;
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key)
};

const {
  createPredictionSnapshots,
  evaluatePrediction,
  loadState,
  mergePredictions,
  placementKey,
  rankedRecords
} = await import("../app.js");

function record(overrides = {}) {
  return {
    id: overrides.id || crypto.randomUUID(),
    date: "2026-08-06",
    hall: "キクヤ堺本店",
    machine: "L真打吉宗",
    machineId: "l_shinuchi_yoshimune",
    position: "0531",
    unit: "0531",
    games: 6000,
    bb: 25,
    rb: 20,
    maxPayout: 2500,
    graphPattern: "uptrend",
    createdAt: "2026-08-06T10:00:00.000Z",
    ...overrides
  };
}

test("v0.4 Drive/localStorage形式を予想なしで読み込める", () => {
  memory.set("neraidai-v04", JSON.stringify({
    records: [record({ id: "old-record", machine: "真打吉宗" })],
    deletedRecordIds: ["deleted-record"],
    settings: { googleClientId: "example.apps.googleusercontent.com" }
  }));
  const loaded = loadState();
  assert.equal(loaded.records.length, 1);
  assert.equal(loaded.records[0].machineId, "l_shinuchi_yoshimune");
  assert.deepEqual(loaded.deletedRecordIds, ["deleted-record"]);
  assert.deepEqual(loaded.predictions, []);
});

test("40件の履歴を先頭ゼロ差込みで10配置へ集約する", () => {
  const records = [];
  for (let position = 531; position <= 540; position += 1) {
    for (let version = 0; version < 4; version += 1) {
      records.push(record({
        id: `${position}-${version}`,
        position: version % 2 ? String(position).padStart(4, "0") : String(position),
        unit: String(position).padStart(4, "0"),
        maxPayout: 1000 + version,
        createdAt: `2026-08-06T1${version}:00:00.000Z`
      }));
    }
  }
  assert.equal(records.length, 40);
  assert.equal(rankedRecords(records).length, 10);
  assert.equal(placementKey("0531"), placementKey("531"));
});

test("予想は保存時点の順位・点数内訳・根拠をスナップショット化する", () => {
  const records = [record({ position: "0531", unit: "0531" }), record({ position: "0532", unit: "0532", maxPayout: 2100 })];
  const [prediction] = createPredictionSnapshots(records, "2026-08-06", "2026-08-07", () => "prediction-fixed");
  assert.equal(prediction.id, "prediction-fixed");
  assert.equal(prediction.entries.length, 2);
  assert.equal(typeof prediction.entries[0].scoreBreakdown.total, "number");
  assert.ok(prediction.entries[0].reasons.length >= 3);
  const savedScore = prediction.entries[0].score;
  records[0].maxPayout = 0;
  assert.equal(prediction.entries[0].score, savedScore);
});

test("翌日実績を上位3台だけ評価し、0Gを対象外にする", () => {
  const source = [531, 532, 533].map((unit, index) => record({ position: String(unit), unit: `0${unit}`, maxPayout: 3000 - index * 200 }));
  const [prediction] = createPredictionSnapshots(source, "2026-08-06", "2026-08-07", () => "prediction-eval");
  const actual = [
    record({ date: "2026-08-07", position: "0531", unit: "0531", maxPayout: 2500 }),
    record({ date: "2026-08-07", position: "532", unit: "0532", maxPayout: 1500 }),
    record({ date: "2026-08-07", position: "0533", unit: "0533", games: 0, maxPayout: 0 })
  ];
  const evaluation = evaluatePrediction(prediction, actual, "2026-08-07T12:00:00.000Z");
  assert.equal(evaluation.eligibleCount, 2);
  assert.equal(evaluation.hitCount, 1);
  assert.equal(evaluation.hitRate, 50);
  assert.equal(evaluation.results[2].eligible, false);
});

test("Drive予想マージは同一IDのupdatedAtが新しい方を優先する", () => {
  const base = { id: "same", predictionDate: "2026-08-06", targetDate: "2026-08-07", entries: [] };
  const merged = mergePredictions(
    [{ ...base, updatedAt: "2026-08-07T10:00:00.000Z", evaluation: { hitCount: 1 } }],
    [{ ...base, updatedAt: "2026-08-07T09:00:00.000Z", evaluation: { hitCount: 0 } }, { ...base, id: "local-only", updatedAt: "2026-08-07T11:00:00.000Z" }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "same").evaluation.hitCount, 1);
});
