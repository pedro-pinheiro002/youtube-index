import { useEffect, useState } from "react";

export function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((res) => setApiOk(res.ok))
      .catch(() => setApiOk(false));
  }, []);

  return (
    <main>
      <h1>youtube-index</h1>
      <p>Busca local para o conteúdo de um canal do YouTube.</p>
      <p>
        API:{" "}
        {apiOk === null ? "verificando..." : apiOk ? "ok" : "indisponível"}
      </p>
    </main>
  );
}