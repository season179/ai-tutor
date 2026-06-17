export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function errorLogValue(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}
