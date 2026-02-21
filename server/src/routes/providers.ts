import { Router } from 'express';
import { spawn } from 'child_process';
import { authMiddleware } from '../middleware/auth.js';
import { getProviderDTOs, getProvider } from '../providers/registry.js';
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

    res.json({
      id: provider.info.id,
      name: provider.info.name,
      icon: provider.info.icon,
      description: provider.info.description,
      website: provider.info.website,
      models: provider.models,
      capabilities: provider.capabilities,
      available,
      installCommand: provider.info.installCommand,
    });
  } catch {
    res.status(404).json({ error: `Provider "${req.params.id}" not found` });
  }
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

    const cmd = provider.info.installCommand;
    const proc = spawn('bash', ['-c', cmd], {
      env: { ...process.env, HOME: process.env.HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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
  } catch {
    res.status(404).json({ error: `Provider "${req.params.id}" not found` });
  }
});

export default router;
