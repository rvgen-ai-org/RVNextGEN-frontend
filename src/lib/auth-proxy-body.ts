export class AuthBodyError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Bound auth JSON while reading, including requests without Content-Length. */
export async function readAuthBody(request: Request): Promise<Record<string, unknown>> {
  const limit = 16 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new AuthBodyError(413, "Request is too large.");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new AuthBodyError(413, "Request is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const text = new TextDecoder().decode(bytes);
    const body: unknown = text.trim() ? JSON.parse(text) : {};
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new AuthBodyError(400, "Invalid JSON request."); }
}
