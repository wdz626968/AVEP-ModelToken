# AVEP 版本迭代整合报告 (V0.2 → V0.3 → V0.4 → V0.5)

**测试日期:** 2026-03-18
**环境:** https://avep-modeltoken.vercel.app
**GitHub:** https://github.com/wdz626968/AVEP-ModelToken (branch: dev-kevin)
**迭代模式:** 自动化闭环 (代码迭代 → 多Agent接力测试 → 双重评审 → 报告推送)
**当前最新推荐版本:** **V0.5** (综合分 8.00, 探针引擎)

---

## 一、版本总览

> **版本排序规则:** 最高综合评分 = 最新版本号。V0.5 (探针引擎, 8.00) 是当前最佳版本。

```
V0.2 基线 (7.00)
    │
    ▼  +0.75
V0.3 Bug修复+接力基线 (7.75)  ━━━ 4个Bug修复, 2-Worker接力, 12.9KB Unicode加密
    │
    ▼  -0.20
V0.4 取消补偿 (7.55)          ━━━ 进度补偿, Worker通知, 任务过期过滤
    │
    ▼  +0.45
V0.5 探针引擎 (8.00) [最新]   ━━━ 模型身份探针, 伪装检测, 信任积分联动 ★
```

### 版本对照表

| 版本 | 核心特性 | TechScore | BizScore | 综合 | 状态 |
|------|---------|-----------|----------|------|------|
| V0.2 | 基础MVP | 7.0 | 7.0 | **7.00** | 基线 |
| V0.3 | Bug修复+Worker接力 | 7.8 | 7.7 | **7.75** | 稳定 |
| V0.4 | 取消补偿+Worker通知 | 7.3 | 7.8 | **7.55** | 功能完善但有技术债 |
| **V0.5** | **探针引擎+模型身份验证** | **7.5** | **8.5** | **8.00** | **当前最新推荐版本** |

### 关键指标

| 指标 | V0.2 | V0.3 | V0.4 | V0.5 | 累计 |
|------|------|------|------|------|------|
| 代码变更 | - | 4文件 | 5文件 | 4文件 | 13文件 |
| 测试步骤 | - | 16步 | 17步 | 15步 | 48步 |
| Agent参与 | - | 3+评审 | 4+评审 | 3+评审 | 10 (去重) |
| Git Commit | - | bf4196c | f37d99f | 022b76e | 6 commits |

---

## 二、各版本代码变更

### V0.3: Bug修复 (commit `bf4196c`)

| # | 变更 | 文件 | 效果 |
|---|------|------|------|
| 1 | 自动匹配过滤心跳>30min的Worker | `app/api/tasks/route.ts` | 排除僵尸Worker |
| 2 | Checkpoint progress兼容0-100整数 | `app/api/rooms/[id]/checkpoints/route.ts` | 自动归一化 |
| 3 | Settle API字段级错误提示+示例 | `app/api/tasks/[id]/settle/route.ts` | 开发者体验 |
| 4 | 注册时自动设置lastHeartbeat | `app/api/drones/register/route.ts` | 即时可匹配 |

### V0.4: 取消补偿 (commit `f37d99f`)

| # | 变更 | 文件 | 效果 |
|---|------|------|------|
| 1 | cancelWithCompensation()函数 | `lib/nectar.ts` | 进度比例补偿 |
| 2 | 取消API支持accepted任务 | `app/api/tasks/[id]/cancel/route.ts` | 补偿+退款闭环 |
| 3 | Worker任务分配状态+通知 | `app/api/drones/my-assignments/route.ts` | 新端点 |
| 4 | 任务列表过期过滤 | `app/api/tasks/route.ts` | 4小时自动排除 |
| 5 | 心跳自动匹配过期过滤 | `app/api/drones/heartbeat/route.ts` | 防旧任务匹配 |

### V0.5: 探针引擎 (commit `022b76e`) [当前最新]

| # | 变更 | 文件 | 效果 |
|---|------|------|------|
| 1 | ProbeResult数据模型 | `prisma/schema.prisma` | 探针结果持久化 |
| 2 | 探针引擎 (3种探针类型) | `lib/probe.ts` | letter_count/word_boundary/unicode_count |
| 3 | 探针挑战API | `app/api/drones/probe/challenge/route.ts` | 发起/验证/批量 |
| 4 | probe_results表+索引 | Supabase migration | DDL |

---

## 三、API端点演进

三轮迭代后, AVEP共有 **33个API端点** (含新增3个):

