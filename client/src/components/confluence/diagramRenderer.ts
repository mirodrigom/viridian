/**
 * Standalone canvas renderer for diagram nodes & edges.
 * Produces a PNG data-URL without depending on Vue Flow or the DiagramEditor component.
 */

import type { Node, Edge } from '@vue-flow/core';

// ─── Helpers ──────────────────────────────────────────────────────────

interface AbsPos { x: number; y: number; w: number; h: number }

/** Resolve a node's absolute position by walking its parentNode chain. */
function absolutePosition(node: Node, nodeMap: Map<string, Node>): AbsPos {
  let x = node.position.x;
  let y = node.position.y;
  let cur = node.parentNode ? nodeMap.get(node.parentNode) : undefined;
  while (cur) {
    x += cur.position.x;
    y += cur.position.y;
    cur = cur.parentNode ? nodeMap.get(cur.parentNode) : undefined;
  }
  const style = (node.style ?? {}) as Record<string, string>;
  const w = parseFloat(style.width ?? '') || (node.type === 'aws-group' ? 400 : 180);
  const h = parseFloat(style.height ?? '') || (node.type === 'aws-group' ? 300 : 70);
  return { x, y, w, h };
}

/** Get the display label for a node. */
function nodeLabel(node: Node): string {
  const d = node.data as Record<string, unknown>;
  return ((d.customLabel as string) || (d.label as string) || 'Node').slice(0, 40);
}

