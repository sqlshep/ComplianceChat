import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { answerConversation, type AppConfig, type AwsClients } from "@compliancechat/shared";

const Body = z.object({
  question: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .max(40)
    .optional(),
  k: z.number().int().min(1).max(12).optional(),
});

export async function registerChatRoutes(
  app: FastifyInstance,
  clients: AwsClients,
  cfg: AppConfig,
): Promise<void> {
  app.post("/api/chat", async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const res = await answerConversation(clients, cfg, {
      question: parsed.data.question,
      history: parsed.data.history,
      conversationId: parsed.data.conversationId,
      k: parsed.data.k,
    });
    reply.send(res);
  });
}
