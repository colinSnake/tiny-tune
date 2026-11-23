export class BodyTooLarge extends Error {}

export async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new BodyTooLarge();
      chunks.push(value);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks, length);
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
