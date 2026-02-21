/**
 * doc-uri Utilities
 *
 * Converts between absolute file paths and vault-relative doc_uri format.
 *
 * doc_uri format:
 * - Vault-relative POSIX path with .md extension
 * - Always forward slashes (even on Windows)
 * - No leading slash
 * - Spaces/special chars NOT encoded (kept as-is)
 * - Example: "notes/daily/2024-01-15.md"
 */

import * as path from 'node:path';

/**
 * Convert an absolute file path to a doc_uri.
 *
 * @param absolutePath - Absolute path to the file
 * @param vaultRoot - Absolute path to the vault root
 * @returns Vault-relative POSIX path
 * @throws Error if path is outside vault
 */
export function toDocUri(absolutePath: string, vaultRoot: string): string {
  // Normalize vault root (remove trailing slash)
  const normalizedVaultRoot = vaultRoot.replace(/[/\\]+$/, '');

  // Make path relative to vault root
  let relative = path.relative(normalizedVaultRoot, absolutePath);

  // Check if path is outside vault (relative path starts with ..)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path "${absolutePath}" is outside vault "${vaultRoot}"`);
  }

  // Normalize to POSIX separators (forward slashes)
  relative = relative.split(path.sep).join('/');

  // Also handle any backslashes in the original path
  relative = relative.replace(/\\/g, '/');

  // Remove leading slash if present
  if (relative.startsWith('/')) {
    relative = relative.slice(1);
  }

  return relative;
}

/**
 * Convert a doc_uri to an absolute file path.
 *
 * @param docUri - Vault-relative POSIX path
 * @param vaultRoot - Absolute path to the vault root
 * @returns Absolute path to the file
 */
export function toAbsolutePath(docUri: string, vaultRoot: string): string {
  // Normalize vault root (remove trailing slash)
  const normalizedVaultRoot = vaultRoot.replace(/[/\\]+$/, '');

  // Join with vault root using POSIX separator
  return `${normalizedVaultRoot}/${docUri}`;
}

/**
 * Validate a doc_uri format.
 *
 * @param docUri - String to validate
 * @returns true if valid doc_uri format
 */
export function isValidDocUri(docUri: string): boolean {
  // Must not be empty
  if (!docUri || docUri.length === 0) {
    return false;
  }

  // Must not start with /
  if (docUri.startsWith('/')) {
    return false;
  }

  // Must not contain backslashes
  if (docUri.includes('\\')) {
    return false;
  }

  // Must end with .md
  if (!docUri.endsWith('.md')) {
    return false;
  }

  return true;
}

