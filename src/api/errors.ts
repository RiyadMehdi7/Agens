import type { ErrorCode } from '../../shared/api.js';

export type FailureCode = ErrorCode | 'NETWORK' | 'INVALID_RESPONSE';

/** A user-safe failure. `message` never contains server internals. */
export class ApiFailure extends Error {
  constructor(readonly code: FailureCode, message = friendlyMessage(code), readonly status?: number) {
    super(message);
  }
}

const messages: Record<FailureCode, string> = {
  INVALID_REQUEST: 'That file or request could not be read. Check the format and try again.',
  PAYLOAD_TOO_LARGE: 'That file is too large. Imports are limited to 256 KB.',
  UNSUPPORTED_MEDIA_TYPE: 'The request was not accepted. Reload and try again.',
  UNAUTHORIZED: 'Your session expired, so connected data was cleared. Connect it again.',
  FORBIDDEN: 'This page is not allowed to reach the data service.',
  NOT_FOUND: 'That dataset or query is no longer available in this session.',
  CONFLICT: 'This chart no longer matches its source data.',
  RESOURCE_LIMIT: 'This session hit a limit, or another request is still running. Try again shortly.',
  NOT_IMPLEMENTED: 'Data import is not available on this server yet.',
  UNAVAILABLE: 'The data service did not respond in time. Try again.',
  INTERNAL_ERROR: 'Something went wrong on the server. Try again.',
  NETWORK: 'The data service cannot be reached. Check that the API is running.',
  INVALID_RESPONSE: 'The data service sent an unexpected response.',
};

export function friendlyMessage(code: FailureCode): string {
  return messages[code];
}

export function toFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error;
  return new ApiFailure('INTERNAL_ERROR', 'Something went wrong. Try again.');
}
