import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ACCEPT,
  authHeaders,
  createTestApp,
  progressPayload,
  registerUser,
} from "./helpers.js";

const DOC = "conformance_doc_0000000000000001";

/** 逐条固化协议兼容清单中的关键行为，避免后续重构悄悄破坏原生客户端。 */
describe("KOSync 协议兼容", () => {
  test("健康检查：官方 /healthcheck 与本项目 /health", async () => {
    const { app } = await createTestApp();
    const official = await app.inject({ method: "GET", url: "/healthcheck" });
    assert.equal(official.statusCode, 200);
    assert.deepEqual(official.json(), { state: "OK" });
    assert.match(official.headers["content-type"] as string, /application\/json/);

    const custom = await app.inject({ method: "GET", url: "/health" });
    assert.equal(custom.statusCode, 200);
    assert.equal(custom.json().state, "OK");
    await app.close();
  });

  test("Accept 头：默认宽松（缺失也服务），携带原生 vendor 头正常", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const withVendor = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: authHeaders("alice", "pw"),
    });
    assert.equal(withVendor.statusCode, 200);
    const without = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: { "x-auth-user": "alice", "x-auth-key": authHeaders("alice", "pw")["x-auth-key"] },
    });
    assert.equal(without.statusCode, 200);
    await app.close();
  });

  test("严格 Accept 模式：缺失 412/100，格式错误 412/101", async () => {
    const { app } = await createTestApp({ strictAccept: true });
    const missing = await app.inject({ method: "GET", url: "/healthcheck" });
    assert.equal(missing.statusCode, 412);
    assert.deepEqual(missing.json(), { code: 100, message: "Accept header not set." });
    const wrong = await app.inject({
      method: "GET",
      url: "/healthcheck",
      headers: { accept: "*/*" },
    });
    assert.equal(wrong.statusCode, 412);
    assert.deepEqual(wrong.json(), { code: 101, message: "Invalid Accept header format." });
    const right = await app.inject({
      method: "GET",
      url: "/healthcheck",
      headers: { accept: ACCEPT },
    });
    assert.equal(right.statusCode, 200);
    await app.close();
  });

  test("不检查请求 Content-Type，body 必须是 JSON 对象", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const textPlain = await app.inject({
      method: "PUT",
      url: "/syncs/progress",
      headers: { ...authHeaders("alice", "pw"), "content-type": "text/plain" },
      payload: JSON.stringify(progressPayload(DOC)),
    });
    assert.equal(textPlain.statusCode, 200);

    const array = await app.inject({
      method: "PUT",
      url: "/syncs/progress",
      headers: authHeaders("alice", "pw"),
      payload: "[1,2,3]",
    });
    assert.equal(array.statusCode, 400);
    assert.deepEqual(array.json(), { code: 104, message: "Body should be a JSON hash." });

    const broken = await app.inject({
      method: "PUT",
      url: "/syncs/progress",
      headers: authHeaders("alice", "pw"),
      payload: "{not-json",
    });
    assert.equal(broken.statusCode, 400);
    assert.deepEqual(broken.json(), { code: 103, message: "Could not parse JSON in body." });
    await app.close();
  });

  test("错误体恰为 {code,message}，未定义路径返回 404；永不返回 202", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const error = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: authHeaders("alice", "wrong"),
    });
    assert.deepEqual(Object.keys(error.json()).sort(), ["code", "message"]);

    const unknown = await app.inject({ method: "GET", url: "/not-a-kosync-route" });
    assert.equal(unknown.statusCode, 404);
    assert.match(unknown.headers["content-type"] as string, /application\/json/);

    const uploaded = await app.inject({
      method: "PUT",
      url: "/syncs/progress",
      headers: authHeaders("alice", "pw"),
      payload: progressPayload(DOC),
    });
    assert.equal(uploaded.statusCode, 200);
    await app.close();
  });

  test("GET 响应必须带 timestamp（秒）与 JSON 媒体类型", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    await app.inject({
      method: "PUT",
      url: "/syncs/progress",
      headers: authHeaders("alice", "pw"),
      payload: progressPayload(DOC),
    });
    const response = await app.inject({
      method: "GET",
      url: `/syncs/progress/${DOC}`,
      headers: authHeaders("alice", "pw"),
    });
    assert.match(response.headers["content-type"] as string, /application\/json/);
    const body = response.json();
    assert.equal(typeof body.timestamp, "number");
    assert.ok(Math.abs(body.timestamp - Date.now() / 1000) < 86400);
    assert.equal(body.progress, "/body/DocFragment[20]/body/p[22]/text().123");
    await app.close();
  });

  test("PUT 允许连字符/点号 document 且 GET 可读回（不产生只写黑洞）", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    for (const id of ["doc-with-hyphen", "doc.with.dot"]) {
      const uploaded = await app.inject({
        method: "PUT",
        url: "/syncs/progress",
        headers: authHeaders("alice", "pw"),
        payload: progressPayload(id),
      });
      assert.equal(uploaded.statusCode, 200);
      const read = await app.inject({
        method: "GET",
        url: `/syncs/progress/${id}`,
        headers: authHeaders("alice", "pw"),
      });
      assert.equal(read.statusCode, 200);
      assert.equal(read.json().percentage, 0.352);
    }
    await app.close();
  });
});
