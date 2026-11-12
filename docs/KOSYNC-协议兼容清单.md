# KOSync 协议兼容清单（实现依据与技术方案差异分析）

> 核验日期：2026-11-12
> 依据：技术方案《KOReader 局域网进度同步服务器技术方案》V1.1 第 15 节「必须先分析 KOReader 原生 KOSync 协议及官方同步服务器，输出协议兼容清单，再开始编码」
> 结论：本项目按原生 KOSync 协议实现服务端，**不开发新的 KOReader Lua 插件**；原生「Progress sync / 阅读进度同步」插件可直接使用。

## 1. 核验来源

| 来源 | 作用 |
|---|---|
| [KOReader `plugins/kosync.koplugin/api.json`](https://github.com/koreader/koreader/blob/master/plugins/kosync.koplugin/api.json) | 客户端声明的路径、参数、期望状态码 |
| [KOReader `KOSyncClient.lua`](https://github.com/koreader/koreader/blob/master/plugins/kosync.koplugin/KOSyncClient.lua) | 认证头、Accept 头、成功判定条件 |
| [KOReader `main.lua`](https://github.com/koreader/koreader/blob/master/plugins/kosync.koplugin/main.lua) | 密码 MD5、进度/百分比/响应 timestamp 的实际用法 |
| [官方 `koreader-sync-server` `syncs_controller.lua` / `config/routes.lua`](https://github.com/koreader/koreader-sync-server) | 服务端权威行为、错误码表、timestamp 生成 |
| [kosync-conformance `SPEC.md` + `verify.mjs`](https://github.com/pid1/kosync-conformance) | 逐条考证的协议规范与可执行一致性验证器（已内置于 `tools/`，规范文本见 `docs/kosync-conformance-SPEC.md`） |

## 2. 端点与状态码

| 方法 | 路径 | 认证 | 成功 | 关键响应 |
|---|---|---|---|---|
| POST | `/users/create` | 否 | **201** | `{"username":"..."}` |
| GET | `/users/auth` | 是 | **200** | `{"authorized":"OK"}` |
| PUT | `/syncs/progress` | 是 | **200** | `{"document":"...","timestamp":1790006348}`（**仅两个字段**） |
| GET | `/syncs/progress/:document` | 是 | **200** | `document / percentage / progress / device / device_id(可选) / timestamp` |
| GET | `/healthcheck` | 否 | 200 | `{"state":"OK"}`（官方路径） |
| GET | `/health` | 否 | 200 | 本项目附加检查 |
| DELETE | `/users/me` | 是 | 200 | `{"deleted":true}`，官方可选端点 |
| PUT | `/users/password` | 是 | 200 | `{"updated":true}`，官方可选端点 |

- **永不返回 202**：客户端只把 200 当成功，202 会被判定失败并进入重试队列。
- **未知文档必须返回 `200 {}`**，不能是 404。客户端靠 `body.percentage` 是否缺席判断「没读过这本书」，404 会被渲染成同步错误。
- 未定义的路径/方法返回 404，不做路由。

## 3. 认证

- 请求头：`x-auth-user: <用户名>`、`x-auth-key: <凭据>`。
- `x-auth-key` = 客户端对明文密码做 **小写十六进制 MD5**（`main.lua:568/606`）。明文密码不出设备。
- 注册体里的 `password` 字段**就是该 MD5 值**，不是明文。服务端若再哈希一次，注册的账号永远无法登录。
- 服务端必须把 `x-auth-key` 当作**不透明、大小写敏感**的字符串，不强制 32 位十六进制。用户名不能为空、不能含冒号。
- 本实现：注册时对收到的凭据再做一次带随机盐的 `scrypt` 慢哈希后存入 SQLite（`src/utils/crypto.ts`），验证时用 `timingSafeEqual`。线上协议不变，同时避免数据库泄露后凭据被直接冒用（对应方案 7 节的安全要求）。
- 缺失/未知用户/错误密钥一律 **401 + code 2001**，避免账号枚举，也让客户端停止重试。

## 4. 字段语义

| 字段 | 规则 |
|---|---|
| `document` | 不透明书籍 id（通常是 32 位 MD5），非空、不含冒号；PUT 与 GET 的合法字符集必须一致 |
| `progress` | **字符串**，EPUB 为 XPointer、PDF 为页码字符串；必须逐字节原样回传，不能转成数字 |
| `percentage` | JSON 数字，通常 0～1；`0` 是合法值；官方不做范围检查 |
| `device` | 必填设备名；`device_id` 可选，未发送时 GET 不返回该字段 |
| `metadata` | 可选对象（默认不发送）；服务端必须接受且不能因后续 PUT 省略而清除旧数据；本项目留存但不进入协议响应 |
| `timestamp` | **服务端生成、Unix 秒（整数）**；PUT 与 GET 都要返回，客户端用它和本地 `os.time()` 比较决定同步方向。毫秒会让所有远端进度永远显得更新 |

PUT 必填 `document / progress / percentage / device`，`device_id / metadata` 可选。写入为**最后写入优先**，不做大小比较（方案 8.2 的进度回退要求因此天然满足）。

## 5. 错误模型

错误体固定 `{"code": <整数>, "message": "..."}`，`code` 与 HTTP 状态不同：

| code | HTTP | message | 场景 |
|---|---|---|---|
| 1000 / 2000 | 502 | Cannot connect to redis server. / Unknown server error. | 内部错误 |
| **2001** | **401** | Unauthorized | 认证失败（客户端据此放弃重试） |
| 2002 | 402 | Username is already registered. | 重名 |
| 2003 | 403 | Invalid request | 注册字段非法、PUT 缺字段 |
| 2004 | 403 | Field 'document' not provided. | document 非法/缺失 |
| 2005 | 402 | User registration is disabled. | 关闭注册（**402 不是 403**） |
| 2006 | 404 | Account not found. | 删除不存在的账号 |
| 100 / 101 / 102 | 412 | Accept header… | 严格 Accept 模式（可选） |
| 103 / 104 | 400 | Could not parse JSON… / Body should be a JSON hash. | body 非 JSON / 非对象 |

**任何非 401 的失败都会被 KOReader 排队重试最长四周**，因此永久性的凭据错误必须是 401。

## 6. 与技术方案的差异与修正

| 技术方案条目 | 核验结果 | 本项目处理 |
|---|---|---|
| 6 节表格 `GET /health`「自定义健康检查」 | 官方路径是 `GET /healthcheck`，响应 `{"state":"OK"}` | 两个都实现，`/health` 附加数据库/运行时间信息 |
| 6 节 `timestamp`「具体格式和单位须与原生协议一致」 | 服务端生成的 **Unix 秒**，GET 必须返回；PUT 也必须带 | 已按秒实现，并列为强制兼容测试 |
| 6 节上传示意体 | 客户端还会发送可选 `metadata`；不发送 `timestamp` | 接受 `metadata`，忽略客户端 `timestamp` |
| 未提及未知文档的响应 | 必须 `200 {}` | 已实现并固化测试 |
| 未提及注册失败状态码 | 重名/关闭注册均为 **402**，靠 code 2002/2005 区分 | 已实现 |
| 7 节 `CHECK(percentage 0..1)` | 官方不检查范围 | 保留约束，但入库前把有限数值夹到 `[0,1]`，避免数据库异常导致 5xx 与客户端长期重试 |
| 7 节「密码处理必须遵循原生协议」 | 客户端提交的是 MD5 摘要，不能当明文、也不能明文存库 | 用 scrypt 加盐哈希存储，验证用常量时间比较 |
| 3.2/6 节未提 `Accept` 头 | 客户端每个请求都带 `Accept: application/vnd.koreader.v1+json`，官方服务端强制要求 | 默认宽松（不破坏任何客户端）；`STRICT_ACCEPT=true` 可复现官方 412 行为 |
| 未提请求 `Content-Type` | 官方不检查，按 JSON 无条件解码 | 覆盖默认解析器，任何/缺省 Content-Type 都按 JSON 解析 |
| 5 节 P0「离线后重试」 | 由 KOReader 客户端队列实现；服务端只需保证错误码正确 | 不额外开发客户端逻辑 |
| 15 节「第一版不开发 Lua 插件」 | 与核验结论一致 | 遵循，未新增 Lua 代码 |
| 3.1 节推荐「Fastify + better-sqlite3」 | 本机同时装有 Node 14/16/18/20/22/24，原生模块按 `NODE_MODULE_VERSION` 编译，切换 Node 版本即报 `ERR_DLOPEN_FAILED`（127 vs 137） | 协议验证通过后，按 3.1 节预留的备选路线改用 **Node 内置 `node:sqlite`**，零原生依赖；要求 Node >= 22.5，切换版本无需重建 |

### 已知合规差异（明确记录）

- **`[K-URL-2]` TLS**：规范要求 TLS，技术方案要求「局域网明文 HTTP、不开放公网」。本项目按方案默认明文监听 `0.0.0.0:8787`，一致性验证器把该项记为 `INFO`（不是 MUST 失败）。**仅建议在可信局域网使用**；如需跨网络，应在前面加 HTTPS 反向代理。
- **SQLite WAL**：优先启用 WAL；在禁止删除 journal 文件的受限文件系统上自动回退 `TRUNCATE`（事务原子性不变）。`node:sqlite` 无内置事务包装，本实现用 SAVEPOINT/RELEASE 实现可嵌套事务（认证与写入仍在同一事务）。
- **可选端点**：`DELETE /users/me`、`PUT /users/password` 为实现完整兼容而提供，KOReader 原生插件不会调用，不属于「自定义 REST 接口」。

## 7. 验收结果（2026-11-12，Node v22.22.2 与 v24.14.1 双版本实测）

| 项目 | 结果 |
|---|---|
| `npm run build` | 两个版本均通过 |
| `npm test`（25 个用例：注册/认证/隔离/回退/历史/持久化/协议行为） | **25 passed, 0 failed**（两个版本） |
| `npm run verify:protocol`（kosync-conformance 对真实 HTTP 端口） | **51 passed, 0 failed（0 MUST、0 SHOULD），RESULT: conformant**（两个版本） |
| `npm start` 端到端冒烟（Node 24） | 服务启动 → 注册 201 → 上传 200 → 查询 200，响应字段与协议一致 |
| 未覆盖项 | 需在真实 Kobo/Kindle/Android 设备上做人工多设备验收（方案第 13 阶段三）；本环境无设备 |