/** Get the border/fill colour for a node. */
function nodeColor(node: Node): string {
  const d = node.data as Record<string, unknown>;
  if (node.type === 'aws-group') {
    const gt = d.groupType as { color?: string } | undefined;
    return gt?.color ?? '#8C8C8C';
  }
  const svc = d.service as { color?: string } | undefined;
  return svc?.color ?? '#FF9900';
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Draw a rounded rectangle. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ─── Main renderer ──────────────────────────────────────────────────

const PADDING = 60;
const SCALE = 1.5; // for crisp output

export function renderDiagramToPng(nodes: Node[], edges: Edge[]): string | null {
  if (nodes.length === 0) return null;

  const nodeMap = new Map<string, Node>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Compute absolute positions
  const posMap = new Map<string, AbsPos>();
  for (const n of nodes) {
    if (n.hidden) continue;
    posMap.set(n.id, absolutePosition(n, nodeMap));
  }

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of posMap.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + p.h);
  }

  const canvasW = (maxX - minX + PADDING * 2) * SCALE;
  const canvasH = (maxY - minY + PADDING * 2) * SCALE;

  // Cap size to avoid memory issues
  if (canvasW > 8000 || canvasH > 8000) return null;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(SCALE, SCALE);
  const offX = -minX + PADDING;
  const offY = -minY + PADDING;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW / SCALE, canvasH / SCALE);

  // Sort: groups first (largest area first so parents draw before children)
  const sorted = [...posMap.entries()].sort(([, a], [, b]) => {
    const nodeA = nodeMap.get([...posMap.entries()].find(([, v]) => v === a)![0])!;
    const nodeB = nodeMap.get([...posMap.entries()].find(([, v]) => v === b)![0])!;
    const isGroupA = nodeA.type === 'aws-group' ? 0 : 1;
    const isGroupB = nodeB.type === 'aws-group' ? 0 : 1;
    if (isGroupA !== isGroupB) return isGroupA - isGroupB;
    return (b.w * b.h) - (a.w * a.h);
  });

  // ── Draw groups ──
  for (const [id, pos] of sorted) {
    const node = nodeMap.get(id)!;
    if (node.type !== 'aws-group') continue;
    const color = nodeColor(node);
    const d = node.data as Record<string, unknown>;
    const gt = d.groupType as { borderStyle?: string } | undefined;
    const isDashed = gt?.borderStyle === 'dashed';

    const x = pos.x + offX;
    const y = pos.y + offY;

    // Fill
    ctx.fillStyle = hexToRgba(color, 0.06);
    roundRect(ctx, x, y, pos.w, pos.h, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (isDashed) ctx.setLineDash([6, 4]);
    else ctx.setLineDash([]);
    roundRect(ctx, x, y, pos.w, pos.h, 8);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label badge
    const label = nodeLabel(node);
    ctx.font = 'bold 11px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    const badgeW = tw + 16;
    const badgeH = 22;
    ctx.fillStyle = color;
    roundRect(ctx, x, y, badgeW, badgeH, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 8, y + badgeH / 2);
  }

  // ── Draw service nodes ──
  for (const [id, pos] of sorted) {
    const node = nodeMap.get(id)!;
    if (node.type !== 'aws-service') continue;
    const color = nodeColor(node);

    const x = pos.x + offX;
    const y = pos.y + offY;
    const w = pos.w;
    const h = pos.h;

    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.1)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    // Background
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x, y, w, h, 8);
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Left color bar
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + 4, y);
    ctx.lineTo(x + 4, y);
    ctx.quadraticCurveTo(x, y, x, y + 4);
    ctx.lineTo(x, y + h - 4);
    ctx.quadraticCurveTo(x, y + h, x + 4, y + h);
    ctx.lineTo(x + 4, y);
    ctx.closePath();
    ctx.fill();

    // Border
    ctx.strokeStyle = '#d0d7de';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    // Icon circle
    ctx.beginPath();
    ctx.arc(x + 28, y + h / 2, 14, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(color, 0.12);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Service icon abbreviation
    const d = node.data as Record<string, unknown>;
    const svc = d.service as { shortName?: string } | undefined;
    const abbr = (svc?.shortName ?? '?').slice(0, 3);
    ctx.font = 'bold 9px Inter, system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(abbr, x + 28, y + h / 2);

    // Label
    const label = nodeLabel(node);
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#24292f';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 50, y + h / 2);
  }

  // ── Draw edges ──
  for (const edge of edges) {
    if (edge.hidden) continue;
    const srcPos = posMap.get(edge.source);
    const tgtPos = posMap.get(edge.target);
    if (!srcPos || !tgtPos) continue;

    // Center points
    const sx = srcPos.x + offX + srcPos.w / 2;
    const sy = srcPos.y + offY + srcPos.h / 2;
    const tx = tgtPos.x + offX + tgtPos.w / 2;
    const ty = tgtPos.y + offY + tgtPos.h / 2;

    // Compute edge attachment points (exit from border, not center)
    const angle = Math.atan2(ty - sy, tx - sx);
    const ex = sx + Math.cos(angle) * (srcPos.w / 2);
    const ey = sy + Math.sin(angle) * (srcPos.h / 2);
    const ax = tx - Math.cos(angle) * (tgtPos.w / 2);
    const ay = ty - Math.sin(angle) * (tgtPos.h / 2);

    const edgeData = edge.data as Record<string, unknown> | undefined;
    const edgeColor = (edgeData?.color as string) || '#6e7781';
    const edgeStyle = (edgeData?.style as string) || 'solid';

    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1.5;
    if (edgeStyle === 'dashed') ctx.setLineDash([6, 4]);
    else if (edgeStyle === 'dotted') ctx.setLineDash([2, 3]);
    else ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrow head
    const arrowLen = 8;
    const arrowAngle = Math.PI / 6;
    ctx.fillStyle = edgeColor;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(
      ax - arrowLen * Math.cos(angle - arrowAngle),
      ay - arrowLen * Math.sin(angle - arrowAngle),
    );
    ctx.lineTo(
      ax - arrowLen * Math.cos(angle + arrowAngle),
      ay - arrowLen * Math.sin(angle + arrowAngle),
    );
    ctx.closePath();
    ctx.fill();

    // Edge label
    const label = (edgeData?.label as string) || (edge.label as string) || '';
    if (label) {
      const mx = (ex + ax) / 2;
      const my = (ey + ay) / 2;
      ctx.font = '10px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      // Background pill
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, mx - tw / 2 - 6, my - 8, tw + 12, 16, 4);
      ctx.fill();
      ctx.strokeStyle = '#d0d7de';
      ctx.lineWidth = 0.5;
      roundRect(ctx, mx - tw / 2 - 6, my - 8, tw + 12, 16, 4);
      ctx.stroke();
      // Text
      ctx.fillStyle = '#57606a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, mx, my);
    }
  }

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';

  return canvas.toDataURL('image/png');
}
