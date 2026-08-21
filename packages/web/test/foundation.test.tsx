import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { makeApi } from "./helpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readFile(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf-8");
}

function lightBlock(css: string): string {
  // Extracts the .light { ... } block. The current block is flat (no nested
  // braces); if a future change adds a nested rule, prefer an AST/CSS parser.
  const match = css.match(/\.light\s*\{[^}]*\}/s);
  if (!match) {
    throw new Error("Foundation CSS missing the .light override block");
  }
  return match[0];
}

describe("Foundation", () => {
  it("renderiza o título do aplicativo", () => {
    render(<App api={makeApi()} />);
    expect(screen.getByRole("heading", { name: "youtube-index" })).toBeInTheDocument();
  });

  it("carrega o CSS de fundação no ponto de entrada", () => {
    const main = readFile("../src/main.tsx");
    expect(main).toMatch(/import\s+["']\.\/index\.css["']/);
  });

  it("define fundo zinc escuro como padrão", () => {
    const css = readFile("../src/index.css");
    expect(css).toContain("--background: oklch(0.141 0.005 285.823)");
  });

  it("define variante light com fundo zinc claro", () => {
    const css = readFile("../src/index.css");
    expect(lightBlock(css)).toContain("--background: oklch(1 0 0)");
  });

  it("usa violeta para primary e ring no modo escuro", () => {
    const css = readFile("../src/index.css");
    expect(css).toContain("--primary: oklch(0.702 0.183 293.541)");
    expect(css).toContain("--ring: oklch(0.702 0.183 293.541)");
  });

  it("usa violeta para primary e ring no modo light", () => {
    const css = readFile("../src/index.css");
    const block = lightBlock(css);
    expect(block).toContain("--primary: oklch(0.541 0.281 293.009)");
    expect(block).toContain("--ring: oklch(0.541 0.281 293.009)");
  });

  it("configura as fontes Geist Sans e Geist Mono", () => {
    const css = readFile("../src/index.css");
    expect(css).toContain("--font-sans: 'Geist Variable'");
    expect(css).toContain("--font-mono: 'Geist Mono Variable'");
  });

  it("importa as fontes Geist via fontsource", () => {
    const css = readFile("../src/index.css");
    expect(css).toContain('@import "@fontsource-variable/geist";');
    expect(css).toContain('@import "@fontsource-variable/geist-mono";');
  });

  it("adiciona favicon inline com ícone de play", () => {
    const html = readFile("../index.html");
    expect(html).toContain('rel="icon"');
    expect(html).toContain("data:image/svg+xml");

    const hrefMatch = html.match(/href=["']([^"']+)["']/);
    expect(hrefMatch).toBeTruthy();
    const decoded = decodeURIComponent(hrefMatch![1]!);
    expect(decoded).toContain("<path");
    expect(decoded).toMatch(/d=["'][^"']*["']/);
  });
});
