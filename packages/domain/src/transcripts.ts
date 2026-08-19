import TranscriptClient, {
  type TranscriptClientResponse,
  type TranscriptClientSegment,
} from "youtube-transcript-api";

export interface TranscriptSegment {
  start: number;
  duration: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  segments: TranscriptSegment[];
}

/**
 * Resultado discriminado da busca de uma Transcrição. Os três outcomes são
 * explícitos no nível do tipo para que o chamador (a Fase de Ingestão de
 * Transcrições) seja exaustivo e não conflate "ausência permanente" com
 * "falha transitória":
 *
 * - `transcript` — o serviço respondeu com uma track não-vazia.
 * - `absent` — o Vídeo não tem Transcrição (tracks vazias / sem trechos).
 *   Ausência permanente: o chamador marca `markTranscriptAbsent`.
 * - `error` — o serviço falhou (rede, DNS, TCP, timeout, HTTP). Falha
 *   transitória: o chamador lança para a Fase falhar e o Vídeo permanece
 *   retriable na próxima Sincronização. O `cause` é o `Error` original.
 */
export type TranscriptResult =
  | { kind: "transcript"; transcript: Transcript }
  | { kind: "absent" }
  | { kind: "error"; cause: Error };

export interface TranscriptFetcher {
  fetchTranscript(videoId: string): Promise<TranscriptResult>;
}

interface YoutubeTranscriptClient {
  readonly ready: Promise<void>;
  getTranscript(id: string): Promise<TranscriptClientResponse>;
}

function toSegment(segment: TranscriptClientSegment): TranscriptSegment {
  return {
    start: Number(segment.start),
    duration: Number(segment.dur),
    text: segment.text,
  };
}

export class YoutubeTranscriptFetcher implements TranscriptFetcher {
  private readonly client: YoutubeTranscriptClient;

  constructor(client: YoutubeTranscriptClient = new TranscriptClient()) {
    this.client = client;
  }

  async fetchTranscript(videoId: string): Promise<TranscriptResult> {
    await this.client.ready;
    let response: TranscriptClientResponse;
    try {
      response = await this.client.getTranscript(videoId);
    } catch (cause) {
      // Qualquer erro do serviço não-oficial (rede, DNS, TCP, timeout, HTTP)
      // é uma falha transitória — não uma ausência permanente. Carregamos o
      // Error original para o chamador decidir lançar e deixar o Vídeo
      // retriable; não re-embrulhamos em string.
      return { kind: "error", cause: cause instanceof Error ? cause : new Error(String(cause)) };
    }
    const track = (response.tracks ?? []).find((entry) => entry.transcript.length > 0);
    if (!track) {
      return { kind: "absent" };
    }
    return {
      kind: "transcript",
      transcript: {
        videoId,
        segments: track.transcript.map(toSegment),
      },
    };
  }
}
