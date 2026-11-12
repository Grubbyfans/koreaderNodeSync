# koreaderNodeSync

基于 Node.js 的**局域网 KOReader 阅读进度同步服务**。它实现 KOReader 原生 **Progress sync / KOSync** 插件所用的协议，因此**不需要安装任何自定义 Lua 插件**：在设备上把同步服务器地址指向本机即可。

- 数据只保存在本机 `data/koreader.db`（SQLite 嵌入式文件），不需要安装数据库、Docker 或云服务。
- **零原生模块**：数据库用 Node 内置 `node:sqlite`，切换 Node 版本不会遇到 `NODE_MODULE_VERSION` 不匹配。
- 不同步电子书文件，只同步阅读位置、百分比与设备信息。
- 服务器关闭时设备照常离线阅读，恢复后由 KOReader 客户端自动重试同步。
- 已通过第三方协议一致性验证器 51 项检查（0 MUST / 0 SHOULD 失败）。

> 协议核验结论、与技术方案的差异分析见 [`docs/KOSYNC-协议兼容清单.md`](docs/KOSYNC-协议兼容清单.md)。

## 环境要求

- **Node.js >= 22.5**（推荐 24 LTS）。低于该版本时启动会给出明确提示，而不是一段 dlopen 堆栈。
- 首次需要 `npm install`（只装 Fastify、dotenv 等纯 JS 依赖）；之后日常只需 `npm start`。

## 快速开始

```bash
npm install
cp .env.example .env        # 可选，不创建也能用默认配置启动
npm run build
npm start
```

启动后：zhou@zhoukangdeMacBook-Pro koreaderNodeSync % git status

位于分支 main

您的分支与上游分支 'origin/main' 一致。

尚未暂存以备提交的变更：

（使用 "git add <文件>..." 更新要提交的内容）

（使用 "git restore <文件>..." 丢弃工作区的改动）

修改：     README.md

未跟踪的文件:

（使用 "git add <文件>..." 以包含要提交的内容）

.env.example

.gitignore

.workbuddy/

docs/

package-lock.json

package.json

scripts/

src/

tests/

tools/

tsconfig.json

修改尚未加入提交（使用 "git add" 和/或 "git commit -a"）

zhou@zhoukangdeMacBook-Pro koreaderNodeSync % git add *

致命错误：无法创建 '/Users/zhou/workcode/studyCode/koreaderNodeSync/.git/index.lock'：File exists。

另一 git 进程似乎正在此仓库中运行，或者锁文件可能已过期

zhou@zhoukangdeMacBook-Pro koreaderNodeSync % 

```bash
curl http://127.0.0.1:8787/healthcheck
# {"state":"OK"}
```

首次运行自动创建 `data/` 目录与 `data/koreader.db`。开发模式用 `npm run dev`（源码热重载）。

## 配置项（`.env`）

| 变量                     | 默认值                  | 说明                                                |
| ---------------------- | -------------------- | ------------------------------------------------- |
| `HOST`                 | `0.0.0.0`            | 监听地址，局域网访问需保持 `0.0.0.0`                           |
| `PORT`                 | `8787`               | 监听端口                                              |
| `DB_PATH`              | `./data/koreader.db` | SQLite 数据文件                                       |
| `LOG_LEVEL`            | `info`               | `trace/debug/info/warn/error/silent`；日志不记录认证头与请求体 |
| `ALLOW_REGISTER`       | `true`               | 关闭后 `POST /users/create` 返回协议规定的 402/2005         |
| `MAX_HISTORY_PER_BOOK` | `100`                | 每本书保留的历史进度条数                                      |
| `STRICT_ACCEPT`        | `false`              | 设为 `true` 时强制要求原生 `Accept` 头（模拟官方服务端 412）         |
| `BODY_LIMIT_BYTES`     | `1048576`            | 请求体上限                                             |

## KOReader 客户端配置

1. 查到本机局域网 IP（macOS：`ipconfig getifaddr en0`），假设为 `192.168.1.100`。
2. 在 KOReader 中打开 **Progress sync / 阅读进度同步** 插件。
3. 将「自定义同步服务器地址」设为 **`http://192.168.1.100:8787`**（不要加路径、不要加尾部斜杠）。
4. 在一台设备上注册账号，其他设备登录同一账号（密码由客户端做 MD5 后传输）。
5. 启用自动同步；初期建议把「远端进度恢复」设为提示确认。
6. 书籍匹配使用默认的**二进制匹配**（不要改成文件名匹配），各设备放**完全相同的 EPUB 文件**。
7. 用一本测试书验证：设备 A 翻页 → 推送进度 → 设备 B 拉取进度并跳转。

不同 KOReader 版本的菜单文字略有差异。电脑休眠、关机或服务退出时无法同步，但不影响设备本地阅读。

## HTTP API（原生协议）

所有认证请求都带 `x-auth-user`、`x-auth-key`（= 小写十六进制 MD5(密码)）；客户端另带 `Accept: application/vnd.koreader.v1+json`。

