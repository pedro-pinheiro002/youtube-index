import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/App";

describe("App", () => {
  it("renderiza o título do aplicativo", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("youtube-index");
  });
});