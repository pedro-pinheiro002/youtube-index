# Um canal por vez, schema modelado para vários

A aplicação indexa um Canal por vez (informado via handle na UI), mas o schema inclui `channelId` em todos os Documentos e o Índice Meilisearch é nomeado por Canal. Mantém a implementação simples para o caso de uso local/pessoal sem fechar a porta para multi-canal no futuro.