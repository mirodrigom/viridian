import { Router } from 'express';
import { spawn } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { authMiddleware } from '../middleware/auth.js';
import { getHomeDir, getDefaultShell, isWindows, isWSLAvailable } from '../utils/platform.js';
import { getProviderDTOs, getProvider } from '../providers/registry.js';
import { saveProviderConfig, getProviderConfig, deleteProviderEnvVar } from '../db/database.js';
import type { ProviderId } from '../providers/types.js';

// Ensure all providers are registered (side-effect imports)
import '../providers/claude.js';
import '../providers/gemini.js';
import '../providers/codex.js';
import '../providers/aider.js';
import '../providers/kiro.js';
import '../providers/qwen.js';
import '../providers/opencode.js';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

/** GET /api/providers — List all registered providers with availability status. */
router.get('/', (_req, res) => {
  res.json(getProviderDTOs());
});

/** GET /api/providers/:id — Single provider details. */
router.get('/:id', (req, res) => {
  try {
    const provider = getProvider(req.params.id as ProviderId);
    let available = false;
    try { available = provider.isAvailable(); } catch { /* not available */ }

    let configured = true;
    try { configured = provider.isConfigured().configured; } catch { /* assume configured */ }

    res.json({
      id: provider.info.id,
      name: provider.info.name,
      icon: provider.info.icon,
      description: provider.info.description,
      website: provider.info.website,
      models: provider.models,
      capabilities: provider.capabilities,
      available,
      configured,
      installCommand: provider.info.installCommand,
    });
  } catch {
    res.status(404).json({ error: `Provider "${req.params.id}" not found` });
  }
});

/**
 * GET /api/providers/:id/config — Return masked env var values for a provider.
 * Values are shown as first4****last4 so users can verify which key is stored.
 */
router.get('/:id/config', (req, res) => {
  const config = getProviderConfig(req.params.id as ProviderId);
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value) {
      masked[key] = value.length > 8
        ? `${value.slice(0, 4)}****${value.slice(-4)}`
        : '****';
    }
  }
  res.json(masked);
});

/**
 * DELETE /api/providers/:id/config — Remove a stored env var for a provider.
 * Body: { envVarName: string }
 */
router.delete('/:id/config', (req, res) => {
  const id = req.params.id as ProviderId;
  const { envVarName } = req.body as { envVarName?: string };

  // Determine which var to delete if not explicitly provided
  const SINGLE_KEY_MAP: Record<string, string> = {
    gemini: 'GEMINI_API_KEY',
    codex: 'OPENAI_API_KEY',
    qwen: 'DASHSCOPE_API_KEY',
  };

  const varName = envVarName || SINGLE_KEY_MAP[id];
  if (!varName) {
    res.status(400).json({ error: 'envVarName is required' });
    return;
  }

  deleteProviderEnvVar(id, varName);
  res.json({ success: true });
});

/** GET /api/providers/:id/status — Check if binary is available + version info. */
router.get('/:id/status', (req, res) => {
  try {
    const provider = getProvider(req.params.id as ProviderId);
    let available = false;
    let binaryPath: string | undefined;
    let error: string | undefined;

    try {
      binaryPath = provider.findBinary();
      available = true;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Binary not found';
    }

    res.json({ available, binaryPath, error });
  } catch {
    res.status(404).json({ error: `Provider "${req.params.id}" not found` });
  }
});

/** POST /api/providers/:id/install — Run the provider's install command. */
router.post('/:id/install', (req, res) => {
  try {
    const provider = getProvider(req.params.id as ProviderId);

    // Already installed?
    if (provider.isAvailable()) {
      res.json({ success: true, output: `${provider.info.name} is already installed.` });
      return;
    }

    const cmd = (isWindows && provider.info.windowsInstallCommand)
      ? provider.info.windowsInstallCommand
      : provider.info.installCommand;

    // Check if the Windows command requires WSL and it's not available
    if (isWindows && cmd.startsWith('wsl ') && !isWSLAvailable()) {
      res.status(500).json({
        success: false,
        output: `${provider.info.name} requires WSL (Windows Subsystem for Linux) to install on Windows.\n\nTo set up WSL, run in PowerShell as Administrator:\n  wsl --install\n\nThen restart your computer and try again.`,
      });
      return;
    }

    const shell = getDefaultShell();
    const shellArgs = isWindows && !shell.includes('bash') ? ['/c', cmd] : ['-c', cmd];
    const proc = spawn(shell, shellArgs, {
      env: { ...process.env, HOME: getHomeDir() },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately so commands like sudo -n fail fast instead of hanging
    proc.stdin.end();

    let output = '';
    proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });

    proc.on('close', (code) => {
      // Clear cached binary path so isAvailable() re-checks
      try { provider.findBinary(); } catch { /* expected if still not found */ }

      if (code === 0) {
        res.json({ success: true, output });
      } else {
        res.status(500).json({ success: false, output, exitCode: code });
      }
    });

    proc.on('error', (err) => {
      res.status(500).json({ success: false, output: err.message });
    });

    // If client disconnects, kill the install process
    req.on('close', () => {
      if (!res.writableEnded) {
        try { proc.kill(); } catch { /* already dead */ }
      }
    });
  } catch {
    res.status(404).json({ error: `Provider "${req.params.id}" not found` });
  }
});

