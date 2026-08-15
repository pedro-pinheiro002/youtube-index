import { useState } from "react";

export interface ChannelFormProps {
  onSubmit: (handle: string) => void;
  submitting: boolean;
  disabled: boolean;
}

export function ChannelForm({ onSubmit, submitting, disabled }: ChannelFormProps) {
  const [handle, setHandle] = useState("");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = handle.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="channel-handle">@handle do Canal</label>
      <input
        id="channel-handle"
        type="text"
        value={handle}
        onChange={(event) => setHandle(event.target.value)}
        placeholder="@funkyblackcat"
        disabled={submitting || disabled}
      />
      <button type="submit" disabled={submitting || disabled}>
        {submitting ? "Ingerindo..." : "Ingerir canal"}
      </button>
    </form>
  );
}