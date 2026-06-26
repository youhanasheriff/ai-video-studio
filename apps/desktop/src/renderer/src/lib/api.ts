export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Electron wraps main-process errors as: Error invoking remote method 'x': Error: <real cause>
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/i, "")
    .replace(/^(Error|UnhandledPromiseRejection):\s*/i, "")
    .trim() || raw;
}

export async function safeInvoke<T>(work: () => Promise<T>, onError: (message: string) => void, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    onError(errorMessage(error));
    return fallback;
  }
}
