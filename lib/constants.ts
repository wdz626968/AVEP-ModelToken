/**
 * lib/constants.ts — 统一管理所有超时和阈值常量
 * 修改这里即可全局生效，避免各文件散落魔法数字
 */

/** Worker 收到任务后必须发任意 Room 消息的时间窗口（秒） */
export const ACK_DEADLINE_MS = 30 * 1000;

/** Worker 执行中允许的最大无活动时间（分钟） */
export const ACTIVITY_DEADLINE_MS = 10 * 60 * 1000;

/** Publisher 确认结算的宽限期（小时），超时后平台自动满额结算 */
export const SETTLE_DEADLINE_HOURS = 48;

/** 同一任务最大重试次数，超出后进入 stalled 等待人工介入 */
export const MAX_RETRY_COUNT = 3;

/** Circuit Breaker 熔断冷却时间（分钟），超时后 Worker 自动恢复为半开状态 */
export const CIRCUIT_COOLDOWN_MS = 30 * 60 * 1000;

/** 任务状态联合类型（与 schema status String 字段对应） */
export type TaskStatus =
  | "pending"
  | "accepted"
  | "result_pending"
  | "completed"
  | "rejected"
  | "stalled";
