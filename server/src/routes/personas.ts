/**
 * Personas routes — CRUD for assistant personas (built-in + custom).
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
import { validate } from '../middleware/validate.js';
import { createLogger } from '../logger.js';

const log = createLogger('personas');
const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

interface PersonaRow {
  id: string;
  user_id: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  system_prompt: string;
  suggested_tools: string;
  is_builtin: number;
  created_at: string;
}

function rowToPersona(row: PersonaRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    systemPrompt: row.system_prompt,
    suggestedTools: JSON.parse(row.suggested_tools || '[]') as string[],
    isBuiltin: !!row.is_builtin,
    createdAt: row.created_at,
  };
}

/**
 * GET /api/personas
 * List all personas for the authenticated user.
 */
router.get('/', async (req, res) => {
  try {
    const user = (req as AuthRequest).user!;
    const rows = await db('personas')
      .where({ user_id: user.id })
      .orderByRaw('is_builtin DESC, name ASC')
      .select() as PersonaRow[];
    res.json({ personas: rows.map(rowToPersona) });
  } catch (err) {
    log.error({ err }, 'Failed to list personas');
    res.status(500).json({ error: 'Failed to list personas' });
  }
});

/**
 * GET /api/personas/:id
 * Get a single persona by ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const user = (req as AuthRequest).user!;
    const row = await db('personas')
      .where({ id: req.params.id, user_id: user.id })
      .first() as PersonaRow | undefined;
    if (!row) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }
    res.json({ persona: rowToPersona(row) });
  } catch (err) {
    log.error({ err }, 'Failed to get persona');
    res.status(500).json({ error: 'Failed to get persona' });
  }
});

/**
 * POST /api/personas
 * Create a custom persona.
 */
router.post('/', validate({
  body: z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional().default(''),
    icon: z.string().max(50).optional().default('Bot'),
    color: z.string().max(20).optional().default('#6366f1'),
    systemPrompt: z.string().min(1).max(10000),
    suggestedTools: z.array(z.string()).optional().default([]),
  }),
}), async (req, res) => {
  try {
    const user = (req as AuthRequest).user!;
    const { name, description, icon, color, systemPrompt, suggestedTools } = req.body as {
      name: string; description: string; icon: string; color: string;
      systemPrompt: string; suggestedTools: string[];
    };
    const id = randomUUID();
    await db('personas').insert({
      id,
      user_id: user.id,
      name,
      description,
      icon,
      color,
      system_prompt: systemPrompt,
      suggested_tools: JSON.stringify(suggestedTools),
      is_builtin: 0,
    });
    const row = await db('personas').where({ id }).first() as PersonaRow;
    res.status(201).json({ persona: rowToPersona(row) });
  } catch (err) {
    log.error({ err }, 'Failed to create persona');
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

/**
 * PATCH /api/personas/:id
 * Update a persona (custom or built-in).
 */
router.patch('/:id', validate({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    icon: z.string().max(50).optional(),
    color: z.string().max(20).optional(),
    systemPrompt: z.string().min(1).max(10000).optional(),
    suggestedTools: z.array(z.string()).optional(),
  }),
  params: z.object({ id: z.string() }),
}), async (req, res) => {
  try {
    const user = (req as AuthRequest).user!;
    const existing = await db('personas')
      .where({ id: req.params.id, user_id: user.id })
      .first() as PersonaRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }
    const { name, description, icon, color, systemPrompt, suggestedTools } = req.body as {
      name?: string; description?: string; icon?: string; color?: string;
      systemPrompt?: string; suggestedTools?: string[];
    };
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (icon !== undefined) updates.icon = icon;
    if (color !== undefined) updates.color = color;
    if (systemPrompt !== undefined) updates.system_prompt = systemPrompt;
    if (suggestedTools !== undefined) updates.suggested_tools = JSON.stringify(suggestedTools);

    if (Object.keys(updates).length > 0) {
      await db('personas')
        .where({ id: req.params.id, user_id: user.id })
        .update(updates);
    }
    const row = await db('personas').where({ id: req.params.id }).first() as PersonaRow;
    res.json({ persona: rowToPersona(row) });
  } catch (err) {
    log.error({ err }, 'Failed to update persona');
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

/**
 * DELETE /api/personas/:id
 * Delete a custom persona. Built-in personas cannot be deleted.
 */
router.delete('/:id', validate({
  params: z.object({ id: z.string() }),
}), async (req, res) => {
  try {
    const user = (req as AuthRequest).user!;
    const existing = await db('personas')
      .where({ id: req.params.id, user_id: user.id })
      .first() as PersonaRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Persona not found' });
      return;
    }
    if (existing.is_builtin) {
      res.status(400).json({ error: 'Cannot delete built-in personas' });
      return;
    }
    await db('personas').where({ id: req.params.id, user_id: user.id }).delete();
    res.json({ success: true });
  } catch (err) {
    log.error({ err }, 'Failed to delete persona');
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

export default router;
