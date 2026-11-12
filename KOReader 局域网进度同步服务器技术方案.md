# KOReader 局域网阅读进度同步服务器技术方案

> 版本：V1.1  
> 技术栈：Node.js + TypeScript + SQLite  
> 部署方式：本机运行，局域网访问，无需云服务

## 1. 项目目标

开发一个本地 Node.js 服务，让 Kobo、Kindle、Android、macOS 等运行 KOReader 的设备，在同一局域网内同步同一本电子书的阅读进度。

- 同步数据只保存在运行服务的电脑上。
- 不同步电子书文件，仅同步阅读位置、百分比及必要元数据。
- 不依赖公网、云账号或第三方数据库服务。
- 服务器关闭时设备仍能正常离线阅读；恢复运行后可继续同步。
- 第一版优先兼容 KOReader 自带的 **Progress sync / KOSync** 插件，不开发额外 Lua 插件。

## 2. 核心技术决策

KOReader 已有原生进度同步客户端。最省事的方式不是重新开发客户端，而是使用 Node.js 实现兼容 KOSync 的服务端。

参考项目：

- KOReader：https://github.com/koreader/koreader
- KOReader Sync Server：https://github.com/koreader/koreader-sync-server
- 客户端插件：https://github.com/koreader/koreader/tree/master/plugins/kosync.koplugin

**实现前必须对照目标 KOReader 版本源码及官方服务端兼容测试确认协议**，包括路径、认证头、请求字段、响应字段、状态码和时间戳单位。本文示例仅用于说明结构，不能替代协议核验。

## 3. 部署要求

### 3.1 是否需要安装数据库？

**不需要安装独立数据库软件。** 本机只需安装受支持的 Node.js 版本，项目依赖可通过 npm 安装。SQLite 是嵌入式数据库，同步数据保存在项目目录中的 `data/koreader.db` 文件，程序首次运行时自动创建。

两种实现选择：

| 方案 | 优点 | 注意事项 |
|---|---|---|
| Fastify + better-sqlite3 | 开发成熟、API 简单、事务支持好 | 首次 `npm install` 安装依赖，原生模块需与 Node 版本匹配 |
| Node 内置 `node:http` + `node:sqlite` | 可做到零第三方运行时依赖 | 需要选择支持内置 SQLite 的 Node 版本并核对其稳定性；自行实现路由、校验等 |

**推荐第一版：Fastify + better-sqlite3。** 无需安装 MySQL、PostgreSQL、Redis、Docker，也无需单独启动 SQLite 服务。若更重视“只装 Node 即运行”，可在协议验证通过后切换为内置模块方案。

### 3.2 网络

- 服务端监听 `0.0.0.0:8787`。
- 阅读设备连接 `http://<服务器局域网IP>:8787`，例如 `http://192.168.1.100:8787`。
- 电脑和阅读设备须网络互通；防火墙允许入站端口 8787。
- 建议路由器为服务器分配固定 DHCP 地址。
- 电脑睡眠、关机或服务退出时无法同步，但本地阅读不受影响。
- 不开放公网端口；在不可信 Wi-Fi 上避免明文 HTTP。

## 4. 总体架构

```text
Kobo KOReader ──┐
Kindle KOReader ├── 局域网 HTTP/JSON ── Node.js KOSync 服务 ── SQLite 文件
Android KOReader┤                           │
macOS KOReader ─┘                           ├── 用户认证
                                           ├── 进度查询/上传
                                           ├── 历史记录
                                           └── 日志/健康检查
```

服务端职责：身份验证、协议兼容、按用户和书籍标识保存进度、返回最新进度、记录覆盖历史。服务端不解析 EPUB，不负责跨版本位置转换。

## 5. 第一版功能范围

| 功能 | 优先级 |
|---|---|
| KOReader 原生注册和认证 | P0 |
| 阅读进度上传 | P0 |
| 阅读进度查询 | P0 |
| 同一用户多设备共享进度 | P0 |
| 不同用户数据隔离 | P0 |
| SQLite 持久化 | P0 |
| 自动同步、手动同步 | P0，复用 KOReader 客户端 |
| 进度回退支持 | P0 |
| 离线后重试 | P0，依赖 KOReader 客户端行为并实测 |
| 历史记录和错误日志 | P1 |
| 网页管理后台 | P2 |
| 书签、笔记、阅读统计同步 | 暂不实现 |
| EPUB/PDF 跨格式进度映射 | 暂不实现 |

