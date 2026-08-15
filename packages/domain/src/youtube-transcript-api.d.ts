declare module "youtube-transcript-api" {
  export interface TranscriptClientSegment {
    text: string;
    start: string;
    dur: string;
  }

  export interface TranscriptClientTrack {
    language: string;
    transcript: TranscriptClientSegment[];
  }

  export interface TranscriptClientResponse {
    id: string;
    tracks: TranscriptClientTrack[];
  }

  export default class TranscriptClient {
    readonly ready: Promise<void>;
    constructor(options?: Record<string, unknown>);
    getTranscript(id: string): Promise<TranscriptClientResponse>;
  }
}