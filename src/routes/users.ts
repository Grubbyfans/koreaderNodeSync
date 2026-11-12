import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../services/auth.service.js";
import { headerValue, requireObjectBody } from "../utils/validation.js";

interface Deps {
  auth: AuthService;
}

export async function registerUserRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { auth } = deps;

  // 注册：成功 201 {"username":...}；重名 402/2002；字段非法 403/2003；
  // 关闭注册 402/2005。客户端只把非 201 当作失败并展示 body.message。
  app.post("/users/create", async (request: FastifyRequest, reply: FastifyReply) => {
    const username = auth.register(requireObjectBody(request.body));
    request.log.info({ event: "user.register", username }, "account created");
    return reply.code(201).send({ username });
  });

  // 认证：200 {"authorized":"OK"} / 401 code 2001。
  app.get("/users/auth", async (request: FastifyRequest) => {
    auth.authenticate(request.headers);
    return { authorized: "OK" };
  });

  // 以下两个是官方服务端的可选端点，KOReader 原生插件不会调用，
  // 实现它们便于用 curl / 协议验证器管理账号。
  app.delete("/users/me", async (request: FastifyRequest) => {
    const user = auth.authenticate(request.headers);
    auth.deleteAccount(user, headerValue(request.headers, "x-auth-key"));
    request.log.info({ event: "user.delete", username: user.username }, "account deleted");
    return { deleted: true };
  });

  app.put("/users/password", async (request: FastifyRequest) => {
    const user = auth.authenticate(request.headers);
    const body = requireObjectBody(request.body);
    auth.changePassword(user, headerValue(request.headers, "x-auth-key"), body.password);
    request.log.info({ event: "user.password", username: user.username }, "credential updated");
    return { updated: true };
  });
}
