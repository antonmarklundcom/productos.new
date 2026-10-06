/** Error messages can contain SQL parameters, addresses and provider tokens. */
export function safeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  const value = error instanceof Error ? error : null;
  const name =
    value && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value.name)
      ? value.name
      : "Error";
  let code: string | undefined;
  for (
    let cursor: unknown = error, n = 0;
    cursor && typeof cursor === "object" && n < 5;
    n++
  ) {
    const row = cursor as { code?: unknown; cause?: unknown };
    if (
      typeof row.code === "string" &&
      /^(?:ER_[A-Z0-9_]+|E[A-Z]{2,30})$/.test(row.code)
    ) {
      code = row.code;
      break;
    }
    cursor = row.cause;
  }
  // Only file basename and coordinates. Never the message/SQL/provider URL.
  const frames = value?.stack
    ?.split("\n")
    .slice(1)
    .flatMap((line) => {
      const match = line.match(
        /([A-Za-z0-9_.-]+\.[cm]?[jt]sx?):(\d+):(\d+)\)?$/
      );
      return match ? [`at ${match[1]}:${match[2]}:${match[3]}`] : [];
    })
    .slice(0, 20);
  return {
    name,
    message: code ? `${name}: ${code}` : name,
    ...(frames?.length ? { stack: frames.join("\n") } : {}),
  };
}
