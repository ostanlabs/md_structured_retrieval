/**
 * Markdown Parser
 *
 * Parses Markdown files into a heading tree structure.
 * Uses a simple line-by-line state machine, NOT a full Markdown AST library.
 */

import * as crypto from 'node:crypto';
import { FenceDetector } from './fence-detector.js';
import type { HeadingNode, HeadingTree } from '../types.js';
import { HEADING_PATH_SEPARATOR } from '../types.js';

/**
 * Regex to match ATX headings (# through ######).
 * Groups:
 * 1. The hash characters (1-6)
 * 2. The heading text (trimmed)
 */
const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

/**
 * Parses Markdown text into a heading tree.
 */
export class MarkdownParser {
  private fenceDetector = new FenceDetector();

  /**
   * Normalize file text for deterministic indexing.
   * - Normalize line endings to \n
   * - Strip BOM
   * - Ensure trailing newline
   * - Preserve all other content exactly
   */
  normalize(raw: string): string {
    let text = raw;

    // Strip BOM
    if (text.charCodeAt(0) === 0xfeff) {
      text = text.slice(1);
    }

    // Normalize line endings: CRLF -> LF, CR -> LF
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Ensure trailing newline
    if (!text.endsWith('\n')) {
      text += '\n';
    }

    return text;
  }

  /**
   * Parse normalized text into a heading tree.
   * Handles ATX headings only (# through ######).
   * Ignores headings inside fenced code blocks.
   */
  parseHeadings(docUri: string, normalizedText: string): HeadingTree {
    // Detect fenced regions to skip
    const fencedRegions = this.fenceDetector.detect(normalizedText);

    // Create virtual root node
    const root: HeadingNode = {
      nodeId: this.generateNodeId(docUri, ''),
      level: 0,
      title: '',
      headingPath: '',
      startChar: 0,
      endChar: normalizedText.length,
      children: [],
    };

    // Stack for building hierarchy: [level, node]
    const stack: Array<{ level: number; node: HeadingNode }> = [{ level: 0, node: root }];

    // Parse line by line
    const lines = normalizedText.split('\n');
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineStart = currentOffset;

      // Skip if inside a fenced code block
      if (!this.fenceDetector.isInsideFence(lineStart, fencedRegions)) {
        const match = line.match(HEADING_REGEX);
        if (match) {
          const level = match[1]!.length;
          const title = match[2]!.trim();

          // Build heading path by finding parent
          const headingPath = this.buildHeadingPath(stack, level, title);

          // Create new heading node
          const node: HeadingNode = {
            nodeId: this.generateNodeId(docUri, headingPath),
            level,
            title,
            headingPath,
            startChar: lineStart,
            endChar: normalizedText.length, // Will be updated when next sibling/parent found
            children: [],
          };

          // Pop stack until we find a parent (level < current)
          while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
            const popped = stack.pop()!;
            // Update endChar of popped node to current position
            popped.node.endChar = lineStart;
          }

          // Add as child of current top of stack
          const parent = stack[stack.length - 1]!;
          parent.node.children.push(node);

          // Push new node onto stack
          stack.push({ level, node });
        }
      }

      // Move to next line (+1 for newline, except for last line which has no trailing newline in split)
      currentOffset += line.length + 1;
    }

    return { docUri, root };
  }

  /**
   * Build the heading path for a new heading.
   */
  private buildHeadingPath(
    stack: Array<{ level: number; node: HeadingNode }>,
    newLevel: number,
    newTitle: string,
  ): string {
    // Find the parent (first node with level < newLevel)
    let parentPath = '';
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]!.level < newLevel) {
        parentPath = stack[i]!.node.headingPath;
        break;
      }
    }

    if (parentPath === '') {
      return newTitle;
    }
    return `${parentPath}${HEADING_PATH_SEPARATOR}${newTitle}`;
  }

  /**
   * Generate a deterministic node ID from docUri and headingPath.
   */
  private generateNodeId(docUri: string, headingPath: string): string {
    const input = `${docUri}:${headingPath}`;
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
  }
}

