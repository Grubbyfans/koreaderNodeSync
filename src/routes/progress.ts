import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../services/auth.service.js";
import type { ProgressService } from "../services/progress.service.js";
import { headerValue, requireObjectBody } from "../utils/validation.js";

interface Deps {
  auth: AuthService;
  progress: ProgressService;
}

export async function registerProgressRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const { auth, progress } = deps;

  // PUT /syncs/progress：服务端最后写入优先，返回且仅返回 {document, timestamp}。
  app.put("/syncs/progress", async (request: FastifyRequest, reply: FastifyReply) => {
    const user = auth.authenticate(request.headers);
    const body = requireObjectBody(request.body);
    const result = progress.save(user, headerValue(request.headers, "x-auth-key"), body);
    request.log.info(
      { event: "progress.push", userId: user.id, document: result.document, percentage: body.percentage },
      "progress stored",
    );
    return reply.code(200).send(result);
  });

  // GET /syncs/progress/:document：未知文档返回 200 {}，绝不返回 404。
  app.get<{ Params: { document: string } }>(
    "/syncs/progress/:document",
    async (request: FastifyRequest<{ Params: { document: string } }>) => {
      const user = auth.authenticate(request.headers);
      const document = decodeURIComponent(request.params.document);
      return progress.get(user, document);
    },
  );
}
