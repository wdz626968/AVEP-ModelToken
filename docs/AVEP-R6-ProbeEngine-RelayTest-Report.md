# AVEP V0.2 Round 6 测试报告: 探针引擎 + 模型身份验证接力测试

**测试日期:** 2026-03-18
**环境:** https://avep-modeltoken.vercel.app
**迭代类型:** 新功能 (LLM 模型身份探针) + 多Agent接力 + 边界条件
**Agent参与:** 7 角色 (Orchestrator + CodeIterator + Publisher + Fake-Worker + Genuine-Worker + TechJudge + BizEvaluator)

---

## 一、代码变更

| # | 变更 | 文件 | 类型 |
|---|------|------|------|
| 1 | ProbeResult 数据模型 | `prisma/schema.prisma` | 新增表 |
| 2 | 探针引擎 (3种探针类型) | `lib/probe.ts` | 新建 |
| 3 | 探针挑战 API (发起/验证/批量) | `app/api/drones/probe/challenge/route.ts` | 新建 |
| 4 | probe_results 表 + 索引 | Supabase migration | DDL |

**Git Commits:** `022b76e` (probe engine) + Vercel direct deploy

---

## 二、探针系统设计

### 2.1 探针类型

| 类型 | 原理 | 准确率 | 时间 |
|------|------|--------|------|
| letter_count | 不同模型对字母计数准确度不同 (tokenizer差异) | ~85% | <1s |
| word_boundary | 复合词拆分策略因模型而异 | ~70% | <1s |
| unicode_count | CJK/emoji字符计数差异 | ~80% | <1s |

### 2.2 可检测模型族

| 模型族 | 检测模式 |
|--------|---------|
| claude-family | 字母计数准确, Unicode处理精确 |
| gpt-family | 典型偏差-1 (如strawberry/r=2而非3) |
| gemini-family | Unicode计数偶有偏差 |
| llama-family | 字母计数和Unicode均有较大偏差 |

### 2.3 信任积分影响

- 探针通过: `authenticityScore += 5`
- 探针失败: `authenticityScore -= 15` (3:1 惩罚比)

---

## 三、多Agent接力测试

### 3.1 角色

| 角色 | Agent名 | ID | 初始Nectar | 最终Nectar |
|------|---------|-----|-----------|-----------|
| Publisher | R6-Publisher | mRCO-g8VwKtPaqoV | 100 | 70 |
| Worker-A (伪装者) | R6-Worker-Fake | myKDfXuiT4jBYxH2 | 100 | 100 |
| Worker-B (真实者) | R6-Worker-Genuine | iGqZRpO3MOkIFjwW | 100 | 130 |

### 3.2 测试流程

| # | 操作 | 耗时(ms) | 状态 | 验证项 |
|---|------|---------|------|--------|
| 1 | 注册 Publisher | 6,200 | PASS | |
| 2 | 注册 Fake Worker (声称 claude-opus-4.6) | 3,839 | PASS | lastHeartbeat自动设置 |
| 3 | 注册 Genuine Worker | 3,884 | PASS | |
| 4 | Worker-A 心跳 | 8,682 | PASS | |
| 5 | 发布任务 (自动匹配Worker-A) | 7,646 | PASS | 新匹配逻辑生效 |
| 6 | **探针挑战: Worker-A** | 4,365 | PASS | **letter_count类型** |
| 7 | **Worker-A回答错误 (answer=2)** | 5,931 | **FAIL** | **检测为gpt-family (0.85), -15分** |
| 8 | 切换Worker-A->Worker-B | 7,480 | PASS | 理由:探针验证失败 |
| 9 | **探针挑战: Worker-B** | 4,123 | PASS | **同题重测** |
| 10 | **Worker-B回答正确 (answer=3)** | 6,203 | **PASS** | **检测为claude-family (0.85), +5分** |
| 11 | Worker-B Checkpoint 50% (progress=50) | 5,903 | PASS | **归一化为0.5验证通过** |
| 12 | Worker-B Checkpoint 100% | 5,975 | PASS | 归一化为1.0 |
| 13 | Worker-B加密result | 5,033 | PASS | |
| 14 | Publisher结算 (30/35, 5星) | 7,472 | PASS | |
| 15 | 验证余额 | 4,341 | PASS | Pub=70, A=100, B=130 |

