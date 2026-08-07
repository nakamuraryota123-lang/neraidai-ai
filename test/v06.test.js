import test from "node:test";
import assert from "node:assert/strict";

globalThis.__NERAIDAI_TEST__ = true;
globalThis.localStorage ||= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { analyzeTendency, createPredictionSnapshots, rankedRecords } = await import("../app.js");

function record(date, position, maxPayout, overrides = {}) {
  return { id: `${date}-${position}`, date, hall: "キクヤ堺本店", machine: "L真打吉宗", machineId: "l_shinuchi_yoshimune", position, unit: position, games: 6000, bb: 20, rb: 15, maxPayout, graphPattern: "flat", createdAt: `${date}T10:00:00.000Z`, ...overrides };
}

test("配置・末尾・曜日の癖を母数と信頼度付きで算出する", () => {
  const records = [
    record("2026-07-24", "0531", 2600), record("2026-07-31", "0531", 2400),
    record("2026-07-24", "0532", 900), record("2026-07-31", "0532", 800),
    record("2026-08-06", "0531", 1000), record("2026-08-06", "0532", 2200)
  ];
  const tendency = analyzeTendency(records.at(-2), records, "2026-08-07");
  const placement = tendency.dimensions.find((item) => item.key === "placement");
  assert.equal(placement.stat.samples, 3);
  assert.equal(placement.stat.hits, 2);
  assert.ok(tendency.score > 0);
  assert.equal(tendency.confidence, "低");
});

test("予想日より後の実績を癖分析へ混入させない", () => {
  const records = [record("2026-08-06", "0531", 1000), record("2026-08-08", "0531", 5000)];
  const [ranked] = rankedRecords(records, "2026-08-07");
  assert.equal(ranked.date, "2026-08-06");
  assert.equal(ranked.tendency.dimensions.find((item) => item.key === "placement").stat.samples, 1);
});

test("予想スナップショットへ癖スコア・根拠・母数を固定保存する", () => {
  const records = [record("2026-08-05", "0531", 2600), record("2026-08-06", "0531", 2400)];
  const [prediction] = createPredictionSnapshots(records, "2026-08-06", "2026-08-07", () => "prediction-v06");
  assert.equal(prediction.entries[0].tendency.sampleSize > 0, true);
  assert.equal(typeof prediction.entries[0].scoreBreakdown.tendency, "number");
  const saved = prediction.entries[0].tendency.score;
  records.push(record("2026-08-07", "0531", 0));
  assert.equal(prediction.entries[0].tendency.score, saved);
});
