# Contexto

Aplicativo de busca local (fullstack TypeScript) que indexa o conteúdo de um Canal do YouTube — títulos, descrições, Comentários e Transcrições — em um único banco Postgres, permitindo busca por palavra-chave com destaque e links para momentos exatos dos vídeos.

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
O processo de buscar dados do YouTube e de Transcrição e gravá-los no banco.
_Avoid_: download, scraping

**Sincronização**:
A atualização incremental do banco após a carga inicial — vídeos novos e Comentários de Vídeos recentes.

**Segmento**:
Um trecho da Transcrição com timestamp de início, persistido como Documento próprio para permitir deep-link ao momento exato do Vídeo.

**Documento**:
Uma linha persistida no Postgres — um Vídeo, um Comentário ou um Segmento de Transcrição. A Busca consulta Documentos.
_Avoid_: registro, tupla, índice

**Fase de Ingestão**:
Cada etapa do pipeline (vídeos, Comentários, Transcrições), executada separadamente e resumível via Ledger de ingestão.

**Fila de Ingestão**:
A fila de jobs no Postgres que o Worker consome, alimentada pela API quando um Canal é criado.

**Worker**:
O consumidor in-process da Fila de Ingestão, executado dentro do processo do backend via LISTEN/NOTIFY + polling. Não é mais um processo ou contêiner separado.
_Avoid_: processo, contêiner, serviço

**Fonte da verdade**:
O Postgres guarda o conteúdo completo e é também onde a Busca acontece — não há mais uma projeção de busca separada.
_Avoid_: SQLite, Meilisearch

**Ledger de ingestão**:
O registro no Postgres do que já foi ingerido por Vídeo (vídeos, Comentários, Transcrições) e o andamento das Fases de Ingestão.

**Busca**:
A consulta do usuário contra os Documentos. Combina correspondência lexical (`tsvector` + `ts_rank`, indexada por GIN) com fallback por similaridade (`pg_trgm`) para tolerância a erros de digitação quando a Busca lexical não retorna resultados.
_Avoid_: query, lookup

**API key**:
A chave da YouTube Data API usada na Ingestão.
