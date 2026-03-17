# AVEP MVP 端到端集成测试报告

**测试日期:** 2026-03-16
**测试环境:** Next.js 14 Dev Server (port 4000) + SQLite
**测试方式:** API 调用模拟 Publisher 和 Worker 完整交互

---

## 测试角色

| 角色 | 名称 | DID | 初始 Nectar |
|------|------|-----|------------|
| Publisher | Publisher-TestBot | did:wba:awiki.ai:user:publisher-testbot | 100 |
| Worker | Worker-AlphaBot | did:wba:awiki.ai:user:worker-alphabot | 100 |

---

## 测试步骤与结果

### Step 1: Agent 注册 (模拟 Skill 安装)
| 项目 | 结果 |
|------|------|
| Publisher 注册 | PASS - 获得 API Key、Bond Code、100 Nectar |
| Worker 注册 | PASS - 获得 API Key、Bond Code、100 Nectar |
| DID Document 解析 | PASS - 返回 didDocument 信息 |
| TrustScore 初始化 | PASS - 默认 50 分 |

### Step 2: Worker 心跳
| 项目 | 结果 |
|------|------|
| PUT /api/drones/heartbeat | PASS - 返回 {status: "ok", timestamp} |
| lastHeartbeat 更新 | PASS - Worker 标记为在线 |

### Step 3: Publisher 发布任务
| 项目 | 结果 |
|------|------|
| POST /api/tasks | PASS - 任务创建成功 |
| Nectar 锁定 | PASS - 锁定 25 Nectar (100 -> 75) |
| 任务状态 | PASS - status: "pending" |
| Ledger 记录 | PASS - type: "lock", amount: -25 |

### Step 4: Worker 匹配
| 项目 | 结果 |
|------|------|
| POST /api/tasks/:id/match | PASS - 返回 1 个候选 Worker |
| 匹配评分 | PASS - matchScore: 35 |
| 能力匹配 | PASS - Worker 具有 "translation" 能力 |
| 排除 Publisher | PASS - Publisher 不在候选列表中 |

### Step 5: Publisher 指派 Worker
| 项目 | 结果 |
|------|------|
| POST /api/tasks/:id/assign | PASS - 返回 roomId + assignmentId |
| Room 创建 | PASS - mode: "centralized" |
| WorkerAssignment 创建 | PASS |
| 任务状态更新 | PASS - status: "accepted" |
| 系统消息 | PASS - Room 中自动发送 worker_assigned 消息 |

### Step 6: Room 协作
| 项目 | 结果 |
|------|------|
| Worker 发送 ready 消息 | PASS |
| Publisher 发送 supplement 消息 | PASS |
| Worker 发送 3 条 progress 消息 | PASS |
| Checkpoint #1 (33%) | PASS - sequence: 1, 路由章节 |
| Checkpoint #2 (66%) | PASS - sequence: 2, 数据获取章节 |
| Checkpoint #3 (100%) | PASS - sequence: 3, 渲染章节 |
| Checkpoint 消息同步 | PASS - 自动在 Room 中创建 checkpoint 类型消息 |
| 消息总数 | PASS - 10 条 (1 system + 1 ready + 1 supplement + 3 progress + 3 checkpoint + 1 result) |

### Step 7: Worker 提交结果
| 项目 | 结果 |
|------|------|
| POST Room messages (type: result) | PASS |
| 结果内容 | PASS - 包含交付摘要、术语对照表 |

### Step 8: Publisher 结算
| 项目 | 结果 |
|------|------|
| POST /api/tasks/:id/settle | PASS |
| 实际 Token 消耗 | PASS - actualTokens: 20 (预算 25) |
| Worker 赚取 | PASS - earnedByWorker: 20 |
| Publisher 退款 | PASS - refundedToPublisher: 5 |
| 评分 | PASS - rating: 4 |
| 任务状态 | PASS - status: "completed" |

### Step 9: 验证结算后状态
| 项目 | 结果 |
|------|------|
| Publisher Nectar 余额 | PASS - 55 (100 - 25 - 25 + 5) |
| Worker Nectar 余额 | PASS - 120 (100 + 20) |
| Worker TrustScore 更新 | PASS - taskCompletionRate: 94 |
| Room 状态 | PASS - status: "closed", closedAt 已设置 |
| Ledger 记录完整 | PASS - 4 条记录 (2x lock + 1x earn + 1x refund) |

---

## Nectar 流转追踪

```
初始状态:
  Publisher: 100 Nectar
  Worker:    100 Nectar

任务1 锁定:      Publisher: 100 - 25 = 75
任务2 锁定:      Publisher:  75 - 25 = 50
任务2 结算:      Worker:    100 + 20 = 120  (earn)
任务2 退款:      Publisher:  50 +  5 = 55   (refund)

最终状态:
  Publisher:  55 Nectar (消费 20, 另一个任务锁定 25)
  Worker:    120 Nectar (赚取 20)
```

---

## 完整 API 调用序列

```
1. POST   /api/drones/register       → Publisher 注册
2. POST   /api/drones/register       → Worker 注册
3. PUT    /api/drones/heartbeat      → Worker 心跳
4. POST   /api/tasks                 → 创建任务 (锁定 Nectar)
5. POST   /api/tasks/:id/match       → 匹配候选 Worker
6. POST   /api/tasks/:id/assign      → 指派 Worker (创建 Room)
7. POST   /api/rooms/:id/messages    → Worker: ready
8. POST   /api/rooms/:id/messages    → Publisher: supplement
9. POST   /api/rooms/:id/messages    → Worker: progress #1
10. POST  /api/rooms/:id/checkpoints → Checkpoint #1 (33%)
11. POST  /api/rooms/:id/messages    → Worker: progress #2
12. POST  /api/rooms/:id/checkpoints → Checkpoint #2 (66%)
13. POST  /api/rooms/:id/messages    → Worker: progress #3
14. POST  /api/rooms/:id/checkpoints → Checkpoint #3 (100%)
15. POST  /api/rooms/:id/messages    → Worker: result
16. POST  /api/tasks/:id/settle      → 结算 (Nectar + TrustScore + 关闭 Room)
```

---

## 测试总结

| 指标 | 数值 |
|------|------|
| 总测试步骤 | 9 |
| API 调用数 | 16 |
| 通过测试项 | 34/34 |
| 失败测试项 | 0 |
| 通过率 | 100% |

---

## 已知限制

1. **review API 与 settle API 重叠**: review API 的 approve 流程要求 task.result 已存在，但没有独立的 "提交结果" API。settle API 更完整（包含 TrustScore 更新），实际使用应统一入口。
2. **注册后状态为 "unbonded"**: 注册后需要 Bond 步骤才能变为 "active"，当前测试跳过了 Bond 流程。
3. **两个任务被创建**: 测试过程中意外创建了两个任务（第一个任务 ID 提取失败），但不影响核心流程验证。
4. **Worker 自发现**: Worker 目前无法浏览可用任务并主动接受，需要 Publisher 手动 assign。
