export type SearchDocumentType = "video" | "comment" | "segment";

export interface SearchDocument {
  id: string;
  channelId: string;
  type: SearchDocumentType;
}

export interface Projection {
  addDocuments(channelId: string, documents: SearchDocument[]): Promise<void>;
}