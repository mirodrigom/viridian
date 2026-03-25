import { Router } from 'express';
import { randomUUID } from 'crypto';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { db } from '../db/database.js';
import { getProvider } from '../providers/registry.js';
import type { ProviderId } from '../providers/types.js';
import { createLogger } from '../logger.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';

const log = createLogger('manuals');
import puppeteer from 'puppeteer';

const router: ReturnType<typeof Router> = Router();
router.use(authMiddleware);

interface ManualRow {
  id: string;
  user_id: number;
  project_path: string;
  title: string;
  prompt: string;
  content: string;
  logo1_data: string;
  logo2_data: string;
  logo1_position: string;
  logo2_position: string;
  brand_colors: string;
  pdf_data: string;
  mode: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToManual(row: ManualRow) {
  let logo1Pos = { x: 50, y: 30, width: 120, height: 60 };
  let logo2Pos = { x: 530, y: 30, width: 120, height: 60 };
  let brandColors: string[] = [];
  try { logo1Pos = JSON.parse(row.logo1_position); } catch { /* use default */ }
  try { logo2Pos = JSON.parse(row.logo2_position); } catch { /* use default */ }
  try { brandColors = JSON.parse(row.brand_colors || '[]'); } catch { /* use default */ }

  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    content: row.content,
    logo1Data: row.logo1_data,
    logo2Data: row.logo2_data,
    logo1Position: logo1Pos,
    logo2Position: logo2Pos,
    brandColors,
    pdfData: row.pdf_data || '',
    mode: (row.mode || 'generate') as 'generate' | 'enhance',
    status: row.status,
    projectPath: row.project_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: ManualRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

// GET / — list manuals for a project
router.get('/', validate({ query: z.object({ project: z.string().min(1) }) }), async (req: AuthRequest, res) => {
  const { project } = req.query;

  const rows = await db('manuals')
    .where({ user_id: req.user!.id, project_path: project })
    .orderBy('updated_at', 'desc')
    .select() as ManualRow[];
  res.json({ manuals: rows.map(rowToSummary) });
});

// GET /:id — get single manual
router.get('/:id', async (req: AuthRequest, res) => {
  const row = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ManualRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'Manual not found' });
    return;
  }

  res.json(rowToManual(row));
});

// POST / — create manual
router.post('/', validate({ body: z.object({ project: z.string().min(1) }).passthrough() }), async (req: AuthRequest, res) => {
  const { title, project, prompt, logo1Data, logo2Data } = req.body;

  const id = randomUUID();

  await db('manuals').insert({
    id,
    user_id: req.user!.id,
    project_path: project,
    title: title || 'Untitled Manual',
    prompt: prompt || '',
    logo1_data: logo1Data || '',
    logo2_data: logo2Data || '',
  });

  const row = await db('manuals').where({ id }).first() as ManualRow;
  res.status(201).json(rowToManual(row));
});

// PUT /:id — update manual
router.put('/:id', async (req: AuthRequest, res) => {
  const existing = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ManualRow | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Manual not found' });
    return;
  }

  const { title, prompt, content, logo1Data, logo2Data, logo1Position, logo2Position, brandColors, pdfData, mode, status } = req.body;

  const updates: Record<string, unknown> = {};

  if (title !== undefined) updates['title'] = title;
  if (prompt !== undefined) updates['prompt'] = prompt;
  if (content !== undefined) updates['content'] = content;
  if (logo1Data !== undefined) updates['logo1_data'] = logo1Data;
  if (logo2Data !== undefined) updates['logo2_data'] = logo2Data;
  if (logo1Position !== undefined) updates['logo1_position'] = JSON.stringify(logo1Position);
  if (logo2Position !== undefined) updates['logo2_position'] = JSON.stringify(logo2Position);
  if (brandColors !== undefined) updates['brand_colors'] = JSON.stringify(brandColors);
  if (pdfData !== undefined) updates['pdf_data'] = pdfData;
  if (mode !== undefined) updates['mode'] = mode;
  if (status !== undefined) updates['status'] = status;

  if (Object.keys(updates).length === 0) {
    res.json(rowToManual(existing));
    return;
  }

  updates['updated_at'] = db.fn.now();
  await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .update(updates);
  const row = await db('manuals').where({ id: req.params.id }).first() as ManualRow;
  res.json(rowToManual(row));
});

