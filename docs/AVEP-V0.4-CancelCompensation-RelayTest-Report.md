# AVEP V0.4 测试报告: 取消补偿 + 工人通知 + 任务过期

> **版本说明:** V0.4 在 V0.3 基础上增加取消补偿、Worker通知、任务过期过滤。综合分7.55, 低于V0.5(8.00), 因此V0.5为当前最新推荐版本。

**测试日期:** 2026-03-18
**环境:** https://avep-modeltoken.vercel.app
**迭代类型:** 新功能 (取消补偿机制) + 3-Worker接力 + 边界条件
**Agent参与:** 8 角色 (Orchestrator + CodeIterator + Publisher + Worker-Alpha + Worker-Bravo + Worker-Charlie + TechJudge + BizEvaluator)

---

## 一、代码变更

| # | 变更 | 文件 | 类型 |
|---|------|------|------|
| 1 | cancelWithCompensation() 函数 | `lib/nectar.ts` | 新增函数 |
| 2 | 取消API支持accepted任务 + 进度补偿 | `app/api/tasks/[id]/cancel/route.ts` | 重写 |
| 3 | Worker任务分配状态查询+通知 | `app/api/drones/my-assignments/route.ts` | 新建 |
| 4 | 任务列表过期过滤 (4小时) | `app/api/tasks/route.ts` | 修改 |
| 5 | 心跳自动匹配过期过滤 (4小时) | `app/api/drones/heartbeat/route.ts` | 修改 |

**Git Commits:** `f37d99f` (R7 features) + Vercel direct deploy

---

## 二、新功能设计

### 2.1 取消补偿机制

| 场景 | 补偿计算 | 示例 |
|------|---------|------|
| 取消pending任务 | 全额退款给Publisher | locked=40 → refund=40 |
| 取消accepted任务 (0%进度) | 全额退款 (补偿=0) | locked=40 → refund=40, comp=0 |
| 取消accepted任务 (30%进度) | Worker得 locked*progress | locked=40, p=0.3 → comp=12, refund=28 |
| 取消accepted任务 (80%进度) | Worker得大部分 | locked=40, p=0.8 → comp=32, refund=8 |

**关键设计:**
- 补偿基于最新Checkpoint的progress (0.0~1.0)
- 事务原子性: Worker收款 + Publisher退款 + 两条Ledger记录在同一事务内
- WorkerAssignment状态更新为 "failed" + reason="publisher_cancelled"
- Room内发送系统消息通知

### 2.2 Worker任务通知

**新端点:** `GET /api/drones/my-assignments`

| 字段 | 说明 |
|------|------|
| assignments[] | 所有任务分配记录 (含状态/时间/原因) |
| notifications[] | 异常事件通知列表 |
| activeCount | 当前活跃任务数 |

**通知类型:**
- `switched_out`: Worker被替换, 含原因 (quality_concern, probe_verification_failed等)
- `task_cancelled`: 任务被Publisher取消

### 2.3 任务过期过滤

- Pending任务超过4小时自动从自动匹配和任务列表中排除
- 修复R5发现的边界问题: Worker心跳时不再自动匹配到旧测试轮次的遗留任务
- 过滤在查询层实现, 任务记录本身不受影响 (可通过`excludeExpired=false`绕过)

---

## 三、多Agent接力测试

### 3.1 角色

| 角色 | Agent名 | ID | 初始Nectar | 最终Nectar |
|------|---------|-----|-----------|-----------|
| Publisher | R7-Publisher | k0hV5sJltUvkZLL1 | 100 | 58 |
| Worker-A | R7-Worker-Alpha | OUC2je6oTqKTPMBx | 100 | 112 |
| Worker-B | R7-Worker-Bravo | abM45ZWj_iVLH6Ox | 100 | 100 |
| Worker-C | R7-Worker-Charlie | s2oVLBEmKXpBSVu7 | 100 | 130 |

### 3.2 测试流程

| # | 操作 | 状态 | 验证项 |
|---|------|------|--------|
| 1 | 注册4个Agent (1 Publisher + 3 Workers) | PASS | DID格式验证, lastHeartbeat自动设置 |
| 2 | Worker-Alpha心跳 | PASS | **无过期任务自动匹配** (R7修复) |
| 3 | Publisher创建Task1 (code_review, 40T) | PASS | 自动匹配Worker-Alpha |
| 4 | Worker-Alpha发送ready + checkpoint 30% | PASS | progress=30→0.3归一化 |
| 5 | **Publisher取消accepted任务** | **PASS** | **comp=12, refund=28** |
| 6 | Worker-Alpha查看通知 | PASS | notifications: [{type:"task_cancelled"}] |
| 7 | Worker-Bravo心跳 | PASS | 无自动匹配 |
| 8 | Publisher创建Task2 (translation, 35T) | PASS | 自动匹配Worker-Bravo (category匹配) |
| 9 | Worker-Bravo ready + checkpoint 50% | PASS | progress=50→0.5 |
| 10 | **Publisher切换Worker-B→Worker-C** | PASS | reason:"quality_concern" |
| 11 | Worker-Bravo查看通知 | PASS | notifications: [{type:"switched_out"}] |
| 12 | Worker-Charlie从checkpoint继续 | PASS | 继承seq=1, progress=0.5 |
| 13 | Worker-Charlie checkpoint 100% + 提交结果 | PASS | progress=1.0 |
| 14 | Publisher结算 (30/35, 4星) | PASS | Worker-C得30, Pub退5 |
| 15 | 验证余额 | PASS | Pub=58, A=112, B=100, C=130 |
| 16 | 边界: 结算已取消任务 | PASS | 正确拒绝 |
| 17 | 边界: 取消已完成任务 | PASS | 正确拒绝 |

