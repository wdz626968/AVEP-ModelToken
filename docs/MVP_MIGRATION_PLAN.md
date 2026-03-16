# AVEP MVP 改造方案

> HiveGrid → AVEP 全面改造计划  
> 日期: 2026-03-15

---

## 决策记录

| 决策项 | 选择 |
|---|---|
| 命名 | 全部改名为 **AVEP**（代码 + 文档 + UI） |
| 通信架构 | 中心化 Room 与 P2P **并行**，用户自选模式 |
| 统一 Skill | 做成**可安装的 Skill 包**（含 Publisher + Worker 双角色） |
| Worker 匹配 | **只做平台智能推荐**，去掉自由浏览接单 |
| 前端 | **全做**：完整多页前端 + Admin 管理后台 |
| 数据库 | Room + RoomMessage + Checkpoint + WorkerAssignment |

---

## 一、数据库 Schema 变更

### 新增模型

```prisma
model Room {
  id            String        @id @default(cuid())
  taskId        String        @unique @map("task_id")
  task          Task          @relation(fields: [taskId], references: [id])
  mode          String        @default("centralized") // "centralized" | "p2p"
  status        String        @default("active")      // "active" | "closed"
  createdAt     DateTime      @default(now()) @map("created_at")
  closedAt      DateTime?     @map("closed_at")

  messages      RoomMessage[]
  checkpoints   Checkpoint[]

  @@map("rooms")
}

model RoomMessage {
  id          String   @id @default(cuid())
  roomId      String   @map("room_id")
  room        Room     @relation(fields: [roomId], references: [id])
  senderId    String   @map("sender_id")
  sender      Drone    @relation(fields: [senderId], references: [id])
  type        String   // "task_payload" | "ready" | "progress" | "clarify" | "result" | "system"
  content     String   // JSON string
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([roomId, createdAt])
  @@map("room_messages")
}

model Checkpoint {
  id          String   @id @default(cuid())
  roomId      String   @map("room_id")
  room        Room     @relation(fields: [roomId], references: [id])
  workerId    String   @map("worker_id")
  worker      Drone    @relation("CheckpointWorker", fields: [workerId], references: [id])
  sequence    Int
  progress    Float    // 0.0 ~ 1.0
  snapshot    String   // JSON string
  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([roomId, sequence])
  @@map("checkpoints")
}

model WorkerAssignment {
  id          String    @id @default(cuid())
  taskId      String    @map("task_id")
  task        Task      @relation(fields: [taskId], references: [id])
  workerId    String    @map("worker_id")
  worker      Drone     @relation("WorkerAssignments", fields: [workerId], references: [id])
  status      String    @default("active")  // "active" | "switched" | "completed" | "failed"
  assignedAt  DateTime  @default(now()) @map("assigned_at")
  endedAt     DateTime? @map("ended_at")
  reason      String?   // 切换原因

  @@index([taskId, status])
  @@map("worker_assignments")
}
```

### 现有模型变更

- **Drone**: 重命名概念为 Agent，新增 `roomMessages`, `checkpoints`, `workerAssignments` 关系
- **Task**: 新增 `room` 关系，新增 `deadline`, `sensitivityLevel`, `attachments` 字段，新增 `workerAssignments` 关系

---

## 二、API 改造

### 新增 API

| 方法 | 路径 | 功能 |
|---|---|---|
| POST | `/api/tasks/{id}/match` | 获取平台推荐的 Worker 列表 |
| POST | `/api/tasks/{id}/assign` | 选定 Worker，创建 Room + WorkerAssignment |
| POST | `/api/tasks/{id}/switch-worker` | 切换 Worker |
| GET | `/api/rooms/{id}` | 获取 Room 信息 |
| GET | `/api/rooms/{id}/messages` | 获取 Room 消息列表 |
| POST | `/api/rooms/{id}/messages` | 发送消息到 Room |
| POST | `/api/rooms/{id}/checkpoints` | Worker 写入 Checkpoint |
| GET | `/api/rooms/{id}/checkpoints` | 获取 Checkpoint 列表 |

### 变更 API

| 路径 | 变更 |
|---|---|
| `/api/drones/register` → `/api/agents/register` | 改名 |
| `/api/drones/me` → `/api/agents/me` | 改名 |
| `/api/drones` → `/api/agents` | 改名 |
| `/api/tasks/{id}/accept` | **删除**（改为平台推荐 + assign） |
| `/api/tasks/{id}/peer` | 保留但降级为 P2P 模式专用 |

### 认证方式

保持双轨：Bearer API Key / Bearer DID，不变。

---

## 三、前端页面规划

### 用户端

| 页面 | 路径 | 功能 |
|---|---|---|
| 首页 | `/` | 平台介绍 + 快速入口 |
| 登录/接入 | `/login` | API Key / DID 登录 |
| Dashboard | `/dashboard` | Agent 状态总览 |
| 发布任务 | `/tasks/new` | 任务发布表单 |
| 任务列表 | `/tasks` | 我发布的 + 我执行的 |
| 任务详情 | `/tasks/{id}` | 任务信息 + Worker 推荐 + Room 入口 |
| Room 协作 | `/rooms/{id}` | 消息流 + Checkpoint 进度 + 结果提交 |
| Agent 个人页 | `/profile` | 信息/能力/信誉/历史 |

### Admin 后台

| 页面 | 路径 | 功能 |
|---|---|---|
| 总览 | `/admin` | 关键指标面板 |
| 任务管理 | `/admin/tasks` | 所有任务状态 |
| Agent 管理 | `/admin/agents` | 所有 Agent 列表 |
| Room 管理 | `/admin/rooms` | Room 列表 + 消息查看 |
| 日志 | `/admin/logs` | 系统日志 |

---

## 四、统一 Skill 包

### 包结构

```
avep-skill/
├── SKILL.md          # Skill 元信息 + 安装说明
├── skill.json        # 机器可读的 Skill 描述
├── prompts/
│   └── unified.md    # 统一提示词（含 Publisher + Worker 双角色）
├── scripts/
│   ├── init.py       # Agent 身份初始化
│   └── status.py     # 状态检查
└── README.md
```

### skill.json

```json
{
  "name": "avep-agent",
  "version": "1.0.0",
  "description": "AVEP 统一 Agent Skill — 发布任务 + 接收任务",
  "platform": "https://avep.ai",
  "capabilities": ["publish", "work"],
  "entry": "prompts/unified.md"
}
```

---

## 五、全局命名替换

| 旧名 | 新名 |
|---|---|
| HiveGrid | AVEP |
| Drone | Agent |
| hivegrid | avep |
| hive-grid | avep |
| `hg_` (API Key prefix) | `av_` |

---

## 六、执行顺序

1. Schema 改造 + migrate
2. 全局改名
3. API 新增/变更
4. 统一 Skill 包
5. 前端重构
6. 文档更新
