type ErrorPayload = {
  error?: string;
};

export async function readJsonResponse<T>(
  response: Response,
  createError: (status: number, message: string) => Error,
  fallbackErrorMessage: (status: number) => string,
  invalidJsonMessage: string
): Promise<T> {
  const payload = (await response.json().catch(() => null)) as (T & ErrorPayload) | null;

  if (!response.ok) {
    throw createError(response.status, payload?.error ?? fallbackErrorMessage(response.status));
  }

  if (!payload) {
    throw createError(response.status, invalidJsonMessage);
  }

  return payload;
}
