export class ApiFetchError extends Error {
  status: number;
  isNonJson: boolean;

  constructor(message: string, status = 500, isNonJson = false) {
    super(message);
    this.name = 'ApiFetchError';
    this.status = status;
    this.isNonJson = isNonJson;
  }
}

function friendlyHttpMessage(status: number): string {
  if (status === 400) return 'Please check your question or location details and try again.';
  if (status === 401 || status === 403) return 'Your session expired. Please sign in again to continue.';
  if (status === 404) return 'The requested EcoAI endpoint could not be found.';
  if (status === 429) return 'Too many requests right now. Please wait a moment and retry.';
  if (status >= 500) return 'The EcoAI service is temporarily unavailable. Please try again shortly.';
  return 'Unable to complete the request right now. Please try again.';
}

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new ApiFetchError('Unable to reach the server. Check your connection and try again.', 0, false);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const isJson = contentType.includes('application/json') || contentType.includes('+json');

  if (!isJson) {
    await response.text().catch(() => '');
    throw new ApiFetchError(
      response.ok
        ? 'The server returned an unexpected response format instead of data. Please retry.'
        : friendlyHttpMessage(response.status),
      response.status,
      true
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiFetchError(
      'Received an unreadable response from the server. Please try again.',
      response.status,
      true
    );
  }

  if (!response.ok) {
    const serverMsg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : '';
    throw new ApiFetchError(serverMsg || friendlyHttpMessage(response.status), response.status, false);
  }

  return data as T;
}
