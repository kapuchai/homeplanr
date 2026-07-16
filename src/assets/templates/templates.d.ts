// Vite ?raw imports for the bundled template plans (vite/client only
// declares generic '*?raw' for .ts consumers when the types are included;
// this makes the .homeplanr imports explicit for tsc).
declare module '*.homeplanr?raw' {
  const src: string
  export default src
}
