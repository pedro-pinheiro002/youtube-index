Status: superseded by ADR-0005

# SQLite é a fonte da verdade; Meilisearch é apenas a projeção de busca

O SQLite guardava o conteúdo completo (vídeos, comentários, segmentos de transcrição) e o Meilisearch era uma projeção de busca reconstruível a partir dele a qualquer momento, sem re-consumir cota da YouTube Data API. Escolhido para permitir reindexar (mudanças de ranking/settings) de graça e manter o índice descartável.

Esta decisão foi superada pela ADR-0005: fonte da verdade e busca vivem no mesmo Postgres, e não há mais projeção separada.
