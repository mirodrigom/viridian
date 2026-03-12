/**
 * Groq Audio Provider — Whisper models via Groq's ultra-fast inference API.
 *
 * Pricing: ~$0.04/hr (Whisper Large v3 Turbo) — cheapest cloud STT option.
 * Uses OpenAI-compatible /audio/transcriptions endpoint.
 */

import type { IAudioProvider, AudioProviderInfo, AudioModel, AudioProviderCapabilities, AudioConfigStatus, TranscribeOptions, TranscribeResult } from './types.js';
import { registerAudioProvider } from './registry.js';

const info: AudioProviderInfo = {
  id: 'audio-groq',
  name: 'Groq Whisper',
  icon: 'Zap',
  description: 'Ultra-fast Whisper transcription via Groq. Best price-to-quality ratio.',
  website: 'https://groq.com',
  envVarName: 'GROQ_API_KEY',
  pricing: '~$0.04/hr (Whisper Large v3 Turbo)',
};

const models: AudioModel[] = [
  { id: 'whisper-large-v3-turbo', label: 'Whisper Large v3 Turbo', description: 'Fast, multilingual, great accuracy. 6x faster than v3.', isDefault: true },
  { id: 'whisper-large-v3', label: 'Whisper Large v3', description: 'Highest accuracy Whisper model. $0.111/hr.' },
  { id: 'distil-whisper-large-v3-en', label: 'Distil Whisper (EN only)', description: 'English-only, ultra-cheap at $0.02/hr.' },
];

const capabilities: AudioProviderCapabilities = {
  supportsStreaming: false,
  supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'nl', 'pl', 'sv', 'tr', 'uk', 'vi'],
  supportedFormats: ['webm', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'mp4', 'mpeg', 'mpga'],
  maxFileSizeMB: 25,
  supportsDiarization: false,
  supportsTimestamps: true,
};

function getApiKey(): string | undefined {
  return process.env.GROQ_API_KEY;
}

/** Map common browser MIME to a file extension Groq accepts. */
function mimeToExt(mime: string): string {
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp3') || mime.includes('mpeg')) return 'mp3';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('flac')) return 'flac';
  return 'webm';
}

const provider: IAudioProvider = {
  info,
  models,
  capabilities,

  isConfigured(): AudioConfigStatus {
    const key = getApiKey();
    if (!key) return { configured: false, reason: 'GROQ_API_KEY not set' };
    return { configured: true };
  },

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

    const model = options.model || 'whisper-large-v3-turbo';
    const ext = mimeToExt(options.mimeType);

    // Build multipart form data
    const boundary = '----AudioBoundary' + Date.now();
    const parts: Buffer[] = [];

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${options.mimeType.split(';')[0]}\r\n\r\n`,
    ));
    parts.push(options.audio);
    parts.push(Buffer.from('\r\n'));

    // Model part
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`,
    ));

    // Language part (optional)
    if (options.language) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${options.language}\r\n`,
      ));
    }

    // Prompt part (optional)
    if (options.prompt) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${options.prompt}\r\n`,
      ));
    }

    // Response format — verbose_json for segments
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`,
    ));

    parts.push(Buffer.from(`--${boundary}--\r\n`));
    const body = Buffer.concat(parts);

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(60000),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
      const msg = (err.error as { message?: string })?.message || `HTTP ${resp.status}`;
      throw new Error(`Groq transcription failed: ${msg}`);
    }

    const data = await resp.json() as {
      text: string;
      language?: string;
      duration?: number;
      segments?: { start: number; end: number; text: string }[];
    };

    return {
      text: data.text,
      language: data.language,
      duration: data.duration,
      segments: data.segments?.map(s => ({ start: s.start, end: s.end, text: s.text })),
    };
  },
};

registerAudioProvider(provider);
export default provider;
