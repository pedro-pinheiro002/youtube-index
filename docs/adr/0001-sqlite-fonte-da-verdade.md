# SQLite é a fonte da verdade; Meilisearch é apenas a projeção de busca

O SQLite guarda o conteúdo completo (vídeos, comentários, segmentos de transcrição) e o Meilisearch é uma projeção de busca reconstruível a partir dele a qualquer momento, sem re-consumir cota da YouTube Data API. Escolhido para permitir reindexar (mudanças de ranking/settings) de graça e manter o índice descartável.