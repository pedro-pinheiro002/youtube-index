import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import TranscriptClient from "youtube-transcript-api";

/**
 * Regression test for the youtube-transcript-api@3.0.6 bug:
 *
 *   `TypeError: relativeURL.replace is not a function`
 *
 * The library's `#get_auth()` constructs a WHATWG `URL` object and passes it
 * directly to `axios.post(url, ...)`. Axios's http adapter first calls
 * `buildFullPath(baseURL, requestedURL)` which delegates to `combineURLs()`.
 * `isAbsoluteURL()` returns `false` for any non-string, so a URL object is
 * treated as a relative URL and `combineURLs` calls `relativeURL.replace(...)`
 * — which throws because URL instances don't have `.replace()`.
 *
 * We can't avoid the call — the network step happens inside `getTranscript()`
 * itself — so we patch the upstream package via
 * `patches/youtube-transcript-api@3.0.6.patch`.
 *
 * The test is offline: we override axios's underlying `transport` (its
 * `https.request` equivalent) so the http adapter's URL-resolution path runs
 * against canned responses instead of real network. This is important —
 * overriding axios's `adapter` instead would skip `buildFullPath` entirely
 * and the bug would never fire.
 *
 * Pre-fix: `combineURLs` throws before any POST transport call → caught.message
 * contains "relativeURL.replace is not a function" → test fails.
 * Post-fix: the library passes `url.toString()` → no throw → POST transport
 * call is made → our stub rejects with "blocked (test transport)" → test
 * passes.
 */
describe("youtube-transcript-api: relativeURL.replace regression", () => {
  it("does not throw 'relativeURL.replace is not a function' from getTranscript", async () => {
    // Build a fake Node-style transport so axios's http adapter runs without
    // touching the real network. The shape mirrors `https.request`:
    // `transport.request(options, callback)` returns a request-like
    // EventEmitter; the callback receives a response-like EventEmitter that
    // emits 'data' / 'end' and has a `statusCode`.
    const transport = {
      request: (
        options: { path?: string; method?: string },
        callback: (res: unknown) => void,
      ) => {
        const req = new EventEmitter() as EventEmitter & {
          write: () => void;
          end: () => void;
          destroy: () => void;
          setTimeout: () => void;
        };
        req.write = () => {};
        req.end = () => {};
        req.destroy = () => {};
        req.setTimeout = () => {};

        process.nextTick(() => {
          const method = (options.method ?? "get").toLowerCase();
          if (method !== "get") {
            // POST to identitytoolkit — short-circuit. Reached only after
            // the patch fixes the URL-object-in-axios bug.
            req.emit("error", new Error("blocked (test transport)"));
            return;
          }

          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string | undefined>;
          };
          res.statusCode = 200;
          res.headers = {};

          // Firebase regex `/\(\{[^}]*apiKey:"([^"]+)"[^}]*\}\)/gm` requires
          // unquoted keys — JSON-style {"key":"v"} does not match.
          const scriptBody =
            '({apiKey:"AIzaSyTest",appId:"1:1234:web:abc"})';
          const body =
            options.path === "/"
              ? `<html><script src="/cfg.js"></script></html>`
              : scriptBody;

          callback(res);
          res.emit("data", Buffer.from(body, "utf8"));
          res.emit("end");
        });

        return req;
      },
    };

    const client = new TranscriptClient({ transport });
    await client.ready;

    let caught: Error | undefined;
    try {
      await client.getTranscript("any-id");
    } catch (err) {
      caught = err as Error;
    }

    expect(caught?.message ?? "").not.toContain(
      "relativeURL.replace is not a function",
    );
  });
});
