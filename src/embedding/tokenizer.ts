/**
 * BgeM3Tokenizer
 *
 * Tokenizer for bge-m3 embedding model.
 * Uses @xenova/transformers for tokenization when model is loaded,
 * falls back to approximate counting when not loaded.
 */

/**
 * Approximate token count based on character length.
 * ~4 characters per token for BERT-based tokenizers.
 */
export function approximateTokenCount(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export interface TokenizerEncodeResult {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
  tokenCount: number;
}

/**
 * Tokenizer for bge-m3 model.
 * Supports both loaded mode (accurate) and fallback mode (approximate).
 */
export class BgeM3Tokenizer {
  private _isLoaded = false;
  private tokenizer: any = null; // @xenova/transformers tokenizer

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  /**
   * Load tokenizer from HuggingFace tokenizer.json file.
   * Uses @xenova/transformers for tokenization.
   *
   * @param tokenizerPath - Either a HuggingFace model ID (e.g., "BAAI/bge-m3")
   *                        or a local directory path containing tokenizer.json
   */
  async load(tokenizerPath: string): Promise<void> {
    try {
      // Dynamic import to avoid loading transformers if not needed
      const transformers = await import('@xenova/transformers');
      const { AutoTokenizer, env } = transformers;

      // Check if it's a local path (starts with / or contains path separators)
      const isLocalPath = tokenizerPath.startsWith('/') || tokenizerPath.includes('\\');

      if (isLocalPath) {
        // For local paths, configure env to use local models
        env.localModelPath = tokenizerPath;
        env.allowRemoteModels = false;
        env.allowLocalModels = true;

        // Load using empty string since localModelPath is set
        this.tokenizer = await AutoTokenizer.from_pretrained('');
      } else {
        // Load from HuggingFace model ID
        this.tokenizer = await AutoTokenizer.from_pretrained(tokenizerPath);
      }

      this._isLoaded = true;
    } catch (error) {
      throw new Error(`Failed to load tokenizer: ${error}`);
    }
  }

  /**
   * Count tokens in text.
   * Uses accurate count if loaded, approximate otherwise.
   */
  countTokens(text: string): number {
    if (!this._isLoaded || !this.tokenizer) {
      return approximateTokenCount(text);
    }

    try {
      const encoded = this.tokenizer.encode(text);
      return encoded.length;
    } catch {
      return approximateTokenCount(text);
    }
  }

  /**
   * Encode text to token IDs.
   * Requires tokenizer to be loaded.
   */
  encode(text: string, maxLength: number = 8192): TokenizerEncodeResult {
    if (!this._isLoaded || !this.tokenizer) {
      throw new Error('Tokenizer not loaded. Call load() first.');
    }

    const encoded = this.tokenizer(text, {
      padding: false,
      truncation: true,
      max_length: maxLength,
      return_tensors: false,
    });

    // Handle both array and Tensor formats from transformers.js
    const toArray = (data: any): number[] => {
      if (Array.isArray(data)) return data;
      if (data?.data) return Array.from(data.data);
      if (data?.tolist) return data.tolist();
      return Array.from(data);
    };

    const inputIds = toArray(encoded.input_ids);
    const attentionMask = toArray(encoded.attention_mask);
    const tokenTypeIds = encoded.token_type_ids
      ? toArray(encoded.token_type_ids)
      : new Array(inputIds.length).fill(0);

    return {
      inputIds: BigInt64Array.from(inputIds.map((id: number) => BigInt(id))),
      attentionMask: BigInt64Array.from(attentionMask.map((m: number) => BigInt(m))),
      tokenTypeIds: BigInt64Array.from(tokenTypeIds.map((t: number) => BigInt(t))),
      tokenCount: inputIds.length,
    };
  }
}

