# 撮合引擎测试规范 — v2

**版本**: v2.0.0  
**测试类型**: 单元测试 / 集成测试 / 边界测试 / 压力场景测试  
**目标**: 覆盖 v2 所有新特性的正确性、边界行为和回归安全

---

## 一、单元测试：scoreWorkerForTask

### 测试套件 1：贝叶斯平滑（冷启动场景）

```typescript
describe("scoreWorkerForTask - Bayesian smoothing", () => {

  test("T01: 新 Worker（trustScore 全 null）应获得合理冷启动分，不低于 5", () => {
    const worker = makeWorker({ trustScore: null, lastHeartbeatMin: 0.5 });
    const task = makeTask({ priority: "medium", estimatedTokens: 100 });
    const { score } = scoreWorkerForTask(worker, task);
    expect(score).toBeGreaterThan(5);
    expect(score).toBeLessThan(50); // 冷启动不应超过成熟 Worker
  });

  test("T02: 1次 probe 全通过的 Worker 不应超过 100次 probe 95%通过的 Worker", () => {
    const lowSample = makeWorker({
      trustScore: { probePassRate: 1.0, totalProbes: 1, taskCompletionRate: 0, totalTasks: 0 },
      lastHeartbeatMin: 0.5
    });
    const highSample = makeWorker({
      trustScore: { probePassRate: 0.95, totalProbes: 100, taskCompletionRate: 0.9, totalTasks: 100 },
      lastHeartbeatMin: 0.5
    });
    const task = makeTask({ priority: "medium", estimatedTokens: 100 });
    const { score: s1 } = scoreWorkerForTask(lowSample, task);
    const { score: s2 } = scoreWorkerForTask(highSample, task);
    expect(s2).toBeGreaterThan(s1); // 高样本高可信的 Worker 必须排名更高
  });

  test("T03: 完成率 1.0 + totalTasks=1 的 Worker，应低于 completionRate=0.9 + totalTasks=200 的 Worker", () => {
    const gambler = makeWorker({
      trustScore: { taskCompletionRate: 1.0, totalTasks: 1, probePassRate: 0.5, totalProbes: 10 },
      lastHeartbeatMin: 0.5
    });
    const veteran = makeWorker({
      trustScore: { taskCompletionRate: 0.9, totalTasks: 200, probePassRate: 0.9, totalProbes: 100 },
      lastHeartbeatMin: 0.5
    });
    const task = makeTask({ priority: "medium" });
    const { score: sGambler } = scoreWorkerForTask(gambler, task);
    const { score: sVeteran } = scoreWorkerForTask(veteran, task);
    expect(sVeteran).toBeGreaterThan(sGambler);
  });
});
```

### 测试套件 2：Heartbeat 连续衰减（无跳变）

```typescript
describe("scoreWorkerForTask - Heartbeat continuous decay", () => {

  test("T04: t=9:59 和 t=10:01 的分数差不超过 0.5", () => {
    const w1 = makeWorker({ lastHeartbeatMin: 9.99 });
    const w2 = makeWorker({ lastHeartbeatMin: 10.01 });
    const task = makeTask({});
    const { score: s1 } = scoreWorkerForTask(w1, task);
    const { score: s2 } = scoreWorkerForTask(w2, task);
    expect(Math.abs(s1 - s2)).toBeLessThan(0.5);
  });

  test("T05: t=0 时心跳分为 20（最高）", () => {
    const worker = makeWorker({ lastHeartbeatMin: 0, trustScore: null });
    const task = makeTask({});
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.heartbeatFreshness).toBeCloseTo(20, 0);
  });

  test("T06: t=20 时心跳分为 0", () => {
    const worker = makeWorker({ lastHeartbeatMin: 20, trustScore: null });
    const task = makeTask({});
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.heartbeatFreshness).toBe(0);
  });

  test("T07: t 越大，心跳分单调递减", () => {
    const times = [0, 1, 3, 5, 10, 15, 19];
    const scores = times.map(t => {
      const { breakdown } = scoreWorkerForTask(makeWorker({ lastHeartbeatMin: t }), makeTask({}));
      return breakdown.heartbeatFreshness;
    });
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});
```

### 测试套件 3：乘法折扣惩罚

