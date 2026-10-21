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
