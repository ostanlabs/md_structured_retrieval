/**
 * Error utilities and factory functions for MSRL.
 *
 * Provides type-safe error creation with proper details structure
 * for each error code as documented in the spec.
 */

import { MsrlError } from './types.js';

/**
 * Type guard to check if an error is an MsrlError.
 */
export function isMsrlError(error: unknown): error is MsrlError {
  return error instanceof MsrlError;
}

/**
 * Create an INVALID_ARGUMENT error.
 *
 * @param field - The field that has an invalid value
 * @param value - The invalid value
 * @param reason - Why the value is invalid
 * @param validOptions - Optional list of valid options
 */
export function invalidArgument(
  field: string,
  value: unknown,
  reason: string,
  validOptions?: string[],
): MsrlError {
  const details: Record<string, unknown> = {
    field,
    value,
    reason,
  };
  if (validOptions) {
    details.validOptions = validOptions;
  }
  return new MsrlError('INVALID_ARGUMENT', `Invalid argument '${field}': ${reason}`, details);
}

/**
 * Create a NOT_FOUND error.
 *
 * @param docUri - The document URI that was not found
 * @param headingPath - Optional heading path within the document
 */
export function notFound(docUri: string, headingPath?: string): MsrlError {
  const details: Record<string, unknown> = { docUri };
  if (headingPath) {
    details.headingPath = headingPath;
  }
  const message = headingPath
    ? `Document '${docUri}' heading '${headingPath}' not found`
    : `Document '${docUri}' not found`;
  return new MsrlError('NOT_FOUND', message, details);
}

/**
 * Create a NOT_INDEXED error.
 */
export function notIndexed(): MsrlError {
  return new MsrlError('NOT_INDEXED', 'Vault is not indexed. Call reindex() first.', {});
}

/**
 * Create an INDEX_BUSY error.
 *
 * @param currentBuildStartedAt - When the current build started
 */
export function indexBusy(currentBuildStartedAt: Date): MsrlError {
  return new MsrlError('INDEX_BUSY', 'Index build is already in progress', {
    currentBuildStartedAt: currentBuildStartedAt.toISOString(),
  });
}

/**
 * Create an INDEX_CORRUPT error.
 *
 * @param snapshotId - The ID of the corrupt snapshot
 * @param reason - Why the snapshot is corrupt
 * @param missingFiles - Optional list of missing files
 */
export function indexCorrupt(snapshotId: string, reason: string, missingFiles?: string[]): MsrlError {
  const details: Record<string, unknown> = {
    snapshotId,
    reason,
  };
  if (missingFiles) {
    details.missingFiles = missingFiles;
  }
  return new MsrlError('INDEX_CORRUPT', `Index snapshot '${snapshotId}' is corrupt: ${reason}`, details);
}

/**
 * Create an IO_ERROR error.
 *
 * @param path - The path that caused the error
 * @param operation - The operation that failed (read, write, etc.)
 * @param errno - Optional error number/code
 */
export function ioError(path: string, operation: string, errno?: string): MsrlError {
  const details: Record<string, unknown> = {
    path,
    operation,
  };
  if (errno) {
    details.errno = errno;
  }
  return new MsrlError('IO_ERROR', `IO error during ${operation} on '${path}'`, details);
}

/**
 * Create a MODEL_DOWNLOAD_FAILED error.
 *
 * @param url - The URL that failed to download
 * @param reason - Why the download failed
 */
export function modelDownloadFailed(url: string, reason: string): MsrlError {
  return new MsrlError('MODEL_DOWNLOAD_FAILED', `Failed to download model from '${url}': ${reason}`, {
    url,
    reason,
  });
}

/**
 * Create an INTERNAL error.
 *
 * @param message - Error message
 * @param originalError - Optional original error that caused this
 */
export function internalError(message: string, originalError?: Error): MsrlError {
  const details: Record<string, unknown> = {};
  if (originalError) {
    details.originalError = originalError.message;
  }
  return new MsrlError('INTERNAL', message, details);
}