```typescript
describe("scoreWorkerForTask - Multiplicative penalties", () => {

  test("T08: loadFactor = max(0.7, 1 - 0.1 × activeTaskCount)", () => {
    const cases = [
      { activeTaskCount: 0, expectedFactor: 1.0 },
      { activeTaskCount: 1, expectedFactor: 0.9 },
      { activeTaskCount: 3, expectedFactor: 0.7 },
      { activeTaskCount: 5, expectedFactor: 0.7 }, // capped at 0.7
    ];
    cases.forEach(({ activeTaskCount, expectedFactor }) => {
      const { breakdown } = scoreWorkerForTask(
        makeWorker({ activeTaskCount }),
        makeTask({})
      );
      expect(breakdown.loadPenaltyFactor).toBeCloseTo(expectedFactor, 2);
    });
  });

  test("T09: cancelFactor = max(0.6, 1 - 0.08 × min(recentCancelCount, 5))", () => {
    const cases = [
      { recentCancelCount: 0, expectedFactor: 1.0 },
      { recentCancelCount: 2, expectedFactor: 0.84 },
      { recentCancelCount: 5, expectedFactor: 0.6 },
      { recentCancelCount: 10, expectedFactor: 0.6 }, // capped at 0.6
    ];
    cases.forEach(({ recentCancelCount, expectedFactor }) => {
      const { breakdown } = scoreWorkerForTask(
        makeWorker({ recentCancelCount }),
        makeTask({})
      );
      expect(breakdown.cancelPenaltyFactor).toBeCloseTo(expectedFactor, 2);
    });
  });

  test("T10: 高分 Worker 和低分 Worker 受到相同比例的负载惩罚", () => {
    const task = makeTask({});
    const highScore = makeWorker({ trustScore: fullTrust(), activeTaskCount: 3 });
    const lowScore = makeWorker({ trustScore: halfTrust(), activeTaskCount: 3 });
    const { score: h, breakdown: hb } = scoreWorkerForTask(highScore, task);
    const { score: l, breakdown: lb } = scoreWorkerForTask(lowScore, task);
    // Both should have loadPenaltyFactor = 0.7
    expect(hb.loadPenaltyFactor).toBeCloseTo(0.7);
    expect(lb.loadPenaltyFactor).toBeCloseTo(0.7);
    // Ratio should be preserved (proportional penalty)
    expect(h / l).toBeCloseTo(
      scoreWorkerForTask(makeWorker({ trustScore: fullTrust(), activeTaskCount: 0 }), task).score /
      scoreWorkerForTask(makeWorker({ trustScore: halfTrust(), activeTaskCount: 0 }), task).score,
      1
    );
  });
});
```

### 测试套件 4：高价值任务硬门控

```typescript
describe("scoreWorkerForTask - Value-quality hard gate", () => {

  test("T11: estimatedTokens >= 500, overallScore < 40 → score = 0（直接排除）", () => {
    const worker = makeWorker({ trustScore: { overallScore: 35, authenticityScore: 80 } });
    const task = makeTask({ estimatedTokens: 600 });
    const { score, breakdown } = scoreWorkerForTask(worker, task);
    expect(score).toBe(0);
    expect(breakdown.valueQualityGate).toBe("blocked");
  });

  test("T12: estimatedTokens >= 500, authenticityScore < 50 → score = 0（DID 不可信）", () => {
    const worker = makeWorker({ trustScore: { overallScore: 75, authenticityScore: 30 } });
    const task = makeTask({ estimatedTokens: 800 });
    const { score, breakdown } = scoreWorkerForTask(worker, task);
    expect(score).toBe(0);
    expect(breakdown.valueQualityGate).toBe("blocked");
  });

  test("T13: estimatedTokens >= 500, overallScore=45, authenticityScore=55 → 通过门控", () => {
    const worker = makeWorker({ trustScore: { overallScore: 45, authenticityScore: 55 } });
    const task = makeTask({ estimatedTokens: 600 });
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.valueQualityGate).toBe("pass");
  });

  test("T14: 低价值任务（estimatedTokens < 200）无门控", () => {
    const worker = makeWorker({ trustScore: { overallScore: 20, authenticityScore: 20 } });
    const task = makeTask({ estimatedTokens: 50 });
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.valueQualityGate).toBe("na");
  });
});
```

### 测试套件 5：Publisher 偏好