| 方法     | 路径                          | 说明                                  |
| ------ | --------------------------- | ----------------------------------- |
| POST   | `/users/create`             | 注册，`{"username","password"}`，成功 201 |
| GET    | `/users/auth`               | 验证账号，成功 `{"authorized":"OK"}`       |
| PUT    | `/syncs/progress`           | 上传进度，返回 `{"document","timestamp"}`  |
| GET    | `/syncs/progress/:document` | 查询进度；未读过的书返回 `200 {}`               |
| GET    | `/healthcheck`              | 官方健康检查 `{"state":"OK"}`             |
| GET    | `/health`                   | 本项目附加检查（数据库状态、运行时长）                 |
| DELETE | `/users/me`                 | 可选：删除账号及其全部进度                       |
| PUT    | `/users/password`           | 可选：更换凭据                             |

上传体示例：

```json
{
  "document": "0b229176d4e8db7f6d2b5a4952368d7a",
  "progress": "/body/DocFragment[20]/body/p[22]",
  "percentage": 0.352,
  "device": "Kobo Clara BW",
  "device_id": "kobo-001"
}
```

用 curl 手动验证（macOS 生成 MD5：`md5 -q -s "你的密码"`）：

```bash
KEY=$(md5 -q -s "your-password")
curl -X PUT http://127.0.0.1:8787/syncs/progress \
  -H "Accept: application/vnd.koreader.v1+json" \
  -H "x-auth-user: alice" -H "x-auth-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"document":"testdoc","progress":"12","percentage":0.25,"device":"curl"}'
```

## 测试与协议验收

```bash
npm test                 # 25 个单元/集成测试（内存或临时 SQLite）
npm run build
npm run verify:protocol  # 启动 127.0.0.1:8797 + 独立临时数据库，跑真实 HTTP 协议一致性验证
```

`verify:protocol` 使用内置的 [kosync-conformance](https://github.com/pid1/kosync-conformance) 验证器（`tools/kosync-conformance/`，BSD-3-Clause），会向**临时测试账号**写入若干合成进度，不会触碰 `data/koreader.db` 的真实数据。

已实测：Node **22.22.2** 与 **24.14.1** 两个版本下均为 `25/25` 单测通过、`51 passed / 0 failed / RESULT: conformant`，且在 Node 24 下用 `npm start` 完成注册 → 上传 → 查询的端到端冒烟。

## 数据与备份

- 数据库：Node 内置 `node:sqlite`，纯 JS 依赖，不需要编译任何原生插件。
- 当前进度：`reading_progress`（每个用户每本书一条，`version` 递增）。
- 覆盖历史：`progress_history`（与更新在同一 SAVEPOINT 事务写入，按 `MAX_HISTORY_PER_BOOK` 裁剪）。
- 账号：`users`，仅保存凭据的 scrypt 加盐哈希，不保存明文密码或 MD5 摘要。
- 优先 WAL；在不支持删除 journal 文件的文件系统上自动回退 `TRUNCATE`（事务原子性不变）。

备份（SQLite 在线备份，服务可继续运行）：

```bash
sqlite3 data/koreader.db ".backup 'data/koreader-backup.db'"
```

没有 `sqlite3` 命令时，先停止服务再复制 `koreader.db`（以及可能存在的 `-wal` / `-shm` 文件）。

## 安全说明

- 认证凭据是**无盐 MD5**，且每个请求都以明文 HTTP 头传输 —— 官方协议要求 TLS，本项目按技术方案限定在**可信局域网**使用。不要在不可信 Wi-Fi 使用，不要做公网端口映射；如需跨网络请加 HTTPS 反向代理。
- 所有进度接口强制认证并按 `user_id` 隔离；限制请求体大小与字段长度；`data/` 不映射为静态资源。
- 日志只记录方法、路径、状态码、耗时与同步事件，不输出 `x-auth-key` 或请求体。

## 常见问题

- **切换 Node 版本后报错 `NODE_MODULE_VERSION ...`？** 本项目已移除 `better-sqlite3`，不再有原生模块。若你还在用旧构建产物，执行 `npm install && npm run build` 即可。
- **`npm warn Unknown user config "python"`？** 这是本机 `~/.npmrc` 里有一行 `python=...`（npm 11 已废弃该配置项），与本项目无关；删除该行即可消除警告。
- **看到 `ExperimentalWarning: SQLite is an experimental feature`？** `node:sqlite` 在 Node 22/24 仍标记为实验性；`npm start` 已加 `--disable-warning=ExperimentalWarning`，手动 `node dist/server.js` 时会显示这一行，不影响功能。

## 目录结构

```text
src/
  app.ts / server.ts           Fastify 装配、错误处理、启动
  config/index.ts              环境变量配置
  routes/                      users / progress / health
  services/                    认证、进度写入（事务内二次认证）
  repositories/                SQLite 读写
  db/                          node:sqlite 适配器、schema.sql
  utils/                       协议错误码、凭据哈希、字段校验
tests/                         25 个测试
tools/kosync-conformance/      内置协议一致性验证器
docs/                          协议兼容清单、规范离线副本
scripts/                       构建辅助、协议验证脚本
```

## 已知限制

- 不同步书签、笔记、阅读统计，不做 EPUB/PDF 跨格式或跨 EPUB 版本的位置映射（同名文件不等于相同文档结构）。
- 冲突处理为「服务端最后写入优先 + 客户端提示 + 历史保留」，服务端不比较百分比；`version` 仅供内部管理。
- 未提供网页管理后台；`data/` 中的历史记录可直接用 SQLite 工具查询。
- 未在真实 Kobo / Kindle / Android 设备上做人工多设备验收，建议按技术方案第 13 节阶段三补测。