## 6. KOSync 协议兼容

应重点核验以下典型接口（以目标版本的实际协议为最终标准）：

| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/users/create` | 创建用户 |
| GET | `/users/auth` | 验证用户 |
| PUT | `/syncs/progress` | 上传进度 |
| GET | `/syncs/progress/:document` | 查询进度 |
| GET | `/health` | 自定义健康检查，不属于核心 KOSync 协议 |

示意上传体：

```json
{
  "document": "0b229176d4e8db7f6d2b5a4952368d7a",
  "progress": "/body/DocFragment[20]/body/p[22]",
  "percentage": 0.352,
  "device": "Kobo Clara BW",
  "device_id": "kobo-001"
}
```

字段说明：

- `document`：KOReader 生成的书籍标识。
- `progress`：阅读位置；EPUB 通常为 XPointer，其他格式可能是页码表示。作为不透明值存储。
- `percentage`：阅读比例，通常在 0～1 之间。
- `device`、`device_id`：设备信息。
- `timestamp`：服务端返回的时间信息，具体格式和单位须与原生协议一致。

身份验证方式必须兼容 KOReader 原生请求，不要求客户端额外发送自定义 Token、版本号或非协议字段。错误响应也应遵循官方约定。

### 6.1 书籍匹配

优先采用 KOReader 自带的二进制匹配方式。相同 EPUB 文件在不同设备上通常能得到一致的书籍标识；文件名匹配可能将不同版本误判为同一本书。

**同名不等于相同文档结构。** 不同 EPUB 版本的 XPointer 可能不兼容；EPUB 与 PDF 不保证可以互相恢复进度。

## 7. 数据库设计

SQLite 文件：`./data/koreader.db`。

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  document TEXT NOT NULL,
  progress TEXT NOT NULL,
  percentage REAL NOT NULL CHECK (percentage >= 0 AND percentage <= 1),
  device TEXT,
  device_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, document),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS progress_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  document TEXT NOT NULL,
  progress TEXT NOT NULL,
  percentage REAL NOT NULL,
  device_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_history_book
ON progress_history(user_id, document, created_at);
```

- 每个用户每本书仅保留一条当前进度。
- 更新前将旧记录写入历史表，并与更新操作放在同一个事务内。
- 开启 SQLite WAL 和适当的 busy timeout。
- 历史记录可限制每本书最近 100 条。
- 密码处理必须遵循原生协议；若客户端提交的是密码摘要，服务端仍需安全保存该认证凭据，不能把摘要当作安全的明文密码替代品。

## 8. 同步及冲突策略

### 8.1 基本流程

1. 设备 A 关闭书籍或触发同步。
2. KOReader 上传当前文档标识、阅读位置和百分比。
3. 服务端认证、校验并写入 SQLite，保存被覆盖的历史进度。
4. 设备 B 打开相同书籍并查询远端进度。
5. KOReader 根据其同步设置比较本地与远端状态，提示或自动跳转。
6. 设备 B 继续阅读后上传新位置。

### 8.2 冲突处理

第一版采用 **服务端最后成功写入优先 + 客户端恢复前提示 + 历史保留**。

不能简单保留最大百分比，因为用户可能主动返回较早章节重读。

例如 Kobo 上传 65%，Kindle 离线读到 80%，Kobo 随后上传 70%，最后 Kindle 恢复联网上传 80%，服务器最终记录 80%。

注意：原生协议不一定具备完整的版本前置条件，因此无法严格保证并发语义上的“最新阅读行为”。数据库内部的 `version` 字段只供服务端管理，不作为原生客户端必填字段。未来如需乐观锁，可通过自定义客户端扩展实现。

## 9. 项目结构

