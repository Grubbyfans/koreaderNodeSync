import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { buildApp } from "../src/app.js";
import { openDatabase } from "../src/db/index.js";
import {
  ACCEPT,
  authHeaders,
  createTestApp,
  progressPayload,
  registerUser,
} from "./helpers.js";

const DOC = "0b229176d4e8db7f6d2b5a4952368d7a";

async function put(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  username: string,
  password: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "PUT",
    url: "/syncs/progress",
    headers: authHeaders(username, password),
    payload,
  });
}

async function get(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  username: string,
  password: string,
  document = DOC,
) {
  return app.inject({
    method: "GET",
    url: `/syncs/progress/${document}`,
    headers: authHeaders(username, password),
  });
}

describe("进度上传与查询", () => {
  test("PUT 返回且仅返回 document 与秒级 timestamp", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const before = Math.floor(Date.now() / 1000);
    const res = await put(app, "alice", "pw", progressPayload(DOC));
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body).sort(), ["document", "timestamp"]);
    assert.equal(body.document, DOC);
    assert.ok(Math.abs(body.timestamp - before) <= 2, "timestamp 必须是 Unix 秒");
    await app.close();
  });

  test("GET 完整回传字段，progress 作为字符串逐字节保留", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const xpointer = "/body/DocFragment[20]/body/p[22]/img.0";
    const uploaded = await put(
      app,
      "alice",
      "pw",
      progressPayload(DOC, { progress: xpointer, percentage: 0.31879884821061 }),
    );
    const res = await get(app, "alice", "pw");
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.document, DOC);
    assert.equal(body.progress, xpointer);
    assert.equal(body.percentage, 0.31879884821061);
    assert.equal(body.device, "Kobo Clara BW");
    assert.equal(body.device_id, "kobo-001");
    assert.equal(body.timestamp, uploaded.json().timestamp);
    await app.close();
  });

  test("未知文档返回 200 {}，而不是 404", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const res = await get(app, "alice", "pw", "never_seen_before");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {});
    await app.close();
  });

  test("允许进度回退：最后写入优先，不保留最大百分比", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    await put(app, "alice", "pw", progressPayload(DOC, { progress: "200", percentage: 0.9 }));
    await put(app, "alice", "pw", progressPayload(DOC, { progress: "10", percentage: 0.1 }));
    const body = (await get(app, "alice", "pw")).json();
    assert.equal(body.progress, "10");
    assert.equal(body.percentage, 0.1);
    await app.close();
  });

  test("percentage 为 0 是合法值，不能当成缺字段", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const uploaded = await put(app, "alice", "pw", progressPayload(DOC, { percentage: 0 }));
    assert.equal(uploaded.statusCode, 200);
    assert.equal((await get(app, "alice", "pw")).json().percentage, 0);
    await app.close();
  });

  test("device_id 省略时不出现在响应；再次省略时保留旧值", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const payload = progressPayload("fresh_doc", { device_id: undefined });
    await put(app, "alice", "pw", payload);
    const first = (await get(app, "alice", "pw", "fresh_doc")).json();
    assert.equal("device_id" in first, false);

    await put(app, "alice", "pw", progressPayload(DOC, { device_id: "kobo-001" }));
    await put(app, "alice", "pw", progressPayload(DOC, { device_id: undefined, percentage: 0.4 }));
    const second = (await get(app, "alice", "pw")).json();
    assert.equal(second.device_id, "kobo-001");
    assert.equal(second.percentage, 0.4);
    await app.close();
  });

  test("metadata 可选：接收但不进入协议响应，后续省略不清空位置", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const withMeta = await put(
      app,
      "alice",
      "pw",
      progressPayload(DOC, {
        metadata: { filename: "leaves.epub", title: "Leaves of Grass", authors: "Walt Whitman" },
      }),
    );
    assert.equal(withMeta.statusCode, 200);
    assert.equal("metadata" in (await get(app, "alice", "pw")).json(), false);
    await put(app, "alice", "pw", progressPayload(DOC, { percentage: 0.7 }));
    const body = (await get(app, "alice", "pw")).json();
    assert.equal(body.percentage, 0.7);
    assert.equal("metadata" in body, false);
    await app.close();
  });

  test("不同用户数据隔离，且未认证请求一律 401", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    await registerUser(app, "bob", "pw");
    await put(app, "alice", "pw", progressPayload(DOC));
    assert.deepEqual((await get(app, "bob", "pw")).json(), {});

    const noAuth = await app.inject({
      method: "PUT",
      url: "/syncs/progress",
      headers: { accept: ACCEPT },
      payload: progressPayload(DOC),
    });
    assert.equal(noAuth.statusCode, 401);
    assert.deepEqual(noAuth.json(), { code: 2001, message: "Unauthorized" });
    const noAuthGet = await app.inject({
      method: "GET",
      url: `/syncs/progress/${DOC}`,
      headers: { accept: ACCEPT },
    });
    assert.equal(noAuthGet.statusCode, 401);
    await app.close();
  });

  test("缺字段与非法 document 使用协议规定的 403 错误码", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    for (const [payload, code] of [
      [{ document: "", progress: "1", percentage: 0.1, device: "d" }, 2004],
      [{ document: "bad:doc", progress: "1", percentage: 0.1, device: "d" }, 2004],
      [{ progress: "1", percentage: 0.1, device: "d" }, 2004],
      [{ document: DOC, percentage: 0.1, device: "d" }, 2003],
      [{ document: DOC, progress: "1", device: "d" }, 2003],
      [{ document: DOC, progress: "1", percentage: "nope", device: "d" }, 2003],
      [{ document: DOC, progress: "1", percentage: 0.1 }, 2003],
    ] as const) {
      const res = await put(app, "alice", "pw", payload);
      assert.equal(res.statusCode, 403, JSON.stringify(payload));
      assert.equal(res.json().code, code);
    }
    await app.close();
  });

  test("覆盖前写入历史，版本递增，并按配置裁剪", async () => {
    const { app, db } = await createTestApp({ maxHistoryPerBook: 2 });
    await registerUser(app, "alice", "pw");
    for (const percentage of [0.1, 0.2, 0.3, 0.4]) {
      await put(app, "alice", "pw", progressPayload(DOC, { percentage }));
    }
    const rows = db
      .prepare("SELECT percentage, version FROM reading_progress WHERE document = ?")
      .all(DOC) as { percentage: number; version: number }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].percentage, 0.4);
    assert.equal(rows[0].version, 4);
    const history = db
      .prepare("SELECT percentage FROM progress_history WHERE document = ? ORDER BY created_at, id")
      .all(DOC) as { percentage: number }[];
    assert.deepEqual(history.map((row) => row.percentage), [0.2, 0.3]);
    await app.close();
  });

  test("服务重启后进度不丢失（SQLite 持久化）", async () => {
    // 使用系统临时目录，不做删除清理（临时文件由操作系统回收）。
    const dir = mkdtempSync(join(tmpdir(), "kosync-test-"));
    const dbPath = join(dir, "koreader.db");

    const first = openDatabase(dbPath);
    const app1 = await buildApp({
      db: first,
      config: { logLevel: "silent", allowRegister: true },
    });
    await app1.ready();
    await registerUser(app1, "alice", "pw");
    await put(app1, "alice", "pw", progressPayload(DOC, { percentage: 0.8125 }));
    await app1.close();
    first.close();

    const second = openDatabase(dbPath);
    const app2 = await buildApp({
      db: second,
      config: { logLevel: "silent", allowRegister: true },
    });
    await app2.ready();
    const body = (await get(app2, "alice", "pw")).json();
    assert.equal(body.percentage, 0.8125);
    await app2.close();
    second.close();
  });
});
