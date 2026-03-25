import { nextTick, type Ref } from 'vue';
import type { ViewportTransform } from '@vue-flow/core';
import { toast } from 'vue-sonner';
import type { useDiagramsStore } from '@/stores/diagrams';
import { exportToDrawio } from '@/lib/export/drawio-exporter';

interface UseCanvasExportOptions {
  flowContainer: Ref<HTMLDivElement | undefined>;
  diagrams: ReturnType<typeof useDiagramsStore>;
  getViewport: () => ViewportTransform;
  fitView: (options?: { padding?: number }) => void;
  setViewport: (viewport: ViewportTransform) => void;
}

export function useCanvasExport({ flowContainer, diagrams, getViewport, fitView, setViewport }: UseCanvasExportOptions) {
  function exportJson() {
    const data = diagrams.serialize(getViewport());
    const json = JSON.stringify({ name: diagrams.currentDiagramName, ...data }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Diagram exported as JSON');
  }

  /**
   * Shared helper: fits the viewport to content, runs a capture function, then restores
   * the original viewport. Returns an object with the capture result and the pixel-space
   * bounding rect of the content inside the container (useful for cropping).
   */
  async function _withFitViewport<T>(
    captureTarget: HTMLDivElement,
    bounds: { x: number; y: number; width: number; height: number },
    captureFn: (contentRect: { x: number; y: number; width: number; height: number }) => Promise<T>,
  ): Promise<T> {
    const savedViewport = getViewport();
    const containerRect = captureTarget.getBoundingClientRect();
    const PADDING = 0.04;
    const zoom = Math.min(
      (containerRect.width  * (1 - PADDING * 2)) / bounds.width,
      (containerRect.height * (1 - PADDING * 2)) / bounds.height,
    );
    const x = (containerRect.width  - bounds.width  * zoom) / 2 - bounds.x * zoom;
    const y = (containerRect.height - bounds.height * zoom) / 2 - bounds.y * zoom;
    setViewport({ x, y, zoom });
    await nextTick();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // Content bounding rect in container pixel space
    const contentRect = {
      x: x + bounds.x * zoom,
      y: y + bounds.y * zoom,
      width: bounds.width * zoom,
      height: bounds.height * zoom,
    };

    try {
      return await captureFn(contentRect);
    } finally {
      setViewport(savedViewport);
    }
  }

  /** Shared filter used for both PNG and SVG to strip UI chrome. */
  function _exportFilter(node: Node): boolean {
    if (node instanceof Element) {
      if (node.classList.contains('vue-flow__controls')) return false;
      if (node.classList.contains('vue-flow__minimap')) return false;
      if (node.classList.contains('vue-flow__handle')) return false;
    }
    return true;
  }

  async function exportPng() {
    try {
      const captureTarget = flowContainer.value;
      if (!captureTarget) { toast.error('Cannot find canvas element'); return; }
      const bounds = diagrams.getContentBounds(0);
      if (!bounds) { toast.error('No nodes to export'); return; }

      const { toCanvas } = await import('html-to-image');

      const filename = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.png`;

      await _withFitViewport(captureTarget, bounds, async (contentRect) => {
        const PIXEL_RATIO = 2;
        const fullCanvas = await toCanvas(captureTarget, {
          pixelRatio: PIXEL_RATIO,
          backgroundColor: '#0a0a0a',
          filter: _exportFilter,
        });

        // Crop the canvas to the exact content area
        const cropX = Math.round(contentRect.x * PIXEL_RATIO);
        const cropY = Math.round(contentRect.y * PIXEL_RATIO);
        const cropW = Math.round(contentRect.width * PIXEL_RATIO);
        const cropH = Math.round(contentRect.height * PIXEL_RATIO);

        const cropped = document.createElement('canvas');
        cropped.width  = cropW;
        cropped.height = cropH;
        const ctx = cropped.getContext('2d')!;
        ctx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        await new Promise<void>((resolve) => {
          cropped.toBlob((blob) => {
            if (!blob) { resolve(); return; }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            resolve();
          }, 'image/png');
        });
      });

      toast.success('Diagram exported as PNG');
    } catch (err) {
      console.error('PNG export error:', err);
      toast.error('PNG export failed');
    }
  }

  async function exportSvg() {
    try {
      const captureTarget = flowContainer.value;
      if (!captureTarget) { toast.error('Cannot find canvas element'); return; }
      const bounds = diagrams.getContentBounds(0);
      if (!bounds) { toast.error('No nodes to export'); return; }

      const { toSvg } = await import('html-to-image');

      const filename = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.svg`;

      await _withFitViewport(captureTarget, bounds, async (contentRect) => {
        // Capture the full container as SVG (nodes + edges via foreignObject)
        const dataUrl = await toSvg(captureTarget, {
          backgroundColor: '#0a0a0a',
          filter: _exportFilter,
        });

        // Parse the SVG data URL to adjust its viewBox to crop to content only
        const svgText = decodeURIComponent(dataUrl.replace(/^data:image\/svg\+xml,/, ''));
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl = doc.documentElement as unknown as SVGSVGElement;

        // Override dimensions to match content bounds exactly (no extra whitespace)
        svgEl.setAttribute('width',   String(Math.round(contentRect.width)));
        svgEl.setAttribute('height',  String(Math.round(contentRect.height)));
        svgEl.setAttribute('viewBox', `${contentRect.x} ${contentRect.y} ${contentRect.width} ${contentRect.height}`);

        const serializer = new XMLSerializer();
        const finalSvg = serializer.serializeToString(svgEl);
        const blob = new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      });

      toast.success('Diagram exported as SVG');
    } catch (err) {
      console.error('SVG export error:', err);
      toast.error('SVG export failed');
    }
  }

  function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const raw = JSON.parse(e.target?.result as string);

          // Validate basic structure
          if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
            toast.error('Invalid diagram JSON: missing nodes or edges arrays');
            return;
          }

          diagrams.newDiagram();
          diagrams.deserialize({
            id: '',
            name: raw.name || 'Imported Diagram',
            nodes: raw.nodes,
            edges: raw.edges,
            viewport: raw.viewport,
          });

          // Fit view after VueFlow renders the imported nodes
          setTimeout(() => fitView(), 200);

          toast.success(`Imported diagram "${raw.name || 'Untitled'}" (${raw.nodes.length} nodes, ${raw.edges.length} edges)`);
        } catch (err) {
          console.error('JSON import error:', err);
          toast.error('Failed to import JSON: ' + (err instanceof Error ? err.message : 'Invalid file'));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function exportDrawio() {
    try {
      const data = diagrams.serialize(getViewport());
      if (data.nodes.length === 0) {
        toast.error('No nodes to export');
        return;
      }
      const xml = exportToDrawio(data.nodes, data.edges, { diagramName: diagrams.currentDiagramName });
      const blob = new Blob([xml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.drawio`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Diagram exported as draw.io');
    } catch (err) {
      console.error('draw.io export error:', err);
      toast.error('draw.io export failed');
    }
  }

  return { exportJson, exportPng, exportSvg, importJson, exportDrawio };
}
