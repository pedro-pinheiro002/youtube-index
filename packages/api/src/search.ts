import type { FastifyInstance } from "fastify";
import { PHASES } from "@youtube-index/domain";
import type { Ledger, PhaseMeta, SearchDocumentType, SearchPort, SearchSort } from "@youtube-index/domain";

export interface SearchRoutesDeps {
  ledger: Ledger;
  search: SearchPort;
}

const SORTS: readonly SearchSort[] = ["relevance", "publishedAt"];

export function registerSearchRoutes(
  app: FastifyInstance,
  deps: SearchRoutesDeps,
  phases: readonly PhaseMeta[] = PHASES,
): void {
  const TIPOS: readonly SearchDocumentType[] = phases.map((p) => p.doc);

  app.get<{ Querystring: { q?: string; channelId?: string; tipo?: string; sort?: string } }>(
    "/search",
    async (request, reply) => {
      const { q, channelId, tipo, sort } = request.query;

      if (!q || q.trim() === "") {
        return reply.code(400).send({ error: "q é obrigatório" });
      }
      if (!channelId) {
        return reply.code(400).send({ error: "channelId é obrigatório" });
      }
      if (tipo !== undefined && !TIPOS.includes(tipo as SearchDocumentType)) {
        return reply.code(400).send({ error: `tipo inválido: ${tipo}` });
      }
      if (sort !== undefined && !SORTS.includes(sort as SearchSort)) {
        return reply.code(400).send({ error: `sort inválido: ${sort}` });
      }

      if (!deps.ledger.getChannel(channelId)) {
        return reply.code(404).send({ error: "Canal não encontrado" });
      }

      const result = await deps.search.search({
        q,
        channelId,
        tipo: tipo as SearchDocumentType | undefined,
        sort: sort as SearchSort | undefined,
      });
      return reply.send(result);
    },
  );
}
