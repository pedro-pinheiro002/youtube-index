# Contexto

Aplicativo de busca local (fullstack TypeScript) que indexa o conteúdo de um Canal do YouTube — títulos, descrições, Comentários e Transcrições — em um Índice Meilisearch, permitindo busca por palavra-chave com destaque e links para momentos exatos dos vídeos.

## Linguagem

**Canal**:
Um canal do YouTube indexado pela aplicação, identificado pelo `channelId`.
_Avoid_: índice, produto, conta

**Vídeo**:
Um vídeo publicado por um Canal.

**Comentário**:
Um comentário de um Vídeo. A aplicação mantém apenas os 50 mais relevantes por Vídeo.

**Transcrição**:
O texto falado de um Vídeo (legenda automática ou manual), segmentado por timestamps.

**Ingestão**:
O processo de buscar dados do YouTube e de Transcrição e gravá-los no Índice.
_Avoid_: download, scraping

**Sincronização**:
A atualização incremental do Índice após a carga inicial — vídeos novos e Comentários de Vídeos recentes.

**Índice**:
O índice do Meilisearch, um por Canal.
_Avoid_: usar "índice" para o aplicativo como um todo

**Segmento**:
Um trecho da Transcrição com timestamp de início, indexado como um Documento próprio para permitir deep-link ao momento exato do Vídeo.

**Documento**:
A unidade indexada no Meilisearch — um Vídeo, um Comentário ou um Segmento de Transcrição.

**Fase de Ingestão**:
Cada etapa do pipeline (vídeos, Comentários, Transcrições), executada separadamente e resumível via Ledger de ingestão.

**Fila de Ingestão**:
A fila de jobs em SQLite que o Worker consome, disparada pela UI.

**Worker**:
O processo separado que executa as Fases de Ingestão a partir da Fila de Ingestão.

**Fonte da verdade**:
O SQLite guarda o conteúdo completo; o Meilisearch é apenas a projeção de busca, reconstruível a partir dele sem re-consumir cota da API do YouTube.

**Ledger de ingestão**:
O registro em SQLite do que já foi ingerido por Vídeo (vídeos, Comentários, Transcrições) e o andamento das Fases de Ingestão.

**Busca**:
A consulta do usuário contra o Índice.

**API key**:
A chave da YouTube Data API usada na Ingestão.