/**
 * Vitest Global Setup
 *
 * Downloads the ONNX model if not present and sets up environment variables.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';

const MODEL_DIR = path.join(os.homedir(), '.msrl', 'models', 'bge-m3');

const MODEL_FILES = [
  {
    name: 'model.onnx',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/model.onnx',
    size: 725_000,
  },
  {
    name: 'model.onnx_data',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/model.onnx_data',
    size: 2_270_000_000,
  },
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/tokenizer.json',
    size: 17_100_000,
  },
  {
    name: 'tokenizer_config.json',
    url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/tokenizer_config.json',
    size: 1_200,
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function downloadFile(url: string, targetPath: string, expectedSize: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(targetPath);
    let downloaded = 0;
    let lastProgress = 0;

    const request = (currentUrl: string) => {
      const urlObj = new URL(currentUrl);
      https
        .get(currentUrl, { headers: { 'User-Agent': 'msrl/0.1.0' } }, (response) => {
          if ([301, 302, 307, 308].includes(response.statusCode || 0)) {
            let redirectUrl = response.headers.location;
            if (redirectUrl) {
              if (redirectUrl.startsWith('/')) {
                redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
              }
              request(redirectUrl);
              return;
            }
          }

          if (response.statusCode !== 200) {
            file.close();
            if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
            return;
          }

          const total = parseInt(response.headers['content-length'] || String(expectedSize), 10);

          response.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            const progress = Math.floor((downloaded / total) * 100);
            if (progress > lastProgress && progress % 10 === 0) {
              lastProgress = progress;
              console.log(`  Progress: ${progress}% (${formatBytes(downloaded)} / ${formatBytes(total)})`);
            }
          });

          response.pipe(file);

          file.on('finish', () => {
            file.close();
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

function isModelPresent(): boolean {
  for (const file of MODEL_FILES) {
    const filePath = path.join(MODEL_DIR, file.name);
    if (!fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    // Check if file size is within 10% of expected
    if (Math.abs(stat.size - file.size) > file.size * 0.1) return false;
  }
  return true;
}

export async function setup() {
  // Set the model path environment variable
  process.env.MSRL_MODEL_PATH = MODEL_DIR;

  if (isModelPresent()) {
    console.log(`\n✓ ONNX model already present at: ${MODEL_DIR}\n`);
    return;
  }

  console.log(`\n🚀 Downloading BGE-M3 ONNX model to: ${MODEL_DIR}`);
  console.log(`   This is a one-time download (~2.3 GB)\n`);

  fs.mkdirSync(MODEL_DIR, { recursive: true });

  for (const file of MODEL_FILES) {
    const targetPath = path.join(MODEL_DIR, file.name);

    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (Math.abs(stat.size - file.size) < file.size * 0.1) {
        console.log(`✓ ${file.name} already exists (${formatBytes(stat.size)})`);
        continue;
      }
    }

    console.log(`⬇ Downloading ${file.name} (~${formatBytes(file.size)})...`);
    await downloadFile(file.url, targetPath, file.size);
    console.log(`✓ ${file.name} downloaded`);
  }

  console.log(`\n✅ Model downloaded successfully\n`);
}

