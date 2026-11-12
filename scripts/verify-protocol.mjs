#!/usr/bin/env node
/**
 * 启动一个隔离的临时服务实例，并用内置的 kosync-conformance 验证器
 * 对真实 HTTP 端口做协议兼容测试。运行前需先执行 npm run build。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const md5 = (text) => createHash("md5").update(text).digest("hex");

if (!existsSync("dist/server.js")) {
  console.error("未找到 dist/server.js，请先运行 npm run build");
  process.exit(1);
}

const port = Number(process.env.VERIFY_PORT ?? 8797);
const base = `http://127.0.0.1:${port}`;
const user = "kosync_verify";
const password = "verify-password";
const secondUser = "kosync_verify_2";
const secondPassword = "second-password";

mkdirSync("data", { recursive: true });
const dbPath = `./data/conformance-${Date.now()}.db`;
const serverEnv = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(port),
  DB_PATH: dbPath,
  LOG_LEVEL: "silent",
  ALLOW_REGISTER: "true",
  STRICT_ACCEPT: "false",
  MAX_HISTORY_PER_BOOK: "100",
};

const server = spawn(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", "dist/server.js"],
  {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

async function waitUntilReady() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthcheck`);
      if (response.ok) return true;
    } catch {
      // 服务尚未监听，继续等待。
    }
    await delay(200);
  }
  return false;
}

async function registerSecondAccount() {
  const response = await fetch(`${base}/users/create`, {
    method: "POST",
    headers: {
      accept: "application/vnd.koreader.v1+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ username: secondUser, password: md5(secondPassword) }),
  });
  if (response.status !== 201) {
    throw new Error(`第二个测试账号注册失败：HTTP ${response.status} ${await response.text()}`);
  }
}

async function main() {
  if (!(await waitUntilReady())) {
    throw new Error("服务未能在 10 秒内启动");
  }
  await registerSecondAccount();

  const verifier = spawn(
    process.execPath,
    [
      "tools/kosync-conformance/verify.mjs",
      "--base-url", base,
      "--user", user,
      "--password", password,
      "--register",
      "--second-user", secondUser,
      "--second-password", secondPassword,
      "--document", "kosyncconformance",
    ],
    { stdio: "inherit" },
  );

  const exitCode = await new Promise((resolve) => verifier.on("exit", resolve));
  process.exitCode = exitCode ?? 1;
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
}
