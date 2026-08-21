import { useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";

export type ChannelFormVariant = "hero" | "compact";

export interface ChannelFormProps {
  onSubmit: (handle: string) => void;
  submitting: boolean;
  disabled?: boolean;
  error?: string | null;
  variant: ChannelFormVariant;
}

export function ChannelForm({
  onSubmit,
  submitting,
  disabled = false,
  error,
  variant,
}: ChannelFormProps) {
  const [handle, setHandle] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = handle.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  const isDisabled = submitting || disabled;

  if (variant === "hero") {
    return (
      <section aria-label="Boas-vindas" className="relative">
        <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-16 text-center">
          <header className="flex flex-col items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">youtube-index</h1>
            <p className="text-sm text-muted-foreground">
              Busca local para o conteúdo de um canal do YouTube.
            </p>
          </header>
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
            <label htmlFor="channel-handle" className="sr-only">
              @handle do Canal
            </label>
            <Input
              id="channel-handle"
              type="text"
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@funkyblackcat"
              disabled={isDisabled}
              className="h-10"
            />
            <Button type="submit" disabled={isDisabled} className="h-10">
              {submitting ? "Ingerindo..." : "Ingerir Canal"}
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Ingestão" className="flex flex-col gap-2">
      <form onSubmit={handleSubmit} className="flex flex-row items-center gap-2">
        <label htmlFor="channel-handle" className="sr-only">
          @handle do Canal
        </label>
        <Input
          id="channel-handle"
          type="text"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder="@funkyblackcat"
          disabled={isDisabled}
        />
        <Button type="submit" disabled={isDisabled}>
          {submitting ? "Ingerindo..." : "Ingerir Canal"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
