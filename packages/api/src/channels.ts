import type { FastifyInstance } from "fastify";
import {
  ChannelNotFoundError,
  YouTubeApiError,
  type IngestionQueue,
  type Ledger,
  type YouTubeClient,
} from "@youtube-index/domain";

export interface ChannelRoutesDeps {
  ledger: Ledger;
  queue: IngestionQueue;
  youtube: YouTubeClient;
}

export function registerChannelRoutes(app: FastifyInstance, deps: ChannelRoutesDeps): void {
  app.post<{ Body: { handle?: string } }>("/channels", async (request, reply) => {
    const handle = request.body?.handle;
    if (!handle || typeof handle !== "string") {
      return reply.code(400).send({ error: "handle é obrigatório" });
    }

    let resolution;
    try {
      resolution = await deps.youtube.resolveHandle(handle);
    } catch (err) {
      if (err instanceof ChannelNotFoundError) {
        request.log.warn({ handle }, "handle não resolvido na YouTube API");
        return reply.code(404).send({ error: `Canal não encontrado para handle '${handle}'` });
      }
      if (err instanceof YouTubeApiError) {
        request.log.error({ handle, err }, "falha ao consultar a YouTube API");
        return reply.code(502).send({ error: "Falha ao consultar a YouTube API" });
      }
      throw err;
    }

    const channel = deps.ledger.createChannel({
      channelId: resolution.channelId,
      handle,
      title: resolution.title,
    });
    const job = deps.queue.enqueue(channel.id);
    request.log.info(
      { handle, channelId: channel.id, jobId: job.id, title: channel.title },
      "canal criado e job de ingestão enfileirado",
    );

    return reply.code(201).send(channel);
  });

  app.get<{ Params: { id: string } }>("/channels/:id", async (request, reply) => {
    const channel = deps.ledger.getChannel(request.params.id);
    if (!channel) {
      return reply.code(404).send({ error: "Canal não encontrado" });
    }
    return reply.send(channel);
  });
}