// DELETE /:id — delete manual
router.delete('/:id', async (req: AuthRequest, res) => {
  const deleted = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .delete();

  if (deleted === 0) {
    res.status(404).json({ error: 'Manual not found' });
    return;
  }

  res.json({ ok: true });
});

// POST /:id/generate — generate manual content via Claude (plain async POST, no SSE)
router.post('/:id/generate', async (req: AuthRequest, res) => {
  const row = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ManualRow | undefined;

  if (!row) {
    res.status(404).json({ error: 'Manual not found' });
    return;
  }

  const { providerId = 'claude', model } = req.body as { providerId?: ProviderId; model?: string };
  const manual = rowToManual(row);
  const hasBrandColors = manual.brandColors.length > 0;
  const isEnhanceMode = manual.mode === 'enhance' && !!manual.pdfData;

  const primaryColor = hasBrandColors ? manual.brandColors[0] : '#1e3a5f';
  const secondaryColor = hasBrandColors && manual.brandColors[1] ? manual.brandColors[1] : '#2563eb';

  // Build CSS and header HTML server-side (NOT sent to Claude — injected after generation)
  const logo1Html = manual.logo1Data ? `<img src="${manual.logo1Data}" style="height:48px;max-width:180px;object-fit:contain;" />` : '<span style="font-weight:700;font-size:1.1rem;">Company</span>';
  const logo2Html = manual.logo2Data ? `<img src="${manual.logo2Data}" style="height:48px;max-width:180px;object-fit:contain;" />` : '';

  const logoLeftHtml  = manual.logo1Data ? `<img src="${manual.logo1Data}" style="height:44px;max-width:160px;object-fit:contain;" />` : '';
  const logoRightHtml = manual.logo2Data ? `<img src="${manual.logo2Data}" style="height:44px;max-width:160px;object-fit:contain;" />` : '';

  // Injected into <head>: layout overrides + page-break rules
  const logoHeaderCss = `
    <style id="logo-inject">
      /* ── Header layout ── */
      .page-header { display: flex !important; flex-direction: row !important; align-items: center !important; justify-content: space-between !important; flex-wrap: nowrap !important; }
      .page-header .logo-left  { flex-shrink: 0 !important; order: 0 !important; min-width: 80px; }
      .page-header .center-title { flex: 1 !important; order: 1 !important; }
      .page-header .logo-right { flex-shrink: 0 !important; order: 2 !important; min-width: 80px; }
      /* ── A4 page layout: footer always at bottom ── */
      .page { min-height: 1123px !important; display: flex !important; flex-direction: column !important; box-sizing: border-box !important; }
      .page-content { flex: 1 1 auto !important; }
      .page-footer  { margin-top: auto !important; }
      /* ── Cover page: clamp excessive vertical whitespace ── */
      .cover-content, .portada-content, [class*="cover"] .page-content, [class*="portada"] .page-content { justify-content: flex-start !important; padding-top: 32px !important; }
      .page-content > * + * { margin-top: revert; }
      /* ── Print-safe: no overflow/scroll ── */
      pre, code, .code-block { white-space: pre-wrap !important; word-wrap: break-word !important; overflow-wrap: break-word !important; overflow: hidden !important; max-width: 100% !important; }
      table { table-layout: fixed !important; width: 100% !important; }
      td, th { word-break: break-word !important; overflow-wrap: break-word !important; }
      .page-content img, .page-content svg { max-width: 100% !important; height: auto !important; }
      .page-header .logo-left img, .page-header .logo-right img { height: 44px !important; max-width: 160px !important; width: auto !important; object-fit: contain !important; }
      /* ── Spacing between sections ── */
      .page-content h2, .page-content h3 { margin-top: 24px !important; }
      .page-content h2:first-child, .page-content h3:first-child { margin-top: 0 !important; }
      /* ── Page-break rules ── */
      h1, h2, h3 { page-break-after: avoid !important; break-after: avoid !important; }
      h1 + *, h2 + *, h3 + * { page-break-before: avoid !important; break-before: avoid !important; }
      table, figure, pre, blockquote { page-break-inside: avoid !important; break-inside: avoid !important; }
      [class*="diagram"], [class*="flow"], [class*="chart"] { page-break-inside: avoid !important; break-inside: avoid !important; }
      [class*="toc"], [class*="contenido"], [class*="indice"], ol, ul { page-break-inside: avoid !important; break-inside: avoid !important; }
      li { page-break-inside: avoid !important; break-inside: avoid !important; }
      .page-header, .page-footer { page-break-inside: avoid !important; break-inside: avoid !important; overflow: visible !important; }
      .page-break { page-break-before: always !important; break-before: page !important; }
      @media print {
        @page { size: A4; margin: 12mm 15mm; }
        .page { min-height: 0 !important; page-break-after: always !important; break-after: page !important; box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; border: none !important; }
        body  { background: #fff !important; padding: 0 !important; margin: 0 !important; }
        .page-header { overflow: visible !important; }
      }
    </style>`;

  // Logo injection via script — more reliable than regex for arbitrary nested HTML
  const logoInjectScript = `
    <script id="logo-inject-script">
    (function(){
      var l = ${JSON.stringify(logoLeftHtml)};
      var r = ${JSON.stringify(logoRightHtml)};
      if (l) document.querySelectorAll('.logo-left').forEach(function(el){ el.innerHTML = l; });
      if (r) document.querySelectorAll('.logo-right').forEach(function(el){ el.innerHTML = r; });
    })();
    </script>`;

  function buildFullDocument(bodyContent: string, title: string): string {
    // Strip markdown code fences if Claude wrapped the HTML in them
    const codeFenceMatch = bodyContent.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
    if (codeFenceMatch) {
      bodyContent = codeFenceMatch[1].trim();
    }

    // If Claude returned a full HTML document, preserve ALL its styles — just inject CSS overrides + logo script
    if (/^\s*<!DOCTYPE/i.test(bodyContent) || /^\s*<html/i.test(bodyContent)) {
      let doc = bodyContent;
      doc = doc.replace(/<\/head>/i, `${logoHeaderCss}</head>`);
      doc = doc.replace(/<\/body>/i, `${logoInjectScript}</body>`);
      return doc;
    }

    // Claude returned body fragments — wrap with minimal shell
    const fallbackCss = `<style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Inter', system-ui, sans-serif; background: #EEF2F7; color: #1a1a2e; line-height: 1.7; font-size: 14px; }
      .page { background: #fff; width: 900px; margin: 32px auto; border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,.08); overflow: hidden; }
      .page-header { display: flex; flex-direction: row; align-items: center; justify-content: space-between; padding: 12px 32px; border-bottom: 3px solid ${primaryColor}; background: #fff; }
      .page-header .logo-left, .page-header .logo-right { flex-shrink: 0; }
      .page-header .center-title { flex:1; text-align:center; font-size:10px; font-weight:600; color:#8896AB; letter-spacing:.08em; text-transform:uppercase; }
      .page-content { padding: 36px 48px 28px; }
      .page-footer { padding: 10px 32px; background: #F8FAFC; border-top: 1px solid #E2EAF4; font-size:10px; color:#8896AB; display:flex; justify-content:space-between; }
      h1, h2 { background: linear-gradient(90deg, ${primaryColor}, ${secondaryColor}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-weight: 800; margin-bottom: 16px; }
      h3 { color: ${primaryColor}; font-weight: 700; margin: 24px 0 10px; }
      table { width: 100%; border-collapse: collapse; margin: 14px 0 20px; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 6px rgba(0,0,0,.07); }
      thead tr { background: linear-gradient(90deg, ${primaryColor}, ${secondaryColor}); }
      thead th { color: #fff; padding: 10px 14px; text-align: left; font-size: 12px; font-weight: 600; }
      tbody tr:nth-child(even) { background: #F8FAFC; }
      tbody tr:hover { background: #EEF7FF; }
      td { padding: 10px 14px; color: #374151; border-bottom: 1px solid #EEF2F7; vertical-align: top; }
      pre, code { font-family: 'JetBrains Mono', monospace; background: #1E1E2E; color: #CDD6F4; border-radius: 6px; padding: 16px 20px; font-size: 12.5px; line-height: 1.7; display: block; margin: 12px 0; overflow-x: auto; }
      @media screen { body { padding: 20px; } }
    </style>`;

    const fallbackHeader = `<div class="page-header" style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;"><div class="logo-left">${logoLeftHtml}</div><div class="logo-right">${logoRightHtml}</div></div>`;
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>${title}</title>${fallbackCss}${logoHeaderCss}</head><body>${fallbackHeader}${bodyContent}</body></html>`;
  }

  const brandColorList = manual.brandColors.length > 0
    ? `Brand colors extracted from the logo: ${manual.brandColors.join(', ')}. Use these as the primary palette.`
    : `Use a professional blue palette: primary #1B4F9E, accent #4A9FE8, highlight #00C4CC.`;

  const logoInstructions = `
LOGO PLACEMENT (critical — must be exact):
- Every page must have a header with class="page-header" and inline style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;"
- Inside page-header, ALWAYS exactly these 3 children IN ORDER:
  1. <div class="logo-left" style="flex-shrink:0;min-width:80px;"></div>  ← LEAVE EMPTY — logo injected automatically
  2. <div class="center-title" style="flex:1;text-align:center;">Section Title</div>
  3. <div class="logo-right" style="flex-shrink:0;min-width:80px;"></div>  ← LEAVE EMPTY — logo injected automatically
- NEVER place logo images (<img>) anywhere in the document body or header manually — they are injected into logo-left and logo-right automatically
- NEVER put text like "CloudHesive" or company names inside logo-left/logo-right — leave them empty

A4 PAGE LAYOUT (critical):
- Format is A4 (210×297mm). Each .page div represents exactly one printed sheet
- The .page width is 900px on screen. Usable content area inside page-content is about 800px wide (after padding)
- Structure each .page as: page-header → page-content (main content) → page-footer
- page-content should contain ALL the section content for that page
- page-footer must always be the LAST element inside .page, after all content
- If a section has more content than fits in one page, split it into multiple .page divs, each with its own header and footer
- Large diagrams or flow charts that would exceed one page must each get their own dedicated .page div
- Cover page: do NOT use justify-content:center or large padding-top on the cover page-content — start content from the top with normal padding (24px). The cover should show the title and metadata immediately below the header without excessive whitespace
- Table of Contents: MUST fit in a single .page div. Keep it concise (max 2 levels of indentation). Do NOT let the TOC overflow to a second page — if it's too long, reduce to top-level sections only

PRINT-SAFE CONTENT (critical — this document will be exported to PDF, NO scrolling is possible):
- ALL content must be fully visible without scrolling, both horizontally and vertically
- Code blocks: use word-wrap:break-word; white-space:pre-wrap; overflow-wrap:break-word; overflow:hidden; — NEVER use overflow-x:auto or overflow:scroll
- Long JSON, URLs, or inline code: MUST wrap to the next line. Never let text overflow its container
- Tables: use table-layout:fixed; width:100%; and add word-break:break-word; on td/th so cell text wraps
- If a code snippet or JSON payload is too wide, reformat it with line breaks (one key-value pair per line)
- If a numbered/ordered list has many items (e.g., 1–9 steps), ALL items MUST be included — never truncate or cut off a list. If it doesn't fit in one page, continue on the next .page div
- Images and diagrams: use max-width:100%; height:auto; to prevent horizontal overflow
- NEVER rely on scrollbars — they do not work in PDF output. Everything must be visible as printed

PAGE BREAKS (critical for PDF export):
- Add class="page-break" or style="page-break-before:always" before each new .page div
- Add style="page-break-after:avoid" on all h1/h2/h3 so they never appear orphaned at the bottom of a page
- Add style="page-break-inside:avoid" on tables, code blocks, diagrams, and figures
- Do NOT add page-break-before to the very first .page`;

  const enhanceSystemPrompt = `You are a professional document designer. Recreate the provided document as a complete, polished, self-contained HTML file.

OUTPUT RULES:
- Output a COMPLETE HTML document (<!DOCTYPE html> ... </html>) with all CSS included in a <style> block in <head>
- Output ONLY the raw HTML — no markdown, no code fences, no explanation, no preamble
- DO NOT use any tools. DO NOT write to files. Your ENTIRE response must be the raw HTML document starting with <!DOCTYPE html>
- Preserve ALL original content: every section, table, bullet point, code block, and detail

DESIGN REQUIREMENTS:
- White background (#FFFFFF), clean and modern
- ${brandColorList}
- Section number labels in accent color (small uppercase), main section titles as large gradient text
- Sub-section titles in primary color with a colored left border accent
- Tables: branded gradient header row (white text), alternating row colors, subtle shadow
- Code blocks: dark theme (#1E1E2E background) with syntax color hints
- Bullet lists with custom colored dot markers
- Each logical "page" wrapped in a <div class="page"> with card shadow
- Page footer on every page with: CompanyName — DocumentTitle — Page X

${logoInstructions}

STRUCTURE per page:
<div class="page" style="page-break-inside:avoid;">
  <div class="page-header" style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;">
    <div class="logo-left" style="flex-shrink:0;"></div>
    <div class="center-title" style="flex:1;text-align:center;">Section Title</div>
    <div class="logo-right" style="flex-shrink:0;"></div>
  </div>
  <div class="page-content">...content...</div>
  <div class="page-footer" style="page-break-inside:avoid;"><span>Company — Title</span><span>Page X of Y | Date</span></div>
</div>`;

  const generateSystemPrompt = `You are a professional document designer. Generate a complete, polished, self-contained HTML file based on the user's description.

OUTPUT RULES:
- Output a COMPLETE HTML document (<!DOCTYPE html> ... </html>) with all CSS included in a <style> block in <head>
- Output ONLY the raw HTML — no markdown, no code fences, no explanation, no preamble
- DO NOT use any tools. DO NOT write to files. Your ENTIRE response must be the raw HTML document starting with <!DOCTYPE html>

DESIGN REQUIREMENTS:
- White background (#FFFFFF), clean and modern
- ${brandColorList}
- Professional typography, colored section headers, branded tables
- Each logical page in a <div class="page"> card with shadow

${logoInstructions}`;

  const systemPrompt = isEnhanceMode ? enhanceSystemPrompt : generateSystemPrompt;

  let userPrompt = isEnhanceMode
    ? `Recreate this document as polished HTML. ${row.prompt ? `Additional instructions: ${row.prompt}` : ''}`
    : row.prompt || 'Generate a generic company manual.';

  let tempPdfPath: string | null = null;

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function sendEvent(type: string, data: Record<string, unknown>) {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  }

  try {
    if (isEnhanceMode) {
      const userInstructions = row.prompt || 'Enhance this document with brand colors and professional styling.';
      const base64Match = manual.pdfData.match(/^data:application\/pdf;base64,(.+)$/s);
      if (base64Match) {
        const pdfBuffer = Buffer.from(base64Match[1], 'base64');
        tempPdfPath = join(tmpdir(), `manual-${randomUUID()}.pdf`);
        writeFileSync(tempPdfPath, pdfBuffer);

        let pdfText: string | null = null;
        try {
          pdfText = execSync(`pdftotext "${tempPdfPath}" -`, { timeout: 30000 }).toString();
        } catch {
          // pdftotext not installed — Claude will read the file directly
        }

        if (pdfText && pdfText.trim().length > 0) {
          userPrompt = `PDF content:\n\n${pdfText.substring(0, 80000)}\n\nUser instructions: ${userInstructions}`;
        } else {
          userPrompt = `Read the PDF at ${tempPdfPath} using the Read tool, then recreate it as enhanced HTML. User instructions: ${userInstructions}`;
        }
      }
    }

    const provider = getProvider(providerId);
    log.info({ mode: manual.mode, provider: providerId, hasPdf: !!tempPdfPath }, 'Generate start');
    sendEvent('progress', { text: 'Connecting to provider...' });

    let accumulatedText = '';
    let lastWrittenFilePath: string | null = null;
    let lastProgressAt = 0;
    const stream = provider.query({
      prompt: userPrompt,
      systemPrompt,
      cwd: row.project_path || '/tmp',
      model,
      permissionMode: 'bypassPermissions',
      noTools: !isEnhanceMode,
    });

    for await (const msg of stream) {
      if (msg.type === 'text_delta') {
        accumulatedText += msg.text;
        // Throttle progress events to every 500ms
        const now = Date.now();
        if (now - lastProgressAt > 500) {
          lastProgressAt = now;
          sendEvent('progress', { text: `Generating... (${Math.round(accumulatedText.length / 1000)}KB)` });
        }
      } else if (msg.type === 'tool_use' && (msg as { name?: string }).name === 'Write') {
        // Claude used the Write tool instead of outputting HTML directly — capture the file path
        const input = (msg as { input?: { file_path?: string } }).input;
        if (input?.file_path) lastWrittenFilePath = input.file_path;
        sendEvent('progress', { text: 'Writing document...' });
      } else if (msg.type === 'tool_use' && (msg as { name?: string }).name === 'Read') {
        sendEvent('progress', { text: 'Reading PDF content...' });
      }
    }

    // Fallback: if Claude wrote a file instead of outputting HTML, read it
    if ((!accumulatedText || !/<!DOCTYPE/i.test(accumulatedText)) && lastWrittenFilePath) {
      try {
        const { readFileSync } = await import('fs');
        accumulatedText = readFileSync(lastWrittenFilePath, 'utf-8');
        log.info({ path: lastWrittenFilePath }, 'Fallback: read file written by Claude');
      } catch (readErr) {
        log.warn({ err: readErr }, 'Fallback file read failed');
      }
    }

    log.info({ chars: accumulatedText.length }, 'Generate done');
    sendEvent('progress', { text: 'Injecting logos and styles...' });

    // Inject CSS + logos server-side (not sent to Claude to avoid token limit)
    const finalHtml = buildFullDocument(accumulatedText, manual.title || 'Manual');

    // Save previous content as a version before overwriting
    if (row.content && row.content.trim().length > 0) {
      await db('manual_versions').insert({ id: randomUUID(), manual_id: req.params.id, content: row.content });
    }

    await db('manuals')
      .where({ id: req.params.id, user_id: req.user!.id })
      .update({ content: finalHtml, status: 'generated', updated_at: db.fn.now() });

    const updated = await db('manuals').where({ id: req.params.id }).first() as ManualRow;
    sendEvent('done', { manual: rowToManual(updated) });
    res.end();
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    log.error({ err, errorMsg }, 'Generate failed');
    sendEvent('error', { error: errorMsg });
    res.end();
  } finally {
    if (tempPdfPath) {
      try { unlinkSync(tempPdfPath); } catch { /* ok */ }
    }
  }
});

// POST /:id/export-pdf — render HTML to PDF via headless Chromium
router.post('/:id/export-pdf', async (req: AuthRequest, res) => {
  const row = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .select('content', 'title')
    .first() as { content: string; title: string } | undefined;
  if (!row || !row.content) {
    res.status(404).json({ error: 'Manual not found or has no content' });
    return;
  }

  let browser;
  try {
    // Make the HTML self-contained: replace external Google Fonts @import
    // with system font stack so Puppeteer doesn't hang waiting for network
    let html = row.content;
    // Remove @import url('https://fonts.googleapis.com/...') statements
    html = html.replace(/@import\s+url\([^)]*fonts\.googleapis\.com[^)]*\)\s*;?/gi, '');
    // Remove <link> tags for Google Fonts
    html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*\/?>/gi, '');
    // Inject a system font fallback so font-family: 'Inter', etc. still renders
    const fontFallback = `<style id="pdf-font-fallback">
      @font-face { font-family: 'Inter'; font-style: normal; font-weight: 400; src: local('Inter'), local('Helvetica Neue'), local('Arial'); }
      @font-face { font-family: 'Inter'; font-style: normal; font-weight: 600; src: local('Inter SemiBold'), local('Helvetica Neue Medium'), local('Arial Bold'); }
      @font-face { font-family: 'Inter'; font-style: normal; font-weight: 700; src: local('Inter Bold'), local('Helvetica Neue Bold'), local('Arial Bold'); }
      @font-face { font-family: 'Inter'; font-style: normal; font-weight: 800; src: local('Inter ExtraBold'), local('Helvetica Neue Bold'), local('Arial Black'); }
      @font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 400; src: local('JetBrains Mono'), local('Courier New'), local('monospace'); }
    </style>`;
    if (html.includes('</head>')) {
      html = html.replace('</head>', `${fontFallback}</head>`);
    } else {
      html = `${fontFallback}${html}`;
    }

    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    });
    const page = await browser.newPage();
    // Block external font/stylesheet requests to avoid hanging
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
        request.abort();
      } else {
        request.continue();
      }
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Allow a brief moment for inline styles and layout to settle
    await new Promise(resolve => setTimeout(resolve, 500));
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '15mm', right: '15mm' },
    });
    await browser.close();
    browser = undefined;

    const filename = row.title.replace(/[^a-zA-Z0-9\s_-]/g, '').trim() || 'manual';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const msg = err instanceof Error ? err.message : 'PDF generation failed';
    log.error({ err: msg }, 'PDF export failed');
    res.status(500).json({ error: msg });
  }
});