/**
 * POST /api/providers/:id/configure — Save API key credentials for a provider.
 * Body: { apiKey: string, envVarName?: string }
 * `envVarName` is used by multi-backend providers (Aider) to specify which key to set.
 */
router.post('/:id/configure', (req, res) => {
  try {
    const provider = getProvider(req.params.id as ProviderId);
    const { apiKey, envVarName } = req.body as { apiKey?: string; envVarName?: string };

    if (!apiKey?.trim()) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }

    const id = provider.info.id;
    const home = getHomeDir();

    if (id === 'gemini') {
      saveProviderConfig('gemini', { GEMINI_API_KEY: apiKey.trim() });
      // Write settings.json so CLI knows to use API key auth
      const geminiDir = join(home, '.gemini');
      mkdirSync(geminiDir, { recursive: true });
      const settingsPath = join(geminiDir, 'settings.json');
      let existing: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>; } catch { /* fresh */ }
      }
      writeFileSync(settingsPath, JSON.stringify({ ...existing, selectedAuthType: 'gemini-api-key' }, null, 2));
      res.json({ success: true });
      return;
    }

    if (id === 'codex') {
      saveProviderConfig('codex', { OPENAI_API_KEY: apiKey.trim() });
      res.json({ success: true });
      return;
    }

    if (id === 'aider') {
      // Aider supports multiple backends; caller specifies which env var to set
      const validVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY'];
      const varName = envVarName && validVars.includes(envVarName) ? envVarName : 'ANTHROPIC_API_KEY';
      saveProviderConfig('aider', { [varName]: apiKey.trim() });
      res.json({ success: true });
      return;
    }

    if (id === 'qwen') {
      saveProviderConfig('qwen', { DASHSCOPE_API_KEY: apiKey.trim() });
      // Write settings.json so CLI knows to use API key auth
      const qwenDir = join(home, '.qwen');
      mkdirSync(qwenDir, { recursive: true });
      const settingsPath = join(qwenDir, 'settings.json');
      let existing: Record<string, unknown> = {};
      if (existsSync(settingsPath)) {
        try { existing = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>; } catch { /* fresh */ }
      }
      writeFileSync(settingsPath, JSON.stringify({ ...existing, selectedAuthType: 'api-key' }, null, 2));
      res.json({ success: true });
      return;
    }

    if (id === 'opencode') {
      // OpenCode picks up standard provider env vars automatically
      const validVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];
      const varName = envVarName && validVars.includes(envVarName) ? envVarName : 'ANTHROPIC_API_KEY';
      saveProviderConfig('opencode', { [varName]: apiKey.trim() });
      res.json({ success: true });
      return;
    }

    res.status(400).json({ error: `Provider "${id}" does not support API key configuration via this endpoint.` });
  } catch {
    res.status(404).json({ error: `Provider "${req.params.id}" not found` });
  }
});

/**
 * POST /api/providers/:id/test — Test stored credentials against each provider model.
 * Body (optional): { envVarName: string } — for multi-backend providers (Aider, OpenCode).
 * Returns: { success: boolean, message: string, models: ModelTestResult[] }
 * success = true if ANY model passed. models[] has one entry per model tested.
 */
