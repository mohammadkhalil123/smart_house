/** Error that maps directly to an HTTP response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: Record<string, unknown>): ApiError {
    return new ApiError(400, 'BAD_REQUEST', message, details);
  }
}

/** The configured data source (mock files or MongoDB) could not be read. */
export class DataSourceError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DataSourceError';
  }
}

/** Invalid environment configuration; the server refuses to start. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Removes credentials from anything that might contain a connection string. */
export function redactSecrets(text: string): string {
  return text.replace(/(\w[\w+.-]*:\/\/)[^@/\s]+@/g, '$1***@');
}

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** Maps any thrown error to an HTTP status and a safe JSON body (no internals leaked). */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  }
  if (err instanceof DataSourceError) {
    return {
      status: 503,
      body: { error: { code: 'DATA_SOURCE_UNAVAILABLE', message: 'The data source is currently unavailable.' } },
    };
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } } };
}
