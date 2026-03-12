/**
 * Gladia Audio Provider — 10 hours/month free with streaming.
 *
 * Uses a two-step API: upload → poll for result.
 */

import type { IAudioProvider, AudioProviderInfo, AudioModel, AudioProviderCapabilities, AudioConfigStatus, TranscribeOptions, TranscribeResult } from './types.js';
import { registerAudioProvider } from './registry.js';

const info: AudioProviderInfo = {
  id: 'audio-gladia',
  name: 'Gladia',
  icon: 'Globe',
  description: 'Most generous free tier: 10 hrs/month free with streaming and diarization.',
  website: 'https://gladia.io',
  envVarName: 'GLADIA_API_KEY',
  pricing: '10 hrs/month free, then ~$0.55/hr',
};

const models: AudioModel[] = [
  { id: 'default', label: 'Gladia Enhanced', description: 'Auto-selects best model for your audio.', isDefault: true },
];

const capabilities: AudioProviderCapabilities = {
  supportsStreaming: true,
  supportedLanguages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru', 'nl', 'pl', 'sv', 'tr', 'uk', 'vi'],
  supportedFormats: ['webm', 'wav', 'mp3', 'ogg', 'flac', 'm4a', 'mp4'],
  maxFileSizeMB: 500,
  supportsDiarization: true,
  supportsTimestamps: true,
};

function getApiKey(): string | undefined {
  return process.env.GLADIA_API_KEY;
}

/** Map MIME type to extension. */
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
    if (!key) return { configured: false, reason: 'GLADIA_API_KEY not set' };
    return { configured: true };
  },

  async transcribe(options: TranscribeOptions): Promise<TranscribeResult> {
    const apiKey = getApiKey();
    if (!apiKey) throw new Error('GLADIA_API_KEY is not configured');

    const ext = mimeToExt(options.mimeType);

    // Step 1: Upload audio file
    const boundary = '----AudioBoundary' + Date.now();
    const parts: Buffer[] = [];

    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.${ext}"\r\nContent-Type: ${options.mimeType.split(';')[0]}\r\n\r\n`,
    ));
    parts.push(options.audio);
    parts.push(Buffer.from('\r\n'));
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const uploadBody = Buffer.concat(parts);

    const uploadResp = await fetch('https://api.gladia.io/v2/upload', {
      method: 'POST',
      headers: {
        'x-gladia-key': apiKey,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: uploadBody,
      signal: AbortSignal.timeout(60000),
    });

    if (!uploadResp.ok) {
      const err = await uploadResp.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(`Gladia upload failed: ${(err.message as string) || `HTTP ${uploadResp.status}`}`);
    }

    const uploadData = await uploadResp.json() as { audio_url?: string };
    if (!uploadData.audio_url) throw new Error('Gladia upload did not return audio_url');

    // Step 2: Request transcription
    const transcribeBody: Record<string, unknown> = {
      audio_url: uploadData.audio_url,
    };
    if (options.language) {
      transcribeBody.language = options.language;
    } else {
      transcribeBody.detect_language = true;
    }

    const transcribeResp = await fetch('https://api.gladia.io/v2/transcription', {
      method: 'POST',
      headers: {
        'x-gladia-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(transcribeBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!transcribeResp.ok) {
      const err = await transcribeResp.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(`Gladia transcription request failed: ${(err.message as string) || `HTTP ${transcribeResp.status}`}`);
    }

    const transcribeData = await transcribeResp.json() as { result_url?: string; id?: string };
    const resultUrl = transcribeData.result_url;
    if (!resultUrl) throw new Error('Gladia did not return result_url');

    // Step 3: Poll for result
    const maxWait = 120000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const pollResp = await fetch(resultUrl, {
        headers: { 'x-gladia-key': apiKey },
        signal: AbortSignal.timeout(30000),
      });

      if (!pollResp.ok) throw new Error(`Gladia poll failed: HTTP ${pollResp.status}`);

      const pollData = await pollResp.json() as {
        status?: string;
        result?: {
          transcription?: {
            full_transcript?: string;
            languages?: { language?: string }[];
            utterances?: { start: number; end: number; text: string }[];
          };
          metadata?: { audio_duration?: number };
        };
      };

      if (pollData.status === 'done' && pollData.result) {
        const transcription = pollData.result.transcription;
        return {
          text: transcription?.full_transcript || '',
          language: transcription?.languages?.[0]?.language,
          duration: pollData.result.metadata?.audio_duration,
          segments: transcription?.utterances?.map(u => ({
            start: u.start,
            end: u.end,
            text: u.text,
          })),
        };
      }

      if (pollData.status === 'error') {
        throw new Error('Gladia transcription failed');
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    throw new Error('Gladia transcription timed out');
  },
};

registerAudioProvider(provider);
export default provider;
