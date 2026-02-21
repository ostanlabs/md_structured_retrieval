/**
 * Fence Detector
 *
 * Detects fenced code blocks in Markdown text.
 * Used to prevent headings inside code blocks from being parsed.
 */

import type { FencedRegion } from '../types.js';

// Re-export the type for convenience
export type { FencedRegion } from '../types.js';

/**
 * Regex to match the opening of a fenced code block.
 * Matches:
 * - Optional leading whitespace (up to 3 spaces per CommonMark)
 * - 3+ backticks or tildes
 * - Optional language tag (first word only)
 * - Rest of line (ignored)
 *
 * Groups:
 * 1. The fence characters (``` or ~~~)
 * 2. The language tag (if present)
 */
const FENCE_OPEN_REGEX = /^([ ]{0,3})((`{3,})|~{3,})([^\s`]*)?.*$/gm;

/**
 * Detects fenced code blocks in Markdown text.
 */
export class FenceDetector {
  /**
   * Detect all fenced code block regions in the text.
   *
   * @param text - The normalized Markdown text
   * @returns Array of fenced regions with start/end offsets and language
   */
  detect(text: string): FencedRegion[] {
    const regions: FencedRegion[] = [];
    const lines = text.split('\n');
    let currentOffset = 0;
    let inFence = false;
    let fenceStart = 0;
    let fenceChar = '';
    let fenceLength = 0;
    let fenceLanguage: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineStart = currentOffset;

      if (!inFence) {
        // Look for fence opening - must be at start of line (with optional leading whitespace)
        const match = this.matchFenceOpen(line);
        if (match && match.isAtLineStart) {
          inFence = true;
          fenceStart = lineStart;
          fenceChar = match.char;
          fenceLength = match.length;
          fenceLanguage = match.language;
        }
      } else {
        // Look for fence closing
        if (this.matchFenceClose(line, fenceChar, fenceLength)) {
          // Found closing fence - endChar is position after the closing fence line
          const fenceEnd = currentOffset + line.length;
          regions.push({
            startChar: fenceStart,
            endChar: fenceEnd,
            language: fenceLanguage,
          });
          inFence = false;
          fenceChar = '';
          fenceLength = 0;
          fenceLanguage = null;
        }
      }

      // Move to next line (+1 for newline, except for last line)
      currentOffset += line.length + (i < lines.length - 1 ? 1 : 0);
    }

    // Handle unclosed fence at end of document
    if (inFence) {
      regions.push({
        startChar: fenceStart,
        endChar: text.length,
        language: fenceLanguage,
      });
    }

    return regions;
  }

  /**
   * Check if an offset is inside any fenced region.
   *
   * @param offset - Character offset to check
   * @param regions - Array of fenced regions (from detect())
   * @returns True if offset is inside a fence (inclusive start, exclusive end)
   */
  isInsideFence(offset: number, regions: FencedRegion[]): boolean {
    for (const region of regions) {
      if (offset >= region.startChar && offset < region.endChar) {
        return true;
      }
    }
    return false;
  }

  /**
   * Match a fence opening line.
   * Returns null if the line doesn't start with a valid fence.
   */
  private matchFenceOpen(
    line: string,
  ): { char: string; length: number; language: string | null; isAtLineStart: boolean } | null {
    // Check for leading whitespace (max 3 spaces per CommonMark)
    const leadingWhitespaceMatch = line.match(/^([ ]{0,3})/);
    const leadingWhitespace = leadingWhitespaceMatch ? leadingWhitespaceMatch[1]! : '';
    const afterWhitespace = line.slice(leadingWhitespace.length);

    // If there's content before the fence (other than allowed whitespace), it's not a valid fence
    // A fence must start at the beginning of the line (with optional 0-3 spaces)
    const isAtLineStart = line.length === 0 || line.startsWith(leadingWhitespace + '`') || line.startsWith(leadingWhitespace + '~');

    // Check for backticks
    const backtickMatch = afterWhitespace.match(/^(`{3,})([^\s`]*)?/);
    if (backtickMatch) {
      const fenceChars = backtickMatch[1]!;
      const lang = backtickMatch[2] || null;
      return {
        char: '`',
        length: fenceChars.length,
        language: lang && lang.length > 0 ? lang : null,
        isAtLineStart,
      };
    }

    // Check for tildes
    const tildeMatch = afterWhitespace.match(/^(~{3,})([^\s~]*)?/);
    if (tildeMatch) {
      const fenceChars = tildeMatch[1]!;
      const lang = tildeMatch[2] || null;
      return {
        char: '~',
        length: fenceChars.length,
        language: lang && lang.length > 0 ? lang : null,
        isAtLineStart,
      };
    }

    return null;
  }

  /**
   * Match a fence closing line.
   * The closing fence must use the same character and be at least as long.
   */
  private matchFenceClose(line: string, fenceChar: string, minLength: number): boolean {
    // Check for leading whitespace (max 3 spaces per CommonMark)
    const trimmed = line.replace(/^[ ]{0,3}/, '');

    // Build regex for closing fence
    const regex = new RegExp(`^${fenceChar === '`' ? '`' : '~'}{${minLength},}\\s*$`);
    return regex.test(trimmed);
  }
}

