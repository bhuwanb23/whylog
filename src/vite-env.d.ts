/// <reference types="vite/client" />

/**
 * WhyLog defines no custom `import.meta.env` variables.
 *
 * That is deliberate. There is no `VITE_API_KEY`: a build-time key would be baked
 * into the bundle and readable by anyone who opens DevTools, and the whole point
 * of the local-first design is that the keyless build contains no secret at all.
 *
 * The API key is entered at runtime and stored in localStorage under
 * `whylog:config:v1`. See src/ai/config.ts.
 */

/**
 * Vite's `?raw` suffix, used for exactly one thing: bundling the demo fixture.
 *
 * §6.9 requires the demo path to be one click from a cold start, and a judge at a hackathon will
 * not paste their own transcript. Fetching `fixtures/demo-transcript.txt` at runtime would fail in
 * the sandboxed preview, which has no network, so the text is imported into the bundle instead.
 *
 * Only `.txt?raw` is declared. A blanket wildcard would let any file be silently inlined into the
 * bundle, and the one thing that must never be inlined is a config file with a key in it.
 */
declare module "*.txt?raw" {
  const contents: string;
  export default contents;
}
