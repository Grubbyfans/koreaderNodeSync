import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { md5 } from "../src/utils/crypto.js";
import { ACCEPT, authHeaders, createTestApp, registerUser } from "./helpers.js";

describe("注册与认证协议", () => {
  test("注册返回 201 与 username，随后可用同一 MD5 凭据认证", async () => {
    const { app } = await createTestApp();
    const created = await registerUser(app, "alice", "hunter2");
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json(), { username: "alice" });

    const auth = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: authHeaders("alice", "hunter2"),
    });
    assert.equal(auth.statusCode, 200);
    assert.deepEqual(auth.json(), { authorized: "OK" });
    await app.close();
  });

  test("注册送出的 password 就是 x-auth-key，服务端不得再次哈希", async () => {
    const { app } = await createTestApp();
    const key = md5("hunter2");
    await app.inject({
      method: "POST",
      url: "/users/create",
      headers: { accept: ACCEPT },
      payload: { username: "alice", password: key },
    });
    const ok = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: { "x-auth-user": "alice", "x-auth-key": key, accept: ACCEPT },
    });
    assert.equal(ok.statusCode, 200);
    // 客户端若把 key 当作明文再哈希一次，应当认证失败。
    const wrong = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: { "x-auth-user": "alice", "x-auth-key": md5(key), accept: ACCEPT },
    });
    assert.equal(wrong.statusCode, 401);
    await app.close();
  });

  test("x-auth-key 是不透明凭据：不强制 32 位十六进制，但大小写敏感", async () => {
    const { app } = await createTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/users/create",
      headers: { accept: ACCEPT },
      payload: { username: "bob", password: "opaque-key" },
    });
    assert.equal(created.statusCode, 201);
    const ok = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: { "x-auth-user": "bob", "x-auth-key": "opaque-key", accept: ACCEPT },
    });
    assert.equal(ok.statusCode, 200);
    const wrongCase = await app.inject({
      method: "GET",
      url: "/users/auth",
      headers: { "x-auth-user": "bob", "x-auth-key": "OPAQUE-KEY", accept: ACCEPT },
    });
    assert.equal(wrongCase.statusCode, 401);
    await app.close();
  });

  test("重复用户名 402/2002，非法字段 403/2003", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const duplicate = await registerUser(app, "alice", "pw");
    assert.equal(duplicate.statusCode, 402);
    assert.deepEqual(duplicate.json(), {
      code: 2002,
      message: "Username is already registered.",
    });

    for (const payload of [
      { username: "", password: md5("pw") },
      { username: "bad:name", password: md5("pw") },
      { username: "carol", password: "" },
      { username: "carol" },
    ]) {
      const res = await app.inject({
        method: "POST",
        url: "/users/create",
        headers: { accept: ACCEPT },
        payload,
      });
      assert.equal(res.statusCode, 403, JSON.stringify(payload));
      assert.deepEqual(res.json(), { code: 2003, message: "Invalid request" });
    }
    await app.close();
  });

  test("关闭注册时返回 402/2005（不是 403）", async () => {
    const { app } = await createTestApp({ allowRegister: false });
    const res = await registerUser(app, "alice", "pw");
    assert.equal(res.statusCode, 402);
    assert.deepEqual(res.json(), {
      code: 2005,
      message: "User registration is disabled.",
    });
    await app.close();
  });

  test("认证失败一律 401/2001，且不泄露账号是否存在", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    for (const headers of [
      {},
      { "x-auth-user": "alice" },
      authHeaders("alice", "wrong"),
      authHeaders("nobody", "pw"),
      { "x-auth-user": "alice", "x-auth-key": "" },
      { "x-auth-user": "bad:name", "x-auth-key": md5("pw") },
    ]) {
      const res = await app.inject({ method: "GET", url: "/users/auth", headers });
      assert.equal(res.statusCode, 401, JSON.stringify(headers));
      assert.deepEqual(res.json(), { code: 2001, message: "Unauthorized" });
    }
    await app.close();
  });

  test("可选端点：修改凭据后旧凭据失效、进度保留；删除账号后可重新注册", async () => {
    const { app } = await createTestApp();
    await registerUser(app, "alice", "pw");
    const newKey = md5("new-password");
    const changed = await app.inject({
      method: "PUT",
      url: "/users/password",
      headers: authHeaders("alice", "pw"),
      payload: { password: newKey },
    });
    assert.equal(changed.statusCode, 200);
    assert.deepEqual(changed.json(), { updated: true });
    assert.equal(
      (await app.inject({ method: "GET", url: "/users/auth", headers: authHeaders("alice", "pw") }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: "/users/auth",
          headers: { "x-auth-user": "alice", "x-auth-key": newKey, accept: ACCEPT },
        })
      ).statusCode,
      200,
    );
    const deleted = await app.inject({
      method: "DELETE",
      url: "/users/me",
      headers: { "x-auth-user": "alice", "x-auth-key": newKey, accept: ACCEPT },
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.json(), { deleted: true });
    assert.equal((await registerUser(app, "alice", "pw")).statusCode, 201);
    await app.close();
  });
});
