import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "./config/index.js";
import { openDatabase, type Db } from "./db/index.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerProgressRoutes } from "./routes/progress.js";
import { registerUserRoutes } from "./routes/users.js";
import { AuthService } from "./services/auth.service.js";
import { ProgressService } from "./services/progress.service.js";
import {
  ERROR_CODES,
  KosyncError,
  acceptMissing,
  bodyNotObject,
  internalError,
  invalidAccept,
  invalidJson,
} from "./utils/errors.js";
import { isPlainObject } from "./utils/validation.js";

export interface BuildAppOptions {
  /** 覆盖环境变量配置，主要用于测试。 */
  config?: Partial<AppConfig>;
  /** 注入已有数据库连接，主要用于测试与嵌入。 */
  db?: Db;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig(options.config);
  const ownsDb = options.db === undefined;
  const db = options.db ?? openDatabase(config.dbPath);
  const startedAt = Date.now();
  const auth = new AuthService(db, config);
  const progress = new ProgressService(db, config, auth);

  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : { level: config.logLevel as "info" },
    bodyLimit: config.bodyLimitBytes,
    // 不输出认证头、请求体：默认请求日志只包含方法、URL、状态码与耗时。
  });

  // K-CT-2：官方服务端无条件对 body 做 JSON 解码，不检查请求 Content-Type。
  // 覆盖 Fastify 默认解析器，text/plain、缺省 Content-Type 也按 JSON 处理。
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_request, body, done) => {
    const text = typeof body === "string" ? body : String(body ?? "");
    if (text === "") {
      done(null, {});
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isPlainObject(parsed)) {
        done(bodyNotObject(), undefined);
        return;
      }
      done(null, parsed);
    } catch {
      done(invalidJson(), undefined);
    }
  });

  // 可选严格模式：模拟官方服务端对 Accept 头的版本选择行为（K-ACC-2）。
  // 默认关闭，因为放宽该检查不会破坏任何合规客户端（K-ACC-3）。
  if (config.strictAccept) {
    app.addHook("onRequest", async (request) => {
      const accept = request.headers.accept;
      if (!accept) throw acceptMissing();
      const match = /^application\/vnd\.koreader\.v(\d+)(.*)\+json$/.exec(accept);
      if (!match) throw invalidAccept();
      if (match[1] !== "1") {
        throw new KosyncError(
          412,
          ERROR_CODES.acceptUnsupportedVersion,
          "Unsupported version specified in the Accept header.",
        );
      }
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof KosyncError) {
      request.log.warn(
        { event: "kosync.error", status: error.status, code: error.code },
        error.message,
      );
      return reply
        .code(error.status)
        .header("content-type", "application/json; charset=utf-8")
        .send({ code: error.code, message: error.message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 413) {
      return reply
        .code(413)
        .header("content-type", "application/json; charset=utf-8")
        .send({ code: 1003, message: "Request body too large." });
    }
    request.log.error({ err: error }, "unhandled server error");
    const fallback = internalError();
    return reply
      .code(fallback.status)
      .header("content-type", "application/json; charset=utf-8")
      .send({ code: fallback.code, message: fallback.message });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .header("content-type", "application/json; charset=utf-8")
      .send({ code: 404, message: "Not found" }),
  );

  await app.register(async (instance) => {
    await registerHealthRoutes(instance, { db, startedAt });
    await registerUserRoutes(instance, { auth });
    await registerProgressRoutes(instance, { auth, progress });
  });

  if (ownsDb) {
    app.addHook("onClose", async () => {
      db.close();
    });
  }
  return app;
}