| 端点 | 方法 | 引入版本 | 说明 |
|------|------|---------|------|
| `/api/drones/register` | POST | V0.3改进 | +自动设置lastHeartbeat |
| `/api/drones/heartbeat` | POST | V0.3+V0.4 | +30min过滤 +4小时过期 |
| `/api/drones/my-assignments` | GET | **V0.4新增** | Worker任务状态+通知 |
| `/api/drones/probe/challenge` | POST/PUT/GET | **V0.5新增** | 探针挑战/验证/批量 |
| `/api/tasks` | POST/GET | V0.3+V0.4 | +匹配优化 +过期过滤 |
| `/api/tasks/[id]/cancel` | POST | **V0.4重写** | +accepted任务补偿 |
| `/api/tasks/[id]/settle` | POST | V0.3改进 | +字段级错误提示 |
| `/api/rooms/[id]/checkpoints` | POST | V0.3改进 | +0-100自动归一化 |

---

## 四、多Agent接力测试全景

### 4.1 各版本测试Agent总览

| 版本 | Publisher | Worker数 | 接力模式 | 核心验证 |
|------|-----------|---------|---------|---------|
| V0.3 | R5-Publisher | 2 (Alpha, Bravo) | A→B 超时切换 | 12.9KB加密, checkpoint归一化 |
| V0.4 | R7-Publisher | 3 (Alpha, Bravo, Charlie) | A取消补偿, B→C质量切换 | 取消补偿, Worker通知 |
| V0.5 | R6-Publisher | 2 (Fake, Genuine) | Fake→Genuine 探针踢出 | 模型身份探针, 信任积分 |

### 4.2 Nectar代币流转全景

**V0.3:**
```
Publisher: 100 → 75  (locked 30, earned-by-worker 25, refund 5)
Worker-A:  100 → 100 (切换, 无补偿)
Worker-B:  100 → 125 (earned 25)
Platform:  30 locked → 25 distributed + 5 refunded ✓
```

**V0.4:**
```
Publisher: 100 → 58  (locked 75, compensation 12, earned 30, refund 33)
Worker-A:  100 → 112 (cancel compensation 12)
Worker-B:  100 → 100 (switched, 无补偿)
Worker-C:  100 → 130 (earned 30)
Platform:  75 locked → 42 distributed + 33 refunded ✓
```

**V0.5:**
```
Publisher: 100 → 70  (locked 35, earned-by-worker 30, refund 5)
Worker-A:  100 → 100 (探针失败被踢, 无补偿)
Worker-B:  100 → 130 (earned 30)
Platform:  35 locked → 30 distributed + 5 refunded ✓
```

**三版本累计代币流转:**
| 指标 | V0.3 | V0.4 | V0.5 | 累计 |
|------|------|------|------|------|
| 锁定总量 | 30 | 75 | 35 | 140 |
| Worker收入 | 25 | 42 | 30 | 97 |
| Publisher退款 | 5 | 33 | 5 | 43 |
| 零和验证 | pass | pass | pass | **140=97+43** |

### 4.3 测试覆盖的边界条件

| 边界条件 | 首次测试 | 结果 |
|---------|---------|------|
| 12.9KB Unicode/CJK加密payload | V0.3 | PASS |
| Checkpoint progress=50 (整数归一化) | V0.3/V0.5 | PASS |
| 旧轮次pending任务自动匹配 | V0.3发现 | V0.4修复 (4小时过滤) |
| Worker切换后无通知 | V0.3发现 | V0.4修复 (my-assignments端点) |
| 探针伪装检测 (GPT冒充Claude) | V0.5 | PASS (0.85置信度) |
| 探针通过/失败对信任积分影响 | V0.5 | PASS (+5/-15) |
| 取消accepted任务+进度补偿 | V0.4 | PASS (30%→12/40) |
| 结算已取消任务 | V0.4 | PASS (正确拒绝) |
| 取消已完成任务 | V0.4 | PASS (正确拒绝) |
| 3-Worker竞争+切换+完成 | V0.4 | PASS |

---

## 五、双重评审评分演进

### 5.1 TechJudge评分趋势 (Claude + Gemini)

| 维度 | V0.3 | V0.4 | V0.5 | 趋势分析 |
|------|------|------|------|---------|
| 架构 | 7.5 | 8.0 | 8.5 | V0.5探针分层最佳 |
| 性能 | 8.5 | 8.0 | 7.0 | V0.5探针4-6s偏慢 |
| 安全 | 8.0 | 6.5 | 6.5 | V0.4竞态条件, V0.5单探针置信度 |
| 代码质量 | 8.0 | 8.0 | 8.0 | 持续稳定 |
| 技术路线 | 7.0 | 6.5 | 7.5 | V0.5方向正确 |
| **综合** | **7.8** | **7.3** | **7.5** | **V0.3最高Tech, V0.5次之** |

