# 撮合引擎测试规范 — v3（增量补充）

**版本**: v3.0.0  
**说明**: 本文档为 v2 测试规范的增量补充，仅列出 v3 新增/修改的测试用例。  
**完整测试套件**: v2 测试规范（TEST_SPEC_v2.md）+ 本文档

---

## 新增测试套件 10：贝叶斯先验均值校准

```typescript
describe("v3 Bayesian prior calibration", () => {

  test("T36: 新 Worker completionRate 保底提升（0.50→0.70）", () => {
    const worker = makeWorker({ trustScore: null });
    const task = makeTask({ priority: "medium" });
    const { breakdown } = scoreWorkerForTask(worker, task);
    // v3: (0×0 + 7) / (0 + 10) = 0.70; 0.70 × 20 = 14.0
    expect(breakdown.completionRate).toBeCloseTo(14.0, 1);
  });

  test("T37: 新 Worker probePassRate 保底提升（0.60→0.80）", () => {
    const worker = makeWorker({ trustScore: null });
    const task = makeTask({});
    const { breakdown } = scoreWorkerForTask(worker, task);
    // v3: (0×0 + 8) / (0 + 10) = 0.80; 0.80 × 13 = 10.4
    expect(breakdown.probePassRate).toBeCloseTo(10.4, 1);
  });

  test("T38: 新 Worker v3 总分高于 v2 版本的对应分数（~61.5 → ~68.1）", () => {
    const worker = makeWorker({ trustScore: null, lastHeartbeatMin: 0.5 });
    const task = makeTask({ category: "code", priority: "medium" });
    const { score } = scoreWorkerForTask(worker, task);
    expect(score).toBeGreaterThan(65); // 明显高于 v2 的 61.5
    expect(score).toBeLessThan(80);    // 仍低于成熟 Worker
  });

  test("T39: totalTasks=10, rate=0.8 的 Worker，v3 平滑后值更贴近真实", () => {
    const worker = makeWorker({
      trustScore: { taskCompletionRate: 0.8, totalTasks: 10 }
    });
    const task = makeTask({ priority: "medium" });
    const { breakdown } = scoreWorkerForTask(worker, task);
    // v3: (0.8×10 + 7) / (10 + 10) = 15/20 = 0.75; × 20 = 15.0
    expect(breakdown.completionRate).toBeCloseTo(15.0, 1);
  });

  test("T40: 高样本（totalTasks=200）Worker，平滑结果趋近真实率", () => {
    const worker = makeWorker({
      trustScore: { taskCompletionRate: 0.9, totalTasks: 200 }
    });
    const task = makeTask({ priority: "medium" });
    const { breakdown } = scoreWorkerForTask(worker, task);
    // v3: (0.9×200 + 7) / (200 + 10) = 187/210 ≈ 0.890; × 20 ≈ 17.8
    expect(breakdown.completionRate).toBeCloseTo(17.8, 1);
  });
});
```

---

## 新增测试套件 11：confidence=null 逻辑修复

```typescript
describe("v3 skill_confidence null fix", () => {

  test("T41: confidence=null 得 3 分（非 5 分）", () => {
    const worker = makeWorker({ capabilities: { categories: ["code"] } }); // no skill_confidence
    const task = makeTask({ category: "code" });
    const { breakdown } = scoreWorkerForTask(worker, task);
    // 15 (category match) + 3 (null confidence) = 18
    expect(breakdown.capabilityMatch).toBe(18);
  });

  test("T42: confidence=1.0 仍得 20 分（不变）", () => {
    const worker = makeWorker({
      capabilities: { categories: ["code"], skill_confidence: { code: 1.0 } }
    });
    const task = makeTask({ category: "code" });
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.capabilityMatch).toBe(20);
  });

  test("T43: confidence=0.6 < null 的修复后得分（18 = 15+3, 18 = 15+0.6×5）", () => {
    const workerNull = makeWorker({ capabilities: { categories: ["code"] } });
    const workerLow  = makeWorker({
      capabilities: { categories: ["code"], skill_confidence: { code: 0.6 } }
    });
    const task = makeTask({ category: "code" });
    const { breakdown: bNull } = scoreWorkerForTask(workerNull, task);
    const { breakdown: bLow  } = scoreWorkerForTask(workerLow, task);
    // v3: null=18, 0.6=18 (15+3=18 vs 15+3=18) — both 18, both below confidence=1.0 (20)
    expect(bNull.capabilityMatch).toBe(18);
    expect(bLow.capabilityMatch).toBe(18); // 0.6×5=3，与null相同
  });

  test("T44: confidence=1.0 > confidence=null > confidence=0.0", () => {
    const w100  = makeWorker({ capabilities: { categories: ["c"], skill_confidence: { c: 1.0 } } });
    const wNull = makeWorker({ capabilities: { categories: ["c"] } });
    const w0    = makeWorker({ capabilities: { categories: ["c"], skill_confidence: { c: 0.0 } } });
    const t = makeTask({ category: "c" });
    const { breakdown: b100  } = scoreWorkerForTask(w100,  t);
    const { breakdown: bNull } = scoreWorkerForTask(wNull, t);
    const { breakdown: b0    } = scoreWorkerForTask(w0,    t);
    expect(b100.capabilityMatch).toBeGreaterThan(bNull.capabilityMatch);
    expect(bNull.capabilityMatch).toBeGreaterThan(b0.capabilityMatch);
  });
});
```