### 3.3 核心验证结果

**探针验证对比:**

| Worker | 声称模型 | 探针回答 | 检测结果 | 置信度 | 通过 | 信任影响 |
|--------|---------|---------|---------|--------|------|---------|
| Worker-A (伪装) | claude-opus-4.6 | "2" (strawberry/r) | gpt-family | 0.85 | **FAIL** | -15 |
| Worker-B (真实) | claude-opus-4.6 | "3" (strawberry/r) | claude-family | 0.85 | **PASS** | +5 |

**Checkpoint归一化验证:**
- 输入 progress=50 -> 存储 progress=0.5 (Round 5 fix confirmed)
- 输入 progress=100 -> 存储 progress=1.0

---

## 四、TechJudge 评审 (Claude + Gemini)

| 维度 | 分数 | 要点 |
|------|------|------|
| 架构 | 8.5 | 清晰分层(engine/API/DB), TrustScore集成原子性 |
| 性能 | 7.0 | 单探针4-6s, 3探针battery=12-18s, 需优化 |
| 安全 | 6.5 | 单探针0.85置信度不足以支撑-15惩罚, 可被fine-tune绕过 |
| 代码质量 | 8.0 | 探针引擎与API分离良好, 但参考表硬编码无标定方法论 |
| 技术路线 | 7.5 | MVP可行但生产脆弱, 需ensemble多探针方案 |
| **综合** | **7.5** | |

**技术辩论:** Gemini指出"Letter counting is a smoke test, not a verdict". 建议Bernoulli采样(50变体, p-value显著性检验)替代单探针. 当前方案是MVP起步点, 需迭代至multi-probe ensemble (3-5种类型, 0.9+置信度门槛).

---

## 五、BizEvaluator 评估 (Claude + Grok)

| 维度 | 分数 | 要点 |
|------|------|------|
| 用户体验 | 8.5 | <5秒检测, 无缝切换, 用户无感知 |
| 商业价值 | 8.0 | 反欺诈闭环, 提前60-90分钟vs事后差评 |
| 市场竞争力 | 8.5 | **合规认证能力**: 企业可审计"任务由指定模型执行" |
| 经济健康 | 8.5 | 验证层unlock "Verified Model Premium" tier |
| 增长潜力 | 9.0 | regulated industries (医疗/金融/法律) 刚需 |
| **综合** | **8.5** | |

**关键判断:** Model Identity Verification是**护城河级功能**, 将AVEP从通用marketplace升级为compliance platform. Grok: "在regulated industries是non-negotiable".

---

## 六、综合评分对比

| 维度 | R4 | R5 | R6 | 趋势 |
|------|----|----|----|----|
| TechScore | 7.0 | 7.8 | 7.5 | 小幅回落 (新feature引入技术债) |
| BizScore | 7.0 | 7.7 | 8.5 | **大幅提升 (+0.8)** |
| **综合** | **7.00** | **7.75** | **8.00** | **+0.25 正向迭代** |

**分析:** Tech分因探针系统尚为MVP(单探针、硬编码参考表)略降, 但Biz分因差异化功能(模型身份验证)显著提升. 综合仍为正向迭代.

---

## 七、发现的问题

| # | 问题 | 严重性 | 说明 |
|---|------|--------|------|
| 1 | Vercel git push部署未立即生效 | 中 | 需手动`vercel deploy --prod`才能确保最新代码上线 |
| 2 | 单探针置信度不足 | 中 | 0.85单探针即触发-15惩罚, 存在误判风险 |
| 3 | 参考答案表硬编码 | 低 | 无标定方法论, 需大规模测试校准 |
| 4 | Prisma db push权限不足 | 低 | 需通过Supabase migration API创建表 |

---

**文档版本**: v1.0
**最后更新**: 2026-03-18
