/** Bounded fixture evidence only; do not retain URLs, query/fragment state or credentials. */
export function sanitizedBrowserMessage(value) {
 return String(value)
  .replace(/https?:\/\/[^\s"'<>]+/gi,"[url]")
  // WebKit sometimes splits Error.name at the colon in http:, leaving a
  // standalone /127.0.0.1:port/path?query in Error.message.
  .replace(/\/{1,2}[^\s"'<>]+/g,"[path]")
  .replace(/[?#][^\s"'<>]+/g,"[state]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[email]")
  .replace(/\b(?:token|password|secret|authorization)\s*[:=]\s*\S+/gi,"[private]")
  .slice(0,240);
}
