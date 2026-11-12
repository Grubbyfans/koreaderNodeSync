import type { FastifyInstance } from "fastify";
import type { Db } from "../db/index.js";

interface Deps {
  db: Db;
  startedAt: number;
}

export async function registerHealthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  // 官方 KOSync 服务端健康检查路径（方案中的 /health 是自定义叫法）。
  app.get("/healthcheck", async () => ({ state: "OK" }));

  // 本项目附加的健康检查，便于观察数据库与运行时状态。
  app.get("/health", async () => {
    let database = "ok";
    try {
      deps.db.prepare("SELECT 1").get();
    } catch {
      database = "error";
    }
    return {
      state: database === "ok" ? "OK" : "DEGRADED",
      database,
      uptimeSeconds: Math.floor((Date.now() - deps.startedAt) / 1000),
    };
  });
}