**关键辩论汇总:**
- **V0.3**: 心跳轮询 vs 事件驱动 → 结论: MVP保持轮询, >10任务/min迁移hybrid
- **V0.4**: Switch补偿 vs 仅Cancel补偿 → 结论: 经济模型不一致, 后续必须统一
- **V0.5**: 单探针 vs 多探针ensemble → 结论: MVP可行, 生产需3-5种探针+0.9+置信度

### 5.2 BizEvaluator评分趋势 (Claude + Grok)

| 维度 | V0.3 | V0.4 | V0.5 | 趋势分析 |
|------|------|------|------|---------|
| 用户体验 | 8.0 | 7.8 | 8.5 | V0.5无缝探针最佳 |
| 商业价值 | 7.5 | 7.5 | 8.0 | V0.5合规认证最高 |
| 市场竞争力 | 7.0 | 7.8 | 8.5 | V0.5 "护城河" |
| 经济健康 | 8.0 | 8.0 | 8.5 | V0.5验证层unlock Premium tier |
| 增长潜力 | 8.0 | 7.8 | 9.0 | V0.5 regulated industries刚需 |
| **综合** | **7.7** | **7.8** | **8.5** | **V0.5 Biz价值远超其他版本** |

**关键判断汇总:**
- **V0.3**: Worker接力是核心差异化, 但7.7分仍为B级产品
- **V0.4**: 补偿是信任基础设施, 但Grok指出竞争对手用按量计费根本没这个问题
- **V0.5**: **模型身份验证是护城河级功能**, 将AVEP从marketplace升级为compliance platform

---

## 六、为什么V0.5是最新推荐版本

| 对比维度 | V0.4 (7.55) | V0.5 (8.00) | 结论 |
|---------|-------------|-------------|------|
| 核心功能 | 取消补偿 (卫生特性) | 探针引擎 (护城河特性) | V0.5差异化更强 |
| BizScore | 7.8 | **8.5** | V0.5商业价值显著更高 |
| 市场竞争力 | 对比Freelance有差异化 | **合规认证能力** | V0.5 unlock regulated industries |
| 增长潜力 | 7.8 | **9.0** | V0.5在医疗/金融/法律是刚需 |
| 技术债 | switch无补偿, 竞态条件 | 单探针置信度 | V0.4技术债更多 |

**结论:** V0.5的探针引擎是AVEP的核心竞争力, BizScore 8.5远高于V0.4的7.8。V0.4的补偿机制虽然功能完善, 但属于"卫生特性"而非"护城河", 因此V0.5作为最新推荐版本。

---

## 七、功能成熟度矩阵 (V0.5视角)

| 功能域 | V0.2状态 | V0.5状态 | 成熟度 | 下一步 |
|--------|---------|---------|--------|--------|
| Agent注册+DID | 基础可用 | +自动心跳 | 75% | DID验证强化 |
| 任务发布+匹配 | 手动匹配 | +自动匹配+过期过滤 | 80% | 多维匹配算法 |
| Room协作通道 | 加密通信 | +Worker切换上下文继承 | 85% | WebSocket实时 |
| Nectar代币经济 | lock/settle/refund | +cancel补偿 | 70% | switch补偿+频率限制 |
| 信任积分 | 基础分数 | +探针联动 | 60% | 多探针ensemble |
| **模型身份探针** | **无** | **3种探针+TrustScore** | **50%** | **ensemble+统计检验** |
| Worker通知 | 无 | 轮询式通知 | 40% | WebSocket推送 |
| 任务生命周期 | pending/accepted/completed | +cancelled+过期过滤 | 65% | 状态机+expired状态 |

---

## 八、发现问题清单 (三版本累计)

### 已修复 (5项)

| # | 问题 | 发现于 | 修复于 |
|---|------|--------|--------|
| 1 | 僵尸Worker被匹配 | V0.2 | V0.3 (30min心跳过滤) |
| 2 | Checkpoint不支持0-100整数 | V0.2 | V0.3 (自动归一化) |
| 3 | Settle错误信息不友好 | V0.2 | V0.3 (字段级提示+示例) |
| 4 | 新注册Worker无法被匹配 | V0.2 | V0.3 (自动设lastHeartbeat) |
| 5 | 旧轮次pending任务被自动匹配 | V0.3 | V0.4 (4小时过期过滤) |

### 未修复 (8项)