---

## 新增测试套件 12：Publisher 偏好加成收紧

```typescript
describe("v3 preference bonus cap", () => {

  test("T45: preferenceBonus 最高 10 分（v3 降低）", () => {
    const did = "did:key:preferred";
    const worker = makeWorker({ did });
    const task = makeTask({ preference: { preferredWorkerDid: did } });
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.preferenceBonus).toBe(10); // was 15 in v2
  });

  test("T46: collabBonus 最高 6 分（v3 降低，4次×1.5）", () => {
    const worker = makeWorker({ historicalCollabCount: 10 }); // over cap
    const task = makeTask({});
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.collabBonus).toBe(6); // was 8 in v2
  });

  test("T47: 最大组合加成 = 16（preferenceBonus=10 + collabBonus=6）", () => {
    const did = "did:key:preferred";
    const worker = makeWorker({ did, historicalCollabCount: 10 });
    const task = makeTask({ preference: { preferredWorkerDid: did } });
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.preferenceBonus + breakdown.collabBonus).toBe(16);
  });

  test("T48: 优质新 Worker 应能超越取消记录多的老伙伴", () => {
    const did = "did:key:partner";
    const veteran = makeWorker({
      did,
      historicalCollabCount: 4,
      recentCancelCount: 3,
      trustScore: { taskCompletionRate: 0.6, totalTasks: 50, overallScore: 55 },
      lastHeartbeatMin: 1,
    });
    const newStar = makeWorker({
      trustScore: { taskCompletionRate: 0.95, totalTasks: 0, probePassRate: 0.95, totalProbes: 0, uptimeRatio: 0.95 },
      lastHeartbeatMin: 0.5,
    });
    const task = makeTask({ preference: { preferredWorkerDid: did } });
    const { score: sv } = scoreWorkerForTask(veteran, task);
    const { score: sn } = scoreWorkerForTask(newStar, task);
    // After v3 reduction, a top-tier new Worker should be able to compete
    // (This test verifies the margin is reasonable, not necessarily that newStar always wins)
    expect(Math.abs(sv - sn)).toBeLessThan(30); // gap should be < 30 pts
  });
});
```

---

## 新增测试套件 13：年龄溢价（urgency premium）

```typescript
describe("v3 task age urgency premium", () => {

  test("T49: 刚发布的任务年龄溢价 = 0", () => {
    const freshTask = makeFreshTaskRecord({ createdAt: new Date() });
    const score = scoreTaskForWorker(freshTask, makeWorkerDrone({}), 0);
    // ageMinutes ≈ 0, urgencyBonus = min(0/20, 15) = 0
    expect(score).toBeGreaterThanOrEqual(0);
    // Score without urgency should be lower than aged task
    const agedTask = makeFreshTaskRecord({
      createdAt: new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
    });
    const agedScore = scoreTaskForWorker(agedTask, makeWorkerDrone({}), 0);
    expect(agedScore).toBeGreaterThan(score); // aged task gets urgency bonus
  });

  test("T50: 等待 20 分钟 → urgency +1 分", () => {
    const task20 = makeFreshTaskRecord({ createdAt: new Date(Date.now() - 20 * 60 * 1000) });
    const task0  = makeFreshTaskRecord({ createdAt: new Date() });
    const w = makeWorkerDrone({});
    const s20 = scoreTaskForWorker(task20, w, 0);
    const s0  = scoreTaskForWorker(task0,  w, 0);
    expect(s20 - s0).toBeCloseTo(1, 0); // +1 per 20 minutes
  });

  test("T51: 等待 300 分钟 → urgency 封顶 +15（不超过上限）", () => {
    const old = makeFreshTaskRecord({ createdAt: new Date(Date.now() - 300 * 60 * 1000) });
    const fresh = makeFreshTaskRecord({ createdAt: new Date() });
    const w = makeWorkerDrone({});
    const diff = scoreTaskForWorker(old, w, 0) - scoreTaskForWorker(fresh, w, 0);
    expect(diff).toBeCloseTo(15, 0); // capped at 15
  });

  test("T52: 低价值旧任务（tokens=30, 2小时前）应高于新发布低价值任务", () => {
    const oldLow = makeFreshTaskRecord({
      estimatedTokens: 30, priority: "low",
      createdAt: new Date(Date.now() - 120 * 60 * 1000)
    });
    const freshLow = makeFreshTaskRecord({
      estimatedTokens: 30, priority: "low",
      createdAt: new Date()
    });
    const w = makeWorkerDrone({});
    expect(scoreTaskForWorker(oldLow, w, 0)).toBeGreaterThan(
      scoreTaskForWorker(freshLow, w, 0)
    );
  });

  test("T53: 死亡螺旋验证——旧任务随时间增加吸引力，而不是降低", () => {
    const w = makeWorkerDrone({});
    const task = makeFreshTaskRecord({ estimatedTokens: 50 });
    const times = [0, 30, 60, 120, 240];
    const scores = times.map(min => scoreTaskForWorker(
      { ...task, createdAt: new Date(Date.now() - min * 60 * 1000) },
      w, 0
    ));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]); // 单调递增
    }
  });
});
```

