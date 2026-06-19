export function errorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  if (error.message && error.message !== "Failed to fetch") {
    return error.message;
  }

  if (error.cause instanceof Error && error.cause.message) {
    return error.cause.message;
  }

  return error.message || fallback;
}

export function errorLogValue(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}
