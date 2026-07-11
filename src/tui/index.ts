// ABOUTME: TUI entrypoint — re-exports runTui so the CLI can dynamically import it.
// ABOUTME: Kept JSX-free; the Ink component and render live in app.tsx.
export { runTui, App } from "./app.js";
