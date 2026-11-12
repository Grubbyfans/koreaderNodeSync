# 内置协议一致性验证器

- `verify.mjs`：来自 [pid1/kosync-conformance](https://github.com/pid1/kosync-conformance)（BSD-3-Clause，见 `LICENSE`），零依赖、Node 18+ 可直接运行。它从真实 HTTP 端口逐条断言 KOSync 协议要求。
- `../../docs/kosync-conformance-SPEC.md`：同仓库的 `SPEC.md`（CC0-1.0），逐条引用 KOReader 客户端与官方服务端源码，作为本项目的协议依据离线留存。

> 该仓库并非 KOReader 官方项目，但对官方实现的行为做了逐条考证；已内置于本项目以便离线复现协议验收。

运行方式（项目根目录）：

```bash
npm run build
npm run verify:protocol
```

`verify:protocol` 会用一个独立的临时 SQLite 文件启动 `127.0.0.1:8797`，注册两个测试账号，再调用验证器。验证器会向测试账号写入若干合成文档 id 的进度，不会触碰 `data/koreader.db` 中的真实数据。
