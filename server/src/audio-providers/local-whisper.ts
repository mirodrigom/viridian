/**
 * Local Whisper Audio Provider — Self-hosted Whisper via Docker.
 *
 * Runs locally using faster-whisper-server or any OpenAI-compatible Whisper API.
 * Docker: docker run -p 8000:8000 fedirz/faster-whisper-server
 *
 * Free, private, no data leaves your machine.
 */

import type { IAudioProvider, AudioProviderInfo, AudioModel, AudioProviderCapabilities, AudioConfigStatus, TranscribeOptions, TranscribeResult } from './types.js';
import { registerAudioProvider } from './registry.js';

const info: AudioProviderInfo = {
  id: 'audio-local-whisper',
  name: 'Local Whisper',
  icon: 'HardDrive',
  description: 'Self-hosted Whisper via Docker. Free, private — no data leaves your machine.',
  website: 'https://github.com/fedirz/faster-whisper-server',
  envVarName: 'LOCAL_WHISPER_URL',
  configLabel: 'Server URL',
  pricing: 'Free (self-hosted)',
};

const models: AudioModel[] = [
  { id: 'Systran/faster-whisper-large-v3', label: 'Large v3', description: 'Highest accuracy, requires ~4GB VRAM or 8GB RAM.' },
  { id: 'Systran/faster-whisper-medium', label: 'Medium', description: 'Good balance of speed and accuracy.' },
  { id: 'Systran/faster-whisper-small', label: 'Small', description: 'Fast, lower resource usage.', isDefault: true },
  { id: 'Systran/faster-whisper-base', label: 'Base', description: 'Lightweight, good for quick transcription.' },
  { id: 'Systran/faster-whisper-tiny', label: 'Tiny', description: 'Fastest, minimal resources. Lower accuracy.' },
];

const capabilities: AudioProviderCapabilities = {
  supportsStreaming: false,
  supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'nl', 'pl', 'sv', 'tr', 'uk', 'vi'],
  supportedFormats: ['webm', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'mp4', 'mpeg', 'mpga'],
  maxFileSizeMB: 100,
  supportsDiarization: false,
  supportsTimestamps: true,
};

function getBaseUrl(): string | undefined {
  return process.env.LOCAL_WHISPER_URL;
}

/** Map common browser MIME to a file extension. */
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
    const url = getBaseUrl();
    if (!url) return { configured: false, reason: 'Server URL not set. Run: docker run -p 8000:8000 fedirz/faster-whisper-server' };
    return { configured: true };
  },

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    const baseUrl = getBaseUrl();
    if (!baseUrl) throw new Error('Local Whisper server URL is not configured');

    const model = options.model || 'Systran/faster-whisper-small';
    const ext = mimeToExt(options.mimeType);

    // Build multipart form data (OpenAI-compatible endpoint)
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

    // Normalize URL: strip trailing slash, append /v1/audio/transcriptions
    const url = baseUrl.replace(/\/+$/, '') + '/v1/audio/transcriptions';

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
      signal: AbortSignal.timeout(120000), // Local can be slower, allow 2 minutes
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      throw new Error(`Local Whisper transcription failed (HTTP ${resp.status}): ${err.slice(0, 200)}`);
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
