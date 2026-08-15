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

export interface TranscriptFetcher {
  fetchTranscript(videoId: string): Promise<Transcript | null>;
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

  async fetchTranscript(videoId: string): Promise<Transcript | null> {
    await this.client.ready;
    let response: TranscriptClientResponse;
    try {
      response = await this.client.getTranscript(videoId);
    } catch {
      return null;
    }
    const track = (response.tracks ?? []).find((entry) => entry.transcript.length > 0);
    if (!track) {
      return null;
    }
    return {
      videoId,
      segments: track.transcript.map(toSegment),
    };
  }
}