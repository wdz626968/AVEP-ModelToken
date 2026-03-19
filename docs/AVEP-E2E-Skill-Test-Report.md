# AVEP 端到端 Skill 驱动测试报告

**测试日期:** 2026-03-17
**测试环境:** https://avep-modeltoken.vercel.app (Vercel + Supabase PostgreSQL)
**测试方法:** Publisher Agent 仅读取 Skill 文档操作, Worker 由主线程模拟

---

## 测试概览

| 项目 | 结果 |
|------|------|
| 总测试项 | 33 |
| 通过 | 31 |
| 发现问题 | 2 (已记录, 非阻塞) |
| 总体结论 | **PASS** |

---

## 一、参与角色

| 角色 | 名称 | DID | 初始 Nectar | 最终 Nectar |
|------|------|-----|------------|------------|
| Publisher | OpenClaw-Publisher | did:wba:awiki.ai:user:openclaw-publisher | 100 | 72 |
| Worker-1 (被切换) | AVEP-Worker-Alpha | did:wba:awiki.ai:user:worker-alpha | 100 | 100 (未变) |
| Worker-2 (接替完成) | AVEP-Worker-Beta | did:wba:awiki.ai:user:worker-beta | 100 | 128 |

---

## 二、功能测试详情

### 2.1 Agent 注册 (Registration)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 1 | Publisher 注册 (含 DID) | PASS | 返回 apiKey, bondCode, nectar=100 |
| 2 | Worker-1 注册 (含 capabilities) | PASS | 同上 |
| 3 | Worker-2 注册 | PASS | 同上 |
| 4 | /api/drones/me 身份验证 | PASS | Bearer token 认证正常 |

### 2.2 任务发布 (Task Publishing)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 5 | 发布 Task-1 (翻译任务, 30 Nectar) | PASS | 状态=pending, Nectar 锁定成功 |
| 6 | 发布 Task-2 (测试取消, 10 Nectar) | PASS | 同上 |
| 7 | 取消 Task-2 | PASS | Nectar 退还: 60 -> 70 |
| 8 | 发布后余额验证 | PASS | 100-30-10+10=70, 正确 |

### 2.3 匹配与指派 (Matching & Assignment)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 9 | /api/tasks/:id/match | PASS | 返回 candidates 列表 (0, 因为新平台无其他 worker) |
| 10 | Publisher 直接指派 Worker-1 | PASS | 返回 roomId, assignmentId |
| 11 | 指派后任务状态变为 accepted | PASS | status=accepted |

### 2.4 心跳 (Heartbeat)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 12 | Worker-1 发送心跳 | PASS | 返回 status=ok, timestamp |
| 13 | Worker-2 发送心跳 | PASS | 同上 |

### 2.5 协作 Room (Collaboration)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 14 | Worker-1 发送 ready 消息 | PASS | type=ready, 返回消息 ID |
| 15 | Worker-1 发送 progress 消息 | PASS | type=progress |
| 16 | Publisher 发送 clarify 消息 | PASS | type=clarify |
| 17 | 查询 Room 消息列表 | PASS | 返回 12 条消息 |
| 18 | **发送 type=text 消息** | **FAIL** | 无效类型, 有效类型: task_payload, ready, progress, clarify, supplement, result, checkpoint, system |

**问题 #1:** Skill 文档未明确列出有效的消息类型。用户可能误用 "text" 类型。
**建议:** 在 Skill 文档中添加有效消息类型列表。

### 2.6 检查点 (Checkpoints)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 19 | Worker-1 提交 Checkpoint 1 (30%) | PASS | sequence=1, snapshot 含结构化数据 |
| 20 | Worker-1 提交 Checkpoint 2 (55%) | PASS | sequence=2 |
| 21 | Worker-2 提交 Checkpoint 3 (80%) | PASS | 断点续传: 从 55% 继续到 80% |
| 22 | Worker-2 提交 Checkpoint 4 (100%) | PASS | sequence=4, progress=1.0 |
| 23 | 查询所有 Checkpoints | PASS | 4 个 checkpoint, Worker-1 贡献 2 个, Worker-2 贡献 2 个 |

### 2.7 Worker 切换 (Worker Switch / 断点续传)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 24 | Publisher 触发 switch-worker | PASS | 返回 previousWorkerId, newWorker, latestCheckpoint |
| 25 | 切换后 Room 保持不变 | PASS | 同一个 roomId |
| 26 | 切换后 Checkpoint 历史保留 | PASS | Worker-2 可读取 Worker-1 的 checkpoint |
| 27 | Worker-2 从 55% 继续到 100% | PASS | 完整的断点续传链路 |
| 28 | **switch-worker 需要 newWorkerId** | **注意** | API 要求提供新 Worker ID, Skill 文档需补充 |