router.post('/:id/test', async (req, res) => {
  type ModelTestResult = { id: string; label: string; success: boolean; message: string };

  // Generic REST test for a single (model, url, headers, body)
  async function testOneModel(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    extract: (d: unknown) => string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (!resp.ok) {
        const err = await resp.json() as Record<string, unknown>;
        const msg = (err.error as { message?: string } | undefined)?.message
          || (err.message as string | undefined)
          || `HTTP ${resp.status}`;
        return { success: false, message: msg };
      }
      const data = await resp.json();
      return { success: true, message: `"${extract(data).trim().slice(0, 60)}"` };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Request failed' };
    }
  }

  // Test every Gemini model individually (they have different billing tiers)
  async function testGeminiModels(apiKey: string): Promise<ModelTestResult[]> {
    const models = [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ];
    const results: ModelTestResult[] = [];
    for (const m of models) {
      const r = await testOneModel(
        `https://generativelanguage.googleapis.com/v1beta/models/${m.id}:generateContent?key=${apiKey}`,
        { 'Content-Type': 'application/json' },
        { contents: [{ parts: [{ text: 'Say hi' }] }] },
        (d) => (d as { candidates?: [{ content?: { parts?: [{ text?: string }] } }] })
          .candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      );
      results.push({ ...m, ...r });
    }
    return results;
  }

  // Single-model test helpers for other providers
  async function testAnthropicKey(apiKey: string): Promise<{ success: boolean; message: string }> {
    return testOneModel(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      { model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Say hi' }] },
      (d) => (d as { content?: [{ text?: string }] }).content?.[0]?.text ?? '',
    );
  }

  async function testOpenAIKey(apiKey: string): Promise<{ success: boolean; message: string }> {
    return testOneModel(
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      { model: 'gpt-4o-mini', max_tokens: 10, messages: [{ role: 'user', content: 'Say hi' }] },
      (d) => (d as { choices?: [{ message?: { content?: string } }] }).choices?.[0]?.message?.content ?? '',
    );
  }

  async function testDeepSeekKey(apiKey: string): Promise<{ success: boolean; message: string }> {
    return testOneModel(
      'https://api.deepseek.com/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      { model: 'deepseek-chat', max_tokens: 10, messages: [{ role: 'user', content: 'Say hi' }] },
      (d) => (d as { choices?: [{ message?: { content?: string } }] }).choices?.[0]?.message?.content ?? '',
    );
  }

  async function testDashScopeKey(apiKey: string): Promise<{ success: boolean; message: string }> {
    return testOneModel(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      { model: 'qwen-turbo', max_tokens: 10, messages: [{ role: 'user', content: 'Say hi' }] },
      (d) => (d as { choices?: [{ message?: { content?: string } }] }).choices?.[0]?.message?.content ?? '',
    );
  }

  function toResponse(models: ModelTestResult[]) {
    const success = models.some(m => m.success);
    const first = models[0];
    const message = first ? (first.success ? first.message : first.message) : '';
    return { success, message, models };
  }

  try {
    const id = req.params.id as ProviderId;
    const { envVarName } = req.body as { envVarName?: string };
    const config = getProviderConfig(id);

    // Claude — CLI OAuth, no REST key to test
    if (id === 'claude') {
      try {
        getProvider('claude').findBinary();
        res.json({ success: true, message: 'Claude CLI is installed and authenticated.', models: [] });
      } catch {
        res.json({ success: false, message: 'Claude CLI not found. Run `npm install -g @anthropic-ai/claude-code` then `claude` to authenticate.', models: [] });
      }
      return;
    }

    // Kiro — AWS credentials, no simple REST test
    if (id === 'kiro') {
      res.json({ success: true, message: 'Kiro uses AWS credentials managed externally. Start a session to verify.', models: [] });
      return;
    }

    // Gemini — test each model individually (different billing tiers)
    if (id === 'gemini') {
      const apiKey = config['GEMINI_API_KEY'];
      if (!apiKey) {
        res.json({ success: false, message: 'No API key configured for gemini.', models: [] });
        return;
      }
      res.json(toResponse(await testGeminiModels(apiKey)));
      return;
    }

    // Codex — single connection test (billing is per-account not per-model)
    if (id === 'codex') {
      const apiKey = config['OPENAI_API_KEY'];
      if (!apiKey) {
        res.json({ success: false, message: 'No API key configured for codex.', models: [] });
        return;
      }
      const r = await testOpenAIKey(apiKey);
      res.json(toResponse([{ id: 'connection', label: 'API Connection', ...r }]));
      return;
    }

    // Qwen
    if (id === 'qwen') {
      const apiKey = config['DASHSCOPE_API_KEY'];
      if (!apiKey) {
        res.json({ success: false, message: 'No API key configured for qwen.', models: [] });
        return;
      }
      const r = await testDashScopeKey(apiKey);
      res.json(toResponse([{ id: 'connection', label: 'API Connection', ...r }]));
      return;
    }

    // Multi-backend providers (aider, opencode)
    if (id === 'aider' || id === 'opencode') {
      const validVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'DEEPSEEK_API_KEY'];
      const varName = envVarName && validVars.includes(envVarName)
        ? envVarName
        : validVars.find(v => config[v]);
      if (!varName || !config[varName]) {
        res.json({ success: false, message: 'No API key configured. Set a key first.', models: [] });
        return;
      }
      const apiKey = config[varName]!;
      let r: { success: boolean; message: string };
      if (varName === 'ANTHROPIC_API_KEY') r = await testAnthropicKey(apiKey);
      else if (varName === 'GEMINI_API_KEY') r = await testOpenAIKey(apiKey);
      else if (varName === 'DEEPSEEK_API_KEY') r = await testDeepSeekKey(apiKey);
      else r = await testOpenAIKey(apiKey);
      res.json(toResponse([{ id: 'connection', label: 'API Connection', ...r }]));
      return;
    }

    res.json({ success: false, message: `No test available for provider "${id}".` });
  } catch (err) {
    res.status(500).json({ success: false, message: err instanceof Error ? err.message : 'Test failed' });
  }
});

export default router;
