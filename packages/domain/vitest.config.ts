import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Os testes que dependem de Postgres compartilham o mesmo
    // DATABASE_URL. Rodar arquivos em paralelo leva a corridas no
    // `applyPgSchema` (cada arquivo faz bootstrap das tabelas/índices)
    // e na coluna `fts` quando o `rebuild-fts.test.ts` derruba e
    // recria a expressão gerada. Sequencial é mais lento mas é a
    // única configuração honesta para testes de integração que
    // compartilham banco.
    fileParallelism: false,
  },
});
