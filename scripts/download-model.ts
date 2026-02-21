#!/usr/bin/env npx tsx
/**
 * Download BGE-M3 ONNX model files from HuggingFace.
 *
 * Usage:
 *   npx tsx scripts/download-model.ts [--target-dir <path>]
 *
 * Default target: ~/.msrl/models/bge-m3
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import * as crypto from 'node:crypto';

const MODEL_FILES = [
  {
    name: 'model.onnx',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/model.onnx',
    size: 725_000, // ~725 KB
  },
  {
    name: 'model.onnx_data',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/model.onnx_data',
    size: 2_270_000_000, // ~2.27 GB
  },
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/tokenizer.json',
    size: 17_100_000, // ~17.1 MB
  },
  {
    name: 'tokenizer_config.json',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/tokenizer_config.json',
    size: 1_200, // ~1.2 KB
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function downloadFile(
  url: string,
  targetPath: string,
  expectedSize: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(targetPath);
    let downloaded = 0;
    let lastProgress = 0;

    const request = (currentUrl: string) => {
      const urlObj = new URL(currentUrl);
      https
        .get(currentUrl, { headers: { 'User-Agent': 'msrl/0.1.0' } }, (response) => {
          // Handle redirects (301, 302, 307, 308)
          if ([301, 302, 307, 308].includes(response.statusCode || 0)) {
            let redirectUrl = response.headers.location;
            if (redirectUrl) {
              // Handle relative URLs
              if (redirectUrl.startsWith('/')) {
                redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
              }
              request(redirectUrl);
              return;
            }
          }

          if (response.statusCode !== 200) {
            file.close();
            fs.unlinkSync(targetPath);
            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
            return;
          }

          const total = parseInt(response.headers['content-length'] || String(expectedSize), 10);

          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            const progress = Math.floor((downloaded / total) * 100);
            if (progress > lastProgress) {
              lastProgress = progress;
              process.stdout.write(`\r  Progress: ${progress}% (${formatBytes(downloaded)} / ${formatBytes(total)})`);
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log(); // New line after progress
            resolve();
          });
        })
        .on('error', (err) => {
          file.close();
          if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
          reject(err);
        });
    };

    request(url);
  });
}

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  let targetDir = path.join(os.homedir(), '.msrl', 'models', 'bge-m3');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target-dir' && args[i + 1]) {
      targetDir = args[i + 1]!;
      i++;
    }
  }

  console.log(`\n🚀 Downloading BGE-M3 ONNX model to: ${targetDir}\n`);

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  const totalSize = MODEL_FILES.reduce((sum, f) => sum + f.size, 0);
  console.log(`Total download size: ~${formatBytes(totalSize)}\n`);

  for (const file of MODEL_FILES) {
    const targetPath = path.join(targetDir, file.name);

    // Check if file already exists
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (Math.abs(stat.size - file.size) < file.size * 0.1) {
        // Within 10% of expected size
        console.log(`✓ ${file.name} already exists (${formatBytes(stat.size)})`);
        continue;
      }
    }

    console.log(`⬇ Downloading ${file.name} (~${formatBytes(file.size)})...`);
    await downloadFile(file.url, targetPath, file.size);
    console.log(`✓ ${file.name} downloaded`);
  }

  console.log(`\n✅ Model downloaded successfully to: ${targetDir}`);
  console.log(`\nTo use in tests, set environment variable:`);
  console.log(`  export MSRL_MODEL_PATH="${targetDir}"\n`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

