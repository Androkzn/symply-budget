/// <reference types="@cloudflare/vitest-pool-workers/types" />

// Make ProvidedEnv used by `cloudflare:test` reflect the real backend Env.
declare module 'cloudflare:test' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface ProvidedEnv extends import('./src/types').Env {}
}

// Vite/Vitest `?raw` imports. The contract tests read a module's SOURCE TEXT to
// assert on things a runtime import cannot see — route registration order,
// which handlers sit behind a gate. Vitest resolves this suffix natively; tsc
// does not, so without this declaration `npm run typecheck` fails on every such
// import even though the suite passes.
declare module '*?raw' {
  const content: string;
  export default content;
}