```typescript
describe("scoreWorkerForTask - Publisher preference", () => {

  test("T15: preferredWorkerDid 匹配 → +15 分加成", () => {
    const did = "did:key:z6MkPreferred";
    const worker = makeWorker({ did });
    const task = makeTask({ preference: { preferredWorkerDid: did } });
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.preferenceBonus).toBe(15);
  });

  test("T16: excludeWorkerDids 包含该 Worker → score = 0", () => {
    const did = "did:key:z6MkExcluded";
    const worker = makeWorker({ did });
    const task = makeTask({ preference: { excludeWorkerDids: [did] } });
    const { score } = scoreWorkerForTask(worker, task);
    expect(score).toBe(0);
  });

  test("T17: requireCapabilities 要求 'code' + 'typescript'，Worker 只有 'code' → score = 0", () => {
    const worker = makeWorker({ capabilities: { categories: ["code"] } });
    const task = makeTask({ preference: { requireCapabilities: ["code", "typescript"] } });
    const { score } = scoreWorkerForTask(worker, task);
    expect(score).toBe(0);
  });

  test("T18: preferFastOverQuality=true → responseSpeed 权重放大，completionRate 权重缩小", () => {
    const worker = makeWorker({
      trustScore: { taskCompletionRate: 0.9, totalTasks: 50, avgResponseMs: 500 }
    });
    const fastTask = makeTask({ preference: { preferFastOverQuality: true } });
    const qualityTask = makeTask({ preference: { preferFastOverQuality: false } });
    const { breakdown: fb } = scoreWorkerForTask(worker, fastTask);
    const { breakdown: qb } = scoreWorkerForTask(worker, qualityTask);
    expect(fb.responseSpeed).toBeGreaterThan(qb.responseSpeed);
    expect(fb.completionRate).toBeLessThan(qb.completionRate);
  });
});
```

---

## 二、单元测试：scoreTaskForWorker

### 测试套件 6：Worker 视角任务评分

```typescript
describe("scoreTaskForWorker", () => {

  test("T19: estimatedTokens 越高，Nectar 维度分越高（上限 20）", () => {
    const worker = makeWorkerDrone({});
    const cheap = makeTaskRecord({ estimatedTokens: 100 });
    const expensive = makeTaskRecord({ estimatedTokens: 1000 });
    const s1 = scoreTaskForWorker(cheap, worker, 0);
    const s2 = scoreTaskForWorker(expensive, worker, 0);
    expect(s2).toBeGreaterThan(s1);
  });

  test("T20: priority=high 比 priority=low 额外 +10", () => {
    const worker = makeWorkerDrone({});
    const high = makeTaskRecord({ priority: "high", estimatedTokens: 100 });
    const low = makeTaskRecord({ priority: "low", estimatedTokens: 100 });
    const diff = scoreTaskForWorker(high, worker, 0) - scoreTaskForWorker(low, worker, 0);
    expect(diff).toBeCloseTo(10, 0);
  });

  test("T21: 创建 120 分钟前的任务，age penalty = -10（最大）", () => {
    const worker = makeWorkerDrone({});
    const ancient = makeTaskRecord({ createdAt: new Date(Date.now() - 120 * 60 * 1000) });
    const fresh = makeTaskRecord({ createdAt: new Date() });
    const sAncient = scoreTaskForWorker(ancient, worker, 0);
    const sFresh = scoreTaskForWorker(fresh, worker, 0);
    expect(sFresh - sAncient).toBeCloseTo(10, 0); // max age penalty = 10
  });

  test("T22: 能力命中 + confidence=0.9 → +15 + 0.9×5 = +19.5", () => {
    const worker = makeWorkerDrone({
      capabilities: { categories: ["code"], skill_confidence: { code: 0.9 } }
    });
    const task = makeTaskRecord({ category: "code" });
    const noCapTask = makeTaskRecord({ category: "design" });
    const diff = scoreTaskForWorker(task, worker, 0) - scoreTaskForWorker(noCapTask, worker, 0);
    expect(diff).toBeCloseTo(19.5, 0);
  });
});
```

---

## 三、集成测试：fetchScoredCandidates

### 测试套件 7：候选池排序确定性

```typescript
describe("fetchScoredCandidates - deterministic ordering", () => {

  test("T23: 相同条件多次调用，结果顺序一致（无随机排序）", async () => {
    const task = { category: "code", priority: "medium", estimatedTokens: 100, publisherId: "pub1" };
    const [r1, r2] = await Promise.all([
      fetchScoredCandidates(task),
      fetchScoredCandidates(task),
    ]);
    expect(r1.map(c => c.drone.id)).toEqual(r2.map(c => c.drone.id));
  });

  test("T24: 候选结果按 matchScore 严格降序", async () => {
    const candidates = await fetchScoredCandidates(makeTaskContext({}));
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i].matchScore).toBeLessThanOrEqual(candidates[i - 1].matchScore);
    }
  });

  test("T25: 超出 maxConcurrentTasks 的 Worker 不出现在结果中", async () => {
    // Setup: create a Worker with 3 active tasks and maxConcurrentTasks=3
    // Verify it's excluded from candidates
    // ... (requires DB fixture setup)
  });
});
```

