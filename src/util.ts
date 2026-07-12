// ABOUTME: Small shared helpers with no dependencies on the rest of the model.
// ABOUTME: stripControl neutralizes terminal escape sequences before rendering.

// Strips 0x00-0x08, 0x0A-0x1F (LF, ESC, ...), and 0x7F (DEL); keeps 0x09 (tab).
const CONTROL_CHARS = /[\u0000-\u0008\u000A-\u001F\u007F]/g;

/**
 * Remove ASCII control characters (except tab) from a string. Scanned config -
 * notably hook commands - can contain raw escape sequences; stripping them
 * before rendering prevents a malicious value from injecting terminal control
 * output (cursor moves, colors, title changes) into --list or the TUI.
 */
export function stripControl(s: string): string {
  return s.replace(CONTROL_CHARS, "");
}