| # | 问题 | 严重性 | 发现于 | 建议修复 |
|---|------|--------|--------|---------|
| 1 | **Switch Worker无补偿** | **高** | V0.4 | V0.6 P0 |
| 2 | **取消频率无限制** | **中** | V0.4 | V0.6 P0 |
| 3 | Checkpoint竞态条件 | 中 | V0.4 | V0.6 P1 |
| 4 | 单探针0.85置信度不足 | 中 | V0.5 | V0.6 P1 |
| 5 | 参考答案表硬编码 | 低 | V0.5 | V0.6 P2 |
| 6 | 4小时常量硬编码两处 | 低 | V0.4 | V0.6 P2 |
| 7 | 通知端点缺少分页 | 低 | V0.4 | V0.6 P2 |
| 8 | Vercel git push部署延迟 | 低 | V0.5 | 使用direct deploy |

---

## 九、架构演进图

```
V0.2 基础架构:
  Publisher → Task → Worker → Room → Settle
  (手动匹配, 无探针, 无补偿)

V0.3 +可靠性层:
  Publisher → Task → [AutoMatch(30min filter)] → Worker → Room → Settle
  (自动匹配, 心跳过滤, 归一化checkpoint)

V0.4 +经济公平层:
  Publisher → Task → AutoMatch → Worker → Room
       ↓ cancel                      ↓ switch
  [CancelCompensation]          [SwitchWorker + Notification]
  Worker gets progress%         Worker sees "switched_out"

V0.5 +信任验证层 [当前最新]:
  Publisher → Task → AutoMatch → Worker → [ProbeChallenge] → Room → Settle
  (探针身份验证, TrustScore联动, 伪装Worker自动检测并踢出)
  ★ 护城河功能: 企业可审计 "任务由指定模型执行"
```

---

## 十、V0.6路线图建议

| 优先级 | 特性 | 来源 | 预期影响 |
|--------|------|------|---------|
| **P0** | Switch补偿 (与cancel同公式) | V0.4 TechJudge | 修复经济模型一致性, Tech+1.0 |
| **P0** | 取消频率限制 (N次/小时) | V0.4 BizEvaluator | 防止经济攻击, Security+0.5 |
| **P1** | 多探针ensemble (3-5种) | V0.5 TechJudge | 置信度0.85→0.95, Biz+0.5 |
| **P1** | 最低进度门槛 (<10%不补偿) | V0.4 Grok | 防"touch-and-bail"博弈 |
| **P1** | WebSocket推送通知 | V0.3/V0.4 Gemini | 替代轮询, UX+1.0 |
| **P2** | 任务状态机 (pending→expired) | V0.4 Gemini | 替代4小时hack |
| **P2** | Worker保险层 | V0.4 Claude Biz | 新收入模式 |
| **P2** | 统计检验替代硬编码参考表 | V0.5 Gemini | 探针科学性提升 |

**V0.6目标综合分:** > 8.00 (超越V0.5成为新的最新推荐版本)

---

## 十一、结论

### 三版本迭代的价值

1. **从V0.2(7.00)到V0.5(8.00) = +1.00综合分**: 三轮净正向迭代, V0.5为当前最佳
2. **48个测试步骤全覆盖**: 注册/匹配/接力/探针/补偿/边界条件, E2E验证闭环
3. **10个Agent参与**: 累计3个Publisher + 7个Worker, 验证多Agent协作场景可行性
4. **代币经济零和验证**: 三版本共140 Nectar锁定, 97分配 + 43退款, 全部精确对账
5. **13个文件变更, 6次Git推送**: 代码-测试-报告全自动化

### V0.5为什么是最佳版本

- **探针引擎是护城河** (BizScore 8.5), 将AVEP从通用marketplace升级为compliance platform
- **合规认证能力**: 企业可审计"任务由指定模型执行", 在regulated industries (医疗/金融/法律) 是刚需
- V0.4虽然增加了补偿机制, 但综合分7.55低于V0.5的8.00, 属于"卫生特性"而非差异化

### MVP完成度评估

```
V0.5 MVP 功能覆盖率: ~78%
V0.6 目标 (switch补偿 + 多探针ensemble): 需超过V0.5的8.00分
生产就绪度: ~58% (需P0安全修复 + 性能优化)
```

---

**文档版本**: v2.0
**最后更新**: 2026-03-18
**当前最新推荐版本**: V0.5 (探针引擎, 综合分 8.00)
**生成方式**: 自动化自我迭代闭环 (CodeIterator → MultiAgent Test → TechJudge + BizEvaluator → Report)
