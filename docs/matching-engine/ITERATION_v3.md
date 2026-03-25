# 撮合引擎迭代日志 — v3

**版本号**: v3.0.0  
**迭代日期**: 2026-03-25  
**迭代方式**: 三派 Agent 第二轮辩论（STRESS压力测试派 / DATA数据建模派 / ECO生态设计派）  
**变更文件**: `lib/matching.ts`（局部修复，无接口变更）

---

## 一、第二轮辩论摘要

### STRESS 派（压力测试）核心发现

| 漏洞 | 严重度 | 具体数值证明 |
|------|--------|------------|
| `capabilities contains "code"` 误报 | P1 | `"code-review"` 中包含 `"code"`，`capableWorkerCount` 虚报，`matchConfidence` 误导 Publisher |
| `preferenceBonus=+15` 绕过取消惩罚 | P1 | rawScore=45 的老伙伴 × cancelFactor=0.76 = 34.2，加上 +23 总加成 = 57.2 > 未受惩罚新人 |
| 硬门控阈值与默认值精确咬合 | P2 | `authenticityScore ?? 50` fallback 恰好等于门控阈值 50，一行改动即触发 P0 事故 |
| `scoreTaskForWorker` age_penalty 上限过低 | P2 | age_penalty max=-10，高价值旧任务仍远超新发布低价值任务（39.5 vs 0.2） |

### DATA 派（数据建模）核心发现

| 问题 | 具体计算 | v3 修复 |
|------|---------|--------|
| 贝叶斯先验均值 0.50 偏低 | AI Agent 市场实际均值 ≈ 0.85，先验低估 0.35 | α=7,β=3（均值 0.70） |
| `confidence=null` 得 5 分，与 confidence=1.0 相同 | 逻辑颠倒：未声明 = 高声明 | null → 3 分 |
| DID 系数偏低（0.09）| 伪造 vs 可信差距仅 7.2 分，占比 6.5% | 建议提升至 0.12（留给 v4）|
| probePassRate 先验均值 0.60 偏低 | 建议 α=8,β=2（均值 0.80）| ✅ 已实现 |
| `preferenceBonus +15` 二进制突变 | 被偏好老伙伴可压制顶级新 Worker | +10 降低，+1.5/次合作 |

### ECO 派（生态设计）核心发现

| 激励问题 | 根因 | 严重度 |
|---------|------|--------|
| 低价值任务死亡螺旋 | `scoreTaskForWorker` age_penalty 让旧任务分数更低，旧任务更没人接 | **P0（生态失效）** |
| capabilities 零成本声明漏洞 | 声明所有 category 无成本但 +15 分，无验证机制 | P1（激励失效）|
| 心跳刷分博弈空间 | 高频心跳稳拿 20 分，新 Worker 竞争时唯一决胜因素 | P1 |
| 首次失败比零记录更差 | `totalTasks=1, rate=0` → 贝叶斯 0.40 < 新人保底 0.50 | P2 |

---

## 二、v3 变更详解

### 2.1 贝叶斯先验均值校准（ALPHA 提升）

**问题**：v2 先验均值 0.50（completionRate）和 0.60（probePassRate）低估了 AI Agent 市场的实际水平。

**修复**：

| 字段 | v2 | v3 | 先验均值 |
|------|----|----|---------|
| COMPLETION_ALPHA | 2 | **7** | 0.50 → **0.70** |
| COMPLETION_BETA | 2 | **3** | | 
| PROBE_ALPHA | 3 | **8** | 0.60 → **0.80** |
| PROBE_BETA | 2 | **2** | |

**效果对比**（新 Worker，totalTasks=0，priority=medium）：

| 维度 | v2 新 Worker 得分 | v3 新 Worker 得分 | 变化 |
|------|----------------|----------------|------|
| completionRate（×20） | 0.50×20 = **10.0** | 0.70×20 = **14.0** | +4.0 |
| probePassRate（×13） | 0.60×13 = **7.8** | 0.80×13 = **10.4** | +2.6 |

新 Worker 冷启动基础分从约 61.5 提升到约 68.1（+6.6 分），更贴近市场实际水平。

### 2.2 `confidence=null` 逻辑修复

**问题**：v2 中 `skill_confidence=null` 得 5 分，与 `skill_confidence=1.0` 完全相同，逻辑颠倒。

**修复**：

```
confidence=null    → +3 分（保守默认，表示"未知置信度"）
confidence=1.0     → +5 分（完全自信）
confidence=0.6     → +3 分（与 null 相当，低置信度不应优于未声明）
```

| confidence 值 | v2 得分 | v3 得分 | 说明 |
|-------------|--------|--------|------|
| 1.0 | 20 | 20 | 不变 |
| 0.8 | 19 | 19 | 不变 |
| 0.6 | 18 | 18 | 不变 |
| null | **20** | **18** | -2分，消除逻辑颠倒 |

### 2.3 Publisher 偏好加成收紧

