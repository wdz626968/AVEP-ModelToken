/**
 * ANP push utilities — 通过 awiki send_message.py 向指定 DID 推送消息。
 *
 * AVEP 平台作为一个 Agent，用自己的 awiki DID 向 Worker/Publisher 的 DID 发消息。
 * Worker/Publisher 本地运行 awiki ws_listener，收到消息后触发 Agent 执行任务。
 *
 * 环境变量：
 *   AWIKI_SKILL_DIR   — awiki skill 路径（默认 ~/.openclaw/skills/awiki-agent-id-message）
 *   AWIKI_SENDER_CRED — awiki 凭证名称（默认 "default"）
 */

import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execFileAsync = promisify(execFile);

const AWIKI_SKILL_DIR =
  process.env.AWIKI_SKILL_DIR ||
  path.join(os.homedir(), ".openclaw/skills/awiki-agent-id-message");

const AWIKI_SENDER_CRED = process.env.AWIKI_SENDER_CRED || "default";

export type AnpMessageType =
  | "avep_task_assigned"      // 撮合引擎 → Worker: 有新任务
  | "avep_worker_assigned"    // 撮合引擎 → Publisher: Worker 已分配（pending 变 accepted）
  | "avep_result_ready"       // Worker → Publisher: 任务结果已提交，请确认结算
  | "avep_settled"            // Publisher → Worker: 已结算（可选通知）
  | "avep_switch_worker";     // Publisher → Worker: 你被替换了

export interface AnpPayload {
  type: AnpMessageType;
  taskId: string;
  roomId?: string;
  [key: string]: unknown;
}

/**
 * 向指定 DID 发送 ANP 消息。
 * 失败时只记录日志，不抛出异常（推送失败不应中断主流程）。
 */
export async function sendAnpMessage(
  toDid: string,
  payload: AnpPayload
): Promise<boolean> {
  if (!toDid) {
    console.warn("[ANP] sendAnpMessage: toDid is empty, skipping");
    return false;
  }

  const content = JSON.stringify(payload);
  const scriptPath = path.join(AWIKI_SKILL_DIR, "scripts/send_message.py");

  try {
    const { stdout, stderr } = await execFileAsync(
      "python3",
      [
        scriptPath,
        "--to", toDid,
        "--content", content,
        "--type", "text",
        "--credential", AWIKI_SENDER_CRED,
      ],
      {
        timeout: 10000, // 10s timeout
        cwd: AWIKI_SKILL_DIR,
      }
    );

    if (stderr && !stderr.includes("INFO")) {
      console.warn(`[ANP] send to ${toDid.slice(0, 40)} warning: ${stderr.slice(0, 200)}`);
    }

    // 检查是否成功投递（server_seq 表示服务端已收到）
    const success = stdout.includes("server_seq");
    if (success) {
      console.log(`[ANP] ✓ sent ${payload.type} → ${toDid.slice(0, 40)}...`);
    } else {
      console.warn(`[ANP] send ${payload.type} → ${toDid.slice(0, 40)} may have failed: ${stdout.slice(0, 200)}`);
    }
    return success;
  } catch (err) {
    console.error(`[ANP] failed to send ${payload.type} → ${toDid.slice(0, 40)}: ${err}`);
    return false;
  }
}

/**
 * 批量发送（忽略失败的那条，不影响其他）
 */
export async function sendAnpMessages(
  messages: Array<{ toDid: string; payload: AnpPayload }>
): Promise<void> {
  await Promise.allSettled(
    messages.map(({ toDid, payload }) => sendAnpMessage(toDid, payload))
  );
}