```text
koreader-sync-server/
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/index.ts
│   ├── routes/
│   │   ├── users.ts
│   │   ├── progress.ts
│   │   └── health.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   └── progress.service.ts
│   ├── repositories/
│   │   ├── user.repository.ts
│   │   └── progress.repository.ts
│   ├── db/
│   │   ├── index.ts
│   │   ├── schema.sql
│   │   └── migrations/
│   └── utils/errors.ts
├── tests/
│   ├── auth.test.ts
│   ├── progress.test.ts
│   └── compatibility.test.ts
├── data/                  # 自动创建，加入 .gitignore
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

## 10. 配置与启动

`.env.example`：

```dotenv
HOST=0.0.0.0
PORT=8787
DB_PATH=./data/koreader.db
LOG_LEVEL=info
ALLOW_REGISTER=true
MAX_HISTORY_PER_BOOK=100
```

开发阶段：

```bash
npm install
npm run dev
```

正式运行：

```bash
npm run build
npm start
```

首次运行时自动创建 `data` 目录及 SQLite 数据库文件。之后无需单独启动数据库服务。

如果交付的是已构建产物并且依赖已安装，日常只需 `npm start`；若希望在新电脑上只安装 Node 而完全不执行 `npm install`，应采用零第三方运行时依赖版本或打包分发方案。

## 11. KOReader 客户端配置

1. 在设备中打开 KOReader 的 **Progress sync / 阅读进度同步** 功能。
2. 将自定义同步服务器设置为 `http://192.168.1.100:8787`（替换成真实 IP）。
3. 注册同步账号，其他设备登录相同账号。
4. 启用自动同步；初期建议对远端进度恢复使用提示确认。
5. 优先使用二进制书籍匹配，并在设备之间放置完全相同的 EPUB 文件。
6. 使用一本测试书验证手动上传、下载和恢复位置。

具体菜单文字可能随 KOReader 版本和语言不同而变化。

## 12. 安全与可靠性

- 所有进度接口必须认证，并按用户隔离数据。
- 限制请求体大小、字段长度及非法参数。
- 不暴露数据库文件，不将 `data` 目录映射为静态资源。
- 默认只在可信局域网使用，不配置公网端口映射。
- 使用日志记录失败请求及同步事件，但避免输出密码和敏感认证头。
- 提供数据库文件备份方案，备份时采用 SQLite 安全备份方式或先停止服务。
- 若需要长期运行，考虑使用操作系统服务管理器，防止终端关闭后进程退出。

## 13. 开发阶段

### 阶段一：协议核验

- 阅读 KOReader KOSync 客户端源码。
- 阅读官方同步服务器源码及协议测试。
- 整理认证、路径、字段、响应、错误码兼容清单。
- 使用真实 KOReader 验证注册、认证、上传、下载。

### 阶段二：核心服务

- 实现 Fastify 服务及配置。
- 初始化 SQLite。
- 实现认证、上传和查询接口。
- 完成用户隔离及数据库事务。

### 阶段三：多设备测试

- Kobo 上传 → Kindle 下载。
- Kindle 上传 → Android 下载。
- 进度从 80% 回退到 60%。
- 断网阅读后恢复同步。
- 服务重启后继续同步。
- 多设备并发上传及历史记录校验。

### 阶段四：可选增强

- 网页管理后台。
- 设备与书籍同步历史查询。
- 备份和恢复工具。
- 托盘启动、开机自启。
- 自定义 KOReader 插件扩展书签、笔记同步。

## 14. MVP 验收标准

- [ ] 无需安装独立数据库服务。
- [ ] `npm start` 可启动已构建项目。
- [ ] 首次运行自动生成 SQLite 数据文件。
- [ ] KOReader 原生插件可以注册和登录。
- [ ] 两台设备能同步同一本 EPUB 的阅读位置。
- [ ] 允许从较大百分比回退到较小百分比。
- [ ] 不同账号互不干扰。
- [ ] 服务重启后进度不丢失。
- [ ] 服务不可用时不影响本地阅读。
- [ ] 恢复联网后能按 KOReader 客户端机制继续同步。
- [ ] 官方协议兼容测试通过，或已记录明确的兼容差异。

## 15. 给 Codex 的实现要求

请按照本文方案开发 **KOReader 局域网同步服务器 V1**。

**必须先分析 KOReader 原生 KOSync 协议及官方同步服务器，输出协议兼容清单，再开始编码。**

使用 Node.js、TypeScript、Fastify、SQLite，提供完整可运行项目、README、自动化测试和 KOReader 配置说明。

不得擅自增加原生 KOReader 客户端无法提供的必填参数；不得把自定义 REST 接口当成原生协议。优先实现注册、认证、进度上传、进度查询，之后完善历史记录、异常处理和日志。

第一版不开发新的 KOReader Lua 插件，不同步电子书文件，不做跨格式或跨 EPUB 版本的位置映射，不开发网页后台。

**最终目标：本机安装 Node.js，首次安装项目依赖后即可运行，数据全部保存在本机，无需安装或启动独立数据库服务。**