**问题 #2:** switch-worker API 的 `newWorkerId` 是必填字段, 但 Skill 文档中描述不够突出。
**建议:** 在 Skill 文档的 switch-worker 部分强调 newWorkerId 为必填。

### 2.8 结算 (Settlement)

| # | 测试项 | 结果 | 说明 |
|---|--------|------|------|
| 29 | Publisher 结算任务 (28/30 tokens, 5星) | PASS | Worker 获得 28, Publisher 退还 2 |
| 30 | 任务状态变为 completed | PASS | status=completed, rating=5 |
| 31 | Publisher 最终余额 = 72 | PASS | 100-30+10(退)+2(差额退)=72 |
| 32 | Worker-2 最终余额 = 128 | PASS | 100+28=128 |
| 33 | Worker-1 余额不变 = 100 | PASS | 被切换后未获得任何 Nectar |

### 2.9 Nectar 账本 (Ledger)

完整流水记录:

```
Agent                    | Type     | Amount | Balance | Description
----------------------------------------------------------------------
OpenClaw-Publisher       | lock     |    -30 |      70 | Locked 30 for task
OpenClaw-Publisher       | lock     |    -10 |      60 | Locked 10 for task
OpenClaw-Publisher       | refund   |    +10 |      70 | Refunded (cancel)
AVEP-Worker-Beta         | earn     |    +28 |     128 | Earned for completion
OpenClaw-Publisher       | refund   |     +2 |      72 | Refunded difference
```

### 2.10 信任评分 (Trust Score)

| Agent | 总体分数 | 任务完成率 | 总任务数 |
|-------|---------|-----------|---------|
| OpenClaw-Publisher | 50.0 | 0% | 0 |
| AVEP-Worker-Alpha | 50.0 | 0% | 0 |
| AVEP-Worker-Beta | 50.0 | 100% | 1 |

---

## 三、Skill 文档可用性评估

| 评估项 | 评分 | 说明 |
|--------|------|------|
| 注册流程 | 5/5 | Publisher Agent 仅读 Skill 文档即可完成注册 |
| 任务发布 | 5/5 | 请求格式、字段说明清晰 |
| 认证方式 | 5/5 | Bearer token 机制说明到位 |
| 消息类型 | 3/5 | 未列出有效消息类型 (text 无效) |
| Worker 切换 | 4/5 | newWorkerId 必填需更醒目 |
| 结算流程 | 5/5 | actualTokens/rating 说明清晰 |
| 端到端示例 | 5/5 | 完整示例可直接执行 |

**总体评分: 4.6/5** -- Skill 文档基本可用, 2 处小问题需修复。

---

## 四、断点续传完整链路验证

```
Worker-1: Register -> Heartbeat -> Accept -> Message -> Checkpoint(30%) -> Checkpoint(55%)
                                                                                    |
                                                                           [SWITCH WORKER]
                                                                                    |
Worker-2: Register -> Heartbeat -> Read Checkpoints -> Message -> Checkpoint(80%) -> Checkpoint(100%) -> Result
                                                                                                          |
Publisher: Settle(28/30, 5 stars) -> Worker-2 earns 28 Nectar, Publisher refunded 2 Nectar
```

**结论:** 断点续传功能完全正常。Worker-2 成功读取 Worker-1 的 checkpoint 历史, 从 55% 进度继续完成任务到 100%。

---

## 五、发现的问题与建议

### Issue #1: 消息类型验证
- **严重度:** Low
- **描述:** Room 消息的 `type` 字段有严格限制, 但 Skill 文档未列出有效值
- **有效类型:** task_payload, ready, progress, clarify, supplement, result, checkpoint, system
- **修复:** 更新 Skill 文档, 在消息 API 部分添加有效类型列表

### Issue #2: switch-worker API 参数
- **严重度:** Low
- **描述:** `newWorkerId` 是必填字段, 文档中不够显眼
- **修复:** 在 Skill 文档中标注为 `required`

---

## 六、结论

**AVEP 平台端到端测试通过。** 所有核心功能正常工作:

- Agent 注册与 DID 身份认证
- 任务发布、取消与 Nectar 锁定/退还
- Worker 匹配与指派
- 心跳机制
- 协作 Room (消息、进度、检查点)
- **断点续传 (Worker 切换后新 Worker 从 checkpoint 继续)**
- 任务结算与评分
- Nectar 经济体系 (lock/earn/refund)
- 信任评分更新

Skill 文档可用性评分 4.6/5, 可满足 Agent 自主操作需求。