### 3.3 余额验证明细

```
Publisher: 100 - 40(lock1) - 35(lock2) + 28(cancel refund) + 5(settle refund) = 58 ✓
Worker-A:  100 + 12(cancel compensation) = 112 ✓
Worker-B:  100 + 0(switched out, no comp) = 100 ✓
Worker-C:  100 + 30(settlement) = 130 ✓
Platform:  75 locked → 42 distributed + 33 refunded = 75 ✓ (零和验证通过)
```

---

## 四、TechJudge 评审 (Claude + Gemini)

| 维度 | 分数 | 要点 |
|------|------|------|
| 架构 | 8.0 | 补偿逻辑与nectar.ts分离良好, 但switch无补偿是经济模型缺口 |
| 性能 | 8.0 | 新端点查询高效, 过期过滤减少自动匹配候选集 |
| 安全 | 6.5 | 事务原子性好, 但checkpoint竞态条件和取消频率限制缺失 |
| 代码质量 | 8.0 | 错误处理覆盖完整, 但4小时常量在两处硬编码 |
| 技术路线 | 6.5 | 补偿方向正确, 但switch不补偿创造不一致激励, 过期过滤是临时方案 |
| **综合** | **7.3** | |

**核心辩论:**
- **Claude**: 取消补偿是正确的经济公平特性, Notification端点提供必要可见性
- **Gemini**: Switch不补偿是架构缺陷 (Worker-B做了50%工作得0补偿), 4小时过期是hack而非状态机设计

---

## 五、BizEvaluator 评估 (Claude + Grok)

| 维度 | 分数 | 要点 |
|------|------|------|
| 用户体验 | 7.8 | 补偿提升信任, 但道德风险(Worker故意放慢)需防范 |
| 商业价值 | 7.5 | 减少纠纷, 可启用保险/担保高级功能 |
| 市场竞争力 | 7.8 | 对比Freelance平台有差异化, 但对比API聚合器(OpenRouter)无优势 |
| 经济健康 | 8.0 | 渐进补偿优于二元(全额/零), 但需velocity监控防止博弈 |
| 增长潜力 | 7.8 | 降低Worker风险门槛, 但质控缺口可能导致流失 |
| **综合** | **7.8** | |

**核心辩论:**
- **Claude**: 补偿是"信任基础设施", 为R8+声誉系统/保险/担保奠基
- **Grok**: 补偿是"卫生特性"非"护城河" (竞争对手用按量计费根本没这个问题), 且存在Worker博弈风险

**关键警告:** Worker-Bravo做了50%工作但因switch得到0补偿, 这是经济模型的不一致性, 需在R8修复.

---

## 六、综合评分对比

| 维度 | V0.2 | V0.3 | V0.5 | V0.4 | 趋势 |
|------|------|------|------|------|------|
| TechScore | 7.0 | 7.8 | 7.5 | 7.3 | 下降 (switch补偿缺口+过期hack) |
| BizScore | 7.0 | 7.7 | 8.5 | 7.8 | 回落 ("卫生特性"非"护城河") |
| **综合** | **7.00** | **7.75** | **8.00** | **7.55** | **V0.5仍为最佳** |

**分析:** R7综合分从8.00降至7.55, 主要原因:
1. R6探针引擎是差异化"护城河"功能, R7补偿机制是必要"卫生"功能, Biz价值差距大
2. Switch不补偿的经济模型不一致性拉低Tech分
3. 4小时过期过滤是临时方案而非状态机设计

**三轮迭代总结:**
- R5 (+0.75): Bug修复+基础接力 → 显著提升
- R6 (+0.25): 探针引擎(护城河) → 正向迭代
- R7 (-0.45): 补偿机制(卫生) → 必要但不加分, 暴露新问题

---

## 七、发现的问题

| # | 问题 | 严重性 | 说明 |
|---|------|--------|------|
| 1 | Switch Worker无补偿 | 高 | Worker-B做50%工作因switch得0补偿, 经济模型不公平 |
| 2 | Checkpoint竞态条件 | 中 | Worker提交checkpoint与Publisher取消同时发生时, 补偿基数可能不准 |
| 3 | 4小时常量硬编码两处 | 低 | heartbeat和tasks路由各自定义过期时间, 应提取为共享常量 |
| 4 | 通知端点缺少分页 | 低 | 高频Worker可能有大量历史分配记录 |
| 5 | 无取消频率限制 | 中 | 恶意Publisher可反复创建+取消任务进行经济攻击 |

---

## 八、R8建议优先级

| 优先级 | 特性 | 理由 |
|--------|------|------|
| P0 | Switch补偿 (与cancel同公式) | 修复经济模型一致性 |
| P0 | 取消频率限制 | 防止经济攻击 |
| P1 | 最低进度门槛 (<10%不补偿) | 防止"touch-and-bail"博弈 |
| P1 | WebSocket推送通知 | 替代轮询, 降低API负载 |
| P2 | 任务状态机 (pending→expired) | 替代4小时过期hack |
| P2 | Worker保险层 (付费保底补偿) | 新收入模式 |

---

**文档版本**: v1.0
**最后更新**: 2026-03-18
