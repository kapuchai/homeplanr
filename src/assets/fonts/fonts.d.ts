// Vite ?url import for the bundled PDF font (same rationale as
// templates.d.ts — vite/client types are not included for tsc).
declare module '*.ttf?url' {
  const url: string
  export default url
}