// GET /:id/versions — list version history (no content, just metadata)
router.get('/:id/versions', async (req: AuthRequest, res) => {
  const manual = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first();
  if (!manual) { res.status(404).json({ error: 'Manual not found' }); return; }

  const versions = await db('manual_versions')
    .where({ manual_id: req.params.id })
    .orderBy('created_at', 'desc')
    .select('id', 'created_at') as { id: string; created_at: string }[];
  res.json({ versions });
});

// GET /:id/versions/:versionId — get version content
router.get('/:id/versions/:versionId', async (req: AuthRequest, res) => {
  const manual = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first();
  if (!manual) { res.status(404).json({ error: 'Manual not found' }); return; }

  const version = await db('manual_versions')
    .where({ id: req.params.versionId, manual_id: req.params.id })
    .select('id', 'content', 'created_at')
    .first() as { id: string; content: string; created_at: string } | undefined;
  if (!version) { res.status(404).json({ error: 'Version not found' }); return; }

  res.json(version);
});

// POST /:id/versions/:versionId/restore — restore a version
router.post('/:id/versions/:versionId/restore', async (req: AuthRequest, res) => {
  const existing = await db('manuals')
    .where({ id: req.params.id, user_id: req.user!.id })
    .first() as ManualRow | undefined;
  if (!existing) { res.status(404).json({ error: 'Manual not found' }); return; }

  const version = await db('manual_versions')
    .where({ id: req.params.versionId, manual_id: req.params.id })
    .select('content')
    .first() as { content: string } | undefined;
  if (!version) { res.status(404).json({ error: 'Version not found' }); return; }

  // Save current content as a version before restoring
  if (existing.content && existing.content.trim().length > 0) {
    await db('manual_versions').insert({ id: randomUUID(), manual_id: req.params.id, content: existing.content });
  }

  await db('manuals')
    .where({ id: req.params.id })
    .update({ content: version.content, status: 'generated', updated_at: db.fn.now() });

  const updated = await db('manuals').where({ id: req.params.id }).first() as ManualRow;
  res.json(rowToManual(updated));
});

export default router;
