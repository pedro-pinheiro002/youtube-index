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