import type {
  CommentSearchHit,
  SearchHit,
  SegmentSearchHit,
  VideoSearchHit,
} from "./types";

export function highlightHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped.replace(/&lt;em&gt;/g, "<em>").replace(/&lt;\/em&gt;/g, "</em>");
}

export function textOf(hit: SearchHit, field: string, fallback: string): string {
  const formatted = hit._formatted?.[field];
  return typeof formatted === "string" ? formatted : fallback;
}

const ptBRNumber = new Intl.NumberFormat("pt-BR");

export function formatCount(value: number): string {
  return ptBRNumber.format(value);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function formatStart(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function Highlighted({ text }: { text: string }) {
  return <span dangerouslySetInnerHTML={{ __html: highlightHtml(text) }} />;
}

function VideoCard({ hit }: { hit: VideoSearchHit }) {
  return (
    <article>
      <a href={hit.url} target="_blank" rel="noreferrer">
        <img src={hit.thumbnail} alt="" width={160} height={90} />
      </a>
      <div>
        <h3>
          <a href={hit.url} target="_blank" rel="noreferrer">
            <Highlighted text={textOf(hit, "title", hit.title)} />
          </a>
        </h3>
        <p>
          <Highlighted text={textOf(hit, "description", hit.description)} />
        </p>
        <p>
          {formatCount(hit.views)} visualizações · {formatCount(hit.likes)} curtidas ·{" "}
          {formatStart(hit.durationSeconds)} · {formatDate(hit.publishedAt)}
        </p>
      </div>
    </article>
  );
}

function CommentCard({ hit }: { hit: CommentSearchHit }) {
  return (
    <article>
      <a href={hit.url} target="_blank" rel="noreferrer">
        <img src={hit.videoThumbnail} alt="" width={160} height={90} />
      </a>
      <div>
        <h3>
          <a href={hit.url} target="_blank" rel="noreferrer">
            <Highlighted text={textOf(hit, "videoTitle", hit.videoTitle)} />
          </a>
        </h3>
        <p>
          {hit.author} · {formatDate(hit.publishedAt)} · {formatCount(hit.likes)} curtidas
        </p>
        <p>
          <Highlighted text={textOf(hit, "text", hit.text)} />
        </p>
        <p>
          {formatCount(hit.videoViews)} visualizações · {formatCount(hit.videoLikes)} curtidas
        </p>
      </div>
    </article>
  );
}

function SegmentCard({ hit }: { hit: SegmentSearchHit }) {
  return (
    <article>
      <a href={hit.url} target="_blank" rel="noreferrer">
        <img src={hit.videoThumbnail} alt="" width={160} height={90} />
      </a>
      <div>
        <h3>
          <a href={hit.url} target="_blank" rel="noreferrer">
            <Highlighted text={textOf(hit, "videoTitle", hit.videoTitle)} />
          </a>
        </h3>
        <p>
          <Highlighted text={textOf(hit, "text", hit.text)} />
        </p>
        <p>
          {formatStart(hit.start)} · {formatDate(hit.publishedAt)} ·{" "}
          {formatCount(hit.videoViews)} visualizações · {formatCount(hit.videoLikes)} curtidas
        </p>
      </div>
    </article>
  );
}

export function SearchHitCard({ hit }: { hit: SearchHit }) {
  switch (hit.type) {
    case "video":
      return <VideoCard hit={hit} />;
    case "comment":
      return <CommentCard hit={hit} />;
    case "segment":
      return <SegmentCard hit={hit} />;
  }
}