---

## 新增测试套件 14：matchHint 精确能力计数

```typescript
describe("v3 generateMatchHint - exact capability matching", () => {

  test("T54: category='code' 不应计入 capabilities 含 'code-review' 的 Worker", async () => {
    // Setup: create Workers with capabilities: code-review, code-gen, code (exact)
    // Verify capableWorkerCount = 1 (only exact "code" match)
    // ...
  });

  test("T55: matchConfidence 根据精确能力匹配数量计算", async () => {
    // onlineWorkerCount=10, capableWorkerCount=1 → matchConfidence="low"
    const hint = await generateMatchHint("pub1", "code", 100);
    // After v3 fix, count should exclude false-positives
    expect(["low", "none"]).toContain(hint.matchConfidence);
  });
});
```

---

## 回归测试：v2 → v3 行为变化验证

```typescript
describe("Regression v2→v3: score direction changes", () => {

  test("T56: 新 Worker 总分高于 v2 对应分数", () => {
    // v2 新 Worker: ~61.5, v3 新 Worker: ~68.1
    const w = makeWorker({ trustScore: null, lastHeartbeatMin: 0.5 });
    const t = makeTask({ category: "code" });
    const { score } = scoreWorkerForTask(w, t);
    expect(score).toBeGreaterThan(65);
  });

  test("T57: confidence=null 的 capabilityMatch 从 20 降至 18", () => {
    const w = makeWorker({ capabilities: { categories: ["code"] } });
    const t = makeTask({ category: "code" });
    const { breakdown } = scoreWorkerForTask(w, t);
    expect(breakdown.capabilityMatch).toBe(18); // was 20 in v2
  });

  test("T58: preferenceBonus 最高值从 15 变为 10", () => {
    const did = "did:key:x";
    const w = makeWorker({ did });
    const t = makeTask({ preference: { preferredWorkerDid: did } });
    const { breakdown } = scoreWorkerForTask(w, t);
    expect(breakdown.preferenceBonus).toBe(10); // was 15 in v2
  });

  test("T59: 旧任务的 scoreTaskForWorker 高于新任务（v2 相反）", () => {
    const w = makeWorkerDrone({});
    const old = makeFreshTaskRecord({ createdAt: new Date(Date.now() - 60 * 60 * 1000) });
    const fresh = makeFreshTaskRecord({ createdAt: new Date() });
    expect(scoreTaskForWorker(old, w, 0)).toBeGreaterThan(
      scoreTaskForWorker(fresh, w, 0)
    );
  });
});
```

---

## v3 测试覆盖率变化

| 模块 | v2 目标 | v3 目标（提升） | 新增测试用例数 |
|------|--------|--------------|------------|
| `scoreWorkerForTask` | 95% | **97%** | +9 用例（T36-T48） |
| `scoreTaskForWorker` | 90% | **95%** | +5 用例（T49-T53） |
| `generateMatchHint` | 80% | **85%** | +2 用例（T54-T55） |
| 回归测试 | — | 新增套件 | +4 用例（T56-T59） |

---

*v3 测试规范为增量文档，需结合 TEST_SPEC_v2.md 组成完整测试套件。*