---

## 四、边界测试

### 测试套件 8：异常输入

```typescript
describe("Edge cases", () => {

  test("T26: capabilities JSON 解析失败（malformed）→ capabilityMatch = 0，不抛错", () => {
    const worker = makeWorker({ rawCapabilities: "{invalid json" });
    const task = makeTask({ category: "code" });
    expect(() => scoreWorkerForTask(worker, task)).not.toThrow();
    const { breakdown } = scoreWorkerForTask(worker, task);
    expect(breakdown.capabilityMatch).toBe(0);
  });

  test("T27: lastHeartbeat = null → heartbeatFreshness = 0", () => {
    const worker = makeWorker({ lastHeartbeat: null });
    const { breakdown } = scoreWorkerForTask(worker, makeTask({}));
    expect(breakdown.heartbeatFreshness).toBe(0);
  });

  test("T28: trustScore = null → 使用所有默认值，不抛错", () => {
    const worker = makeWorker({ trustScore: null, lastHeartbeatMin: 1 });
    expect(() => scoreWorkerForTask(worker, makeTask({}))).not.toThrow();
  });

  test("T29: Worker 自声明 maxConcurrentTasks=15（超上限）→ 被 clamp 到 10", () => {
    // 测试 fetchScoredCandidates 中的 clamp 逻辑
    const worker = makeWorker({
      capabilities: { maxConcurrentTasks: 15 },
      activeTaskCount: 9, // 9 < 10 → 应被纳入候选
    });
    // 验证 maxConcurrentTasks 被限制为 10，而非 15
  });

  test("T30: 最终 score 永不为负数", () => {
    // Worst case: all penalties maxed out
    const worker = makeWorker({
      activeTaskCount: 3,
      recentCancelCount: 10,
      trustScore: { overallScore: 10, authenticityScore: 60, taskCompletionRate: 0, totalTasks: 0 },
      lastHeartbeatMin: 15,
    });
    const task = makeTask({ estimatedTokens: 100 });
    const { score } = scoreWorkerForTask(worker, task);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
```

---

## 五、回归测试：v1 → v2 兼容性

### 测试套件 9：关键行为不变

```typescript
describe("Regression: v1 → v2 behavior compatibility", () => {

  test("T31: 有 Worker 时发布任务仍返回 status=accepted + roomId", async () => {
    const response = await publishTask({ title: "test", estimatedTokens: 50 });
    expect(response.status).toBe("accepted");
    expect(response.roomId).toBeTruthy();
  });

  test("T32: 无 Worker 时发布任务返回 status=pending，新增 matchHint 字段", async () => {
    const response = await publishTask({ title: "test", estimatedTokens: 50 });
    expect(response.status).toBe("pending");
    expect(response.matchHint).toBeDefined();
    expect(response.matchHint.suggestedPollIntervalMs).toBeGreaterThan(0);
  });

  test("T33: /match 接口返回候选中新增 scoreBreakdown 字段", async () => {
    const response = await callMatchEndpoint(taskId);
    expect(response.candidates[0].scoreBreakdown).toBeDefined();
    expect(response.candidates[0].scoreBreakdown.heartbeatFreshness).toBeDefined();
  });

  test("T34: heartbeat 响应新增 nextHeartbeatMs 字段", async () => {
    const response = await sendHeartbeat();
    expect(response.nextHeartbeatMs).toBeDefined();
    expect(response.nextHeartbeatMs).toBeGreaterThan(0);
  });

  test("T35: matchPreference=null 时系统行为与 v1 一致（向后兼容）", async () => {
    // No matchPreference in request body — should work as before
    const response = await publishTask({ title: "test", estimatedTokens: 50 });
    expect(response.taskId).toBeTruthy();
  });
});
```

---

## 六、压力场景测试

### 场景 A：极端竞争（大量 Publisher 同时发布）

```
场景设置:
  - 10 个 Publisher 并发发布任务
  - 只有 2 个 Worker 在线
  - 预期：每个任务最多被分配一次，无重复分配

验证点:
  - 所有 Worker 的 activeTaskCount 不超过 maxConcurrentTasks
  - 无任务重复分配（WorkerAssignment 无重复 taskId）
  - 超出 Worker 容量的任务均为 pending 状态
```

### 场景 B：冷启动 Worker 的公平分配

