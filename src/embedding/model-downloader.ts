/**
 * Model Downloader
 *
 * Downloads embedding model files from HuggingFace on first run.
 * Verifies SHA256 hashes after download.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import * as https from 'node:https';

export interface ModelFile {
  name: string;
  url: string;
  sha256: string;
}

export interface ModelManifestEntry {
  files: ModelFile[];
  totalSize: number;
}

/**
 * Model manifest with download URLs and hashes.
 * Note: SHA256 hashes are placeholders - update with actual hashes after verification.
 */
export const MODEL_MANIFEST: Record<string, ModelManifestEntry> = {
  'bge-m3-int8': {
    files: [
      {
        name: 'model.onnx',
        url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/onnx/model_quantized.onnx',
        sha256: 'a'.repeat(64), // Placeholder - update with actual hash
      },
      {
        name: 'tokenizer.json',
        url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/tokenizer.json',
        sha256: 'b'.repeat(64), // Placeholder - update with actual hash
      },
      {
        name: 'tokenizer_config.json',
        url: 'https://huggingface.co/BAAI/bge-m3/resolve/main/tokenizer_config.json',
        sha256: 'c'.repeat(64), // Placeholder - update with actual hash
      },
    ],
    totalSize: 615_000_000, // ~615MB
  },
};

export interface DownloadOptions {
  onProgress?: (downloaded: number, total: number) => void;
  skipDownload?: boolean; // For testing
}

/**
 * Get the default model path in the user's home directory.
 */
export function getDefaultModelPath(modelName: string): string {
  return path.join(os.homedir(), '.msrl', 'models', modelName);
}

/**
 * Verify a file's SHA256 hash.
 */
export async function verifyFileHash(filePath: string, expectedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => {
      const actualHash = hash.digest('hex');
      resolve(actualHash === expectedHash);
    });
    stream.on('error', reject);
  });
}

/**
 * Download a file from URL to target path.
 */
async function downloadFile(
  url: string,
  targetPath: string,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(targetPath);
    let downloaded = 0;

    https
      .get(url, { headers: { 'User-Agent': 'msrl/0.1.0' } }, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            file.close();
            fs.unlinkSync(targetPath);
            downloadFile(redirectUrl, targetPath, onProgress).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(targetPath);
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const total = parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (onProgress) onProgress(downloaded, total);
        });

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });
      })
      .on('error', (err) => {
        file.close();
        fs.unlinkSync(targetPath);
        reject(err);
      });
  });
}

/**
 * Ensure model files are downloaded and verified.
 */
export async function ensureModelDownloaded(
  modelName: string,
  targetDir: string,
  options: DownloadOptions = {},
): Promise<void> {
  const manifest = MODEL_MANIFEST[modelName];
  if (!manifest) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });

  if (options.skipDownload) {
    return; // For testing
  }

  for (const file of manifest.files) {
    const targetPath = path.join(targetDir, file.name);

    // Check if file exists with correct hash
    if (fs.existsSync(targetPath)) {
      const valid = await verifyFileHash(targetPath, file.sha256);
      if (valid) continue; // File is good
      fs.unlinkSync(targetPath); // Hash mismatch, re-download
    }

    // Download file
    await downloadFile(file.url, targetPath, options.onProgress);

    // Verify hash
    const valid = await verifyFileHash(targetPath, file.sha256);
    if (!valid) {
      fs.unlinkSync(targetPath);
      throw new Error(`Hash verification failed for ${file.name}`);
    }
  }
}