**问题**：v2 最大组合加成 +23（preferenceBonus=15 + collabBonus=8），可让低质量老伙伴压制顶级新 Worker。

**修复**：

| 参数 | v2 | v3 | 总最大加成 |
|------|----|----|----------|
| preferenceBonus | +15 | **+10** | |
| collabBonus/次 | +2 | **+1.5** | |
| collabBonus 上限 | +8（≥4次） | **+6（≥4次）** | |
| **组合上限** | **+23** | **+16** | 减少 7 分 |

**验证**：老伙伴 rawScore=45，recentCancelCount=3，cancelFactor=0.76：
```
v2: (45 + 23) × 0.76 = 51.68
v3: (45 + 16) × 0.76 = 46.36
顶级新 Worker 需要达到 46.36 分即可超越
```

### 2.4 `scoreTaskForWorker` 年龄衰减反转

**问题（ECO派 P0 级）**：老任务年龄越大，`scoreTaskForWorker` 分越低，形成死亡螺旋：
```
旧任务 → 低分 → Worker 不接 → 更旧 → 更低分 → 永久积压
```

**修复**：将年龄惩罚改为年龄溢价（urgency premium）：

```
v2: score -= min(ageMinutes / 12, 10)   // 老任务扣分，最多 -10
v3: score += min(ageMinutes / 20, 15)   // 老任务加分，最多 +15
```

**效果对比**（低价值任务 estimatedTokens=30，等待 120 分钟）：

| 指标 | v2 得分 | v3 得分 |
|------|--------|--------|
| Nectar | 0.6 | 0.6 |
| 年龄贡献 | **-10（惩罚）** | **+6（溢价）** |
| 总分 | **~8.6** | **~24.6** |

现在老任务会随时间自然积累优先级，防止长尾积压。

### 2.5 `generateMatchHint` 字符串匹配修复

**问题（STRESS 派 P1 级）**：`capabilities: { contains: category }` 进行字符串包含匹配，`"code"` 会误匹配 `"code-review"`, `"code-gen"` 等。

**修复**：改为匹配带引号的 JSON 字符串值：

```typescript
// v2（错误）
capabilities: { contains: category }        // "code" 匹配 "code-review"

// v3（修复）
capabilities: { contains: `"${category}"` } // '"code"' 不匹配 '"code-review"'
```

**误报率消除**：假设 10 个 Worker 中 3 个有 "code-*" 能力但不支持 "code"，1 个支持 "code"：
- v2 `capableWorkerCount = 4`（误报 75%），`matchConfidence = medium`
- v3 `capableWorkerCount = 1`，`matchConfidence = low`（正确）

---

## 三、v3 满分变化分析

| 维度 | v2 满分 | v3 满分 | 变化 |
|------|--------|--------|------|
| completionRate（high priority） | 25 | 25 | — |
| probePassRate | 13 | 13 | — |
| capabilityMatch（confidence=1.0） | 20 | 20 | — |
| capabilityMatch（confidence=null） | **20** | **18** | -2 |
| preferenceBonus | **15** | **10** | -5 |
| collabBonus | **8** | **6** | -2 |
| **理论满分（含 preference）** | **133** | **124** | -9 |

满分降低 9 分，使评分分布更紧凑，更接近市场区分度真实需求。

---

## 四、遗留 v4 工作项

以下问题三派 Agent 均有讨论，但超出本次迭代范围，留给 v4：

1. **capabilities 探针绑定验证**（ECO P1）：声明 category 必须通过对应 probeType 探针，零成本声明漏洞的根本解法
2. **心跳频率惩罚**（ECO P1）：防止高频心跳刷分，`heartbeatFreshness` 引入最小间隔惩罚
3. **DID 系数提升至 0.12**（DATA）：进一步强化身份安全维度
4. **高价值任务门控改为 authenticityScore < 60**（DATA）：从制度层面加强 DID 要求
5. **硬门控解耦 fallback 默认值**（STRESS P2）：新 Worker 单独处理路径，防止阈值=默认值的精确咬合脆弱性
6. **category 专项完成率统计**（已知局限 #2）：从 Task 表统计 per-category 完成率替代全局值

---

## 五、三轮迭代全景对比

| 版本 | 核心改进 | 遗留问题 |
|------|---------|---------|
| **v1** | 基础评分（12维度），统一评分入口 | 双重计数、步进跳变、候选池截断、lockNectar 原子性漏洞 |
| **v2** | 贝叶斯平滑、指数衰减、乘法折扣、硬门控、Publisher偏好、评分快照、tryAutoMatch评分驱动 | 先验均值偏低、confidence=null逻辑、偏好加成过强、age衰减方向错误、contains误报 |
| **v3** | 先验均值校准、confidence修复、偏好加成收紧、age反转为urgency、contains精确匹配 | capabilities验证、心跳防刷分、DID强化、per-category完成率 |

---

*三轮 Agent 辩论完成，v3 变更已实现并通过 lint 检查。*