```
场景设置:
  - 1 个新 Worker（totalTasks=0, trustScore=null）
  - 1 个成熟 Worker（completionRate=0.9, totalTasks=100）
  - 发布 20 个 low-priority 任务

验证点:
  - 新 Worker 至少获得 1 个任务（冷启动保底）
  - 新 Worker 获得任务比例 < 成熟 Worker（不应过度倾斜）
  - 高 priority 任务不被分配给新 Worker（priority=high 时新 Worker 惩罚 -10）
```

### 场景 C：heartbeat 时序压力

```
场景设置:
  - 同一个 Worker 的 lastHeartbeat 在 9:59 和 10:01 分别触发一次撮合

验证点:
  - 两次撮合的 scoreBreakdown.heartbeatFreshness 差值 < 0.5
  - 同一 Worker 在两次撮合间排名不因步进跳变而大幅改变
```

### 场景 D：高价值任务安全门控

```
场景设置:
  - 发布 estimatedTokens=600 的任务
  - Worker 池: 3个 Worker，overallScore 分别为 35/55/80

验证点:
  - overallScore=35 的 Worker 不出现在候选列表中
  - overallScore=55/80 的 Worker 正常参与评分
  - 最终分配给 overallScore=80 的 Worker
```

---

## 七、测试工具函数（Fixture Helpers）

```typescript
// 测试辅助函数（统一构造测试数据）

function makeWorker(overrides: Partial<{
  trustScore: Partial<TrustScore> | null;
  lastHeartbeatMin: number;
  lastHeartbeat: Date | null;
  capabilities: object;
  rawCapabilities: string;
  activeTaskCount: number;
  recentCancelCount: number;
  historicalCollabCount: number;
  maxConcurrentTasks: number;
  did: string;
}>): WorkerCandidate {
  const lastHeartbeat = overrides.lastHeartbeat !== undefined
    ? overrides.lastHeartbeat
    : overrides.lastHeartbeatMin !== undefined
    ? new Date(Date.now() - overrides.lastHeartbeatMin * 60000)
    : new Date(Date.now() - 60000); // default: 1 min ago

  return {
    drone: {
      id: "worker-test-" + Math.random(),
      did: overrides.did ?? null,
      lastHeartbeat,
      capabilities: overrides.rawCapabilities
        ?? (overrides.capabilities ? JSON.stringify(overrides.capabilities) : null),
      status: "active",
      trustScore: overrides.trustScore === null ? null : {
        overallScore: 60,
        probePassRate: 0.8,
        taskCompletionRate: 0.75,
        avgResponseMs: 5000,
        authenticityScore: 70,
        uptimeRatio: 0.9,
        totalProbes: 20,
        totalTasks: 30,
        ...overrides.trustScore,
      },
    },
    activeTaskCount: overrides.activeTaskCount ?? 0,
    recentCancelCount: overrides.recentCancelCount ?? 0,
    historicalCollabCount: overrides.historicalCollabCount ?? 0,
    maxConcurrentTasks: overrides.maxConcurrentTasks ?? 3,
  } as WorkerCandidate;
}

function makeTask(overrides: Partial<TaskContext & { preference?: MatchPreference }>): TaskContext {
  return {
    category: "code",
    priority: "medium",
    estimatedTokens: 100,
    publisherId: "publisher-test",
    ...overrides,
  };
}

function fullTrust(): Partial<TrustScore> {
  return { overallScore: 95, probePassRate: 1.0, taskCompletionRate: 1.0,
           avgResponseMs: 100, authenticityScore: 100, uptimeRatio: 1.0,
           totalProbes: 200, totalTasks: 300 };
}

function halfTrust(): Partial<TrustScore> {
  return { overallScore: 50, probePassRate: 0.5, taskCompletionRate: 0.5,
           avgResponseMs: 15000, authenticityScore: 50, uptimeRatio: 0.5,
           totalProbes: 20, totalTasks: 30 };
}
```

---

## 八、测试覆盖率目标

| 模块 | 目标行覆盖率 | 关键分支覆盖 |
|------|-----------|------------|
| `scoreWorkerForTask` | ≥ 95% | 所有门控条件、Bayesian公式、指数衰减、乘法折扣 |
| `scoreTaskForWorker` | ≥ 90% | 能力匹配、年龄衰减、优先级溢价 |
| `fetchScoredCandidates` | ≥ 85% | 空池返回、capabilities解析失败、偏好过滤 |
| `generateMatchHint` | ≥ 80% | 四种 matchConfidence 级别 |
| `heartbeat tryAutoMatch` | ≥ 80% | SKIP竞态、Room重用、评分顺序 |

---

*测试文档版本与迭代文档同步更新。*
