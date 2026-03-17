import { nextTick, type Ref } from 'vue';
import type { ViewportTransform } from '@vue-flow/core';
import { toast } from 'vue-sonner';
import type { useDiagramsStore } from '@/stores/diagrams';

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

  async function exportPng() {
    try {
      const captureTarget = flowContainer.value;
      if (!captureTarget) { toast.error('Cannot find canvas element'); return; }
      const bounds = diagrams.getContentBounds(0);
      if (!bounds) { toast.error('No nodes to export'); return; }

      const { toCanvas } = await import('html-to-image');

      // Compute fit-to-content viewport manually (no animation)
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

      const canvas = await toCanvas(captureTarget, {
        pixelRatio: 2,
        backgroundColor: '#0a0a0a',
        filter: (node) => {
          if (node instanceof Element) {
            if (node.classList.contains('vue-flow__controls')) return false;
            if (node.classList.contains('vue-flow__minimap')) return false;
            if (node.classList.contains('vue-flow__handle')) return false;
          }
          return true;
        },
      });

      setViewport(savedViewport);

      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Diagram exported as PNG');
      }, 'image/png');
    } catch (err) {
      console.error('PNG export error:', err);
      toast.error('PNG export failed');
    }
  }

  function exportSvg() {
    try {
      const el = flowContainer.value?.querySelector('.vue-flow__viewport svg') as SVGSVGElement | null;
      if (!el) {
        toast.error('Cannot find SVG element');
        return;
      }

      const clone = el.cloneNode(true) as SVGSVGElement;
      const bounds = diagrams.getContentBounds(50);
      const viewport = getViewport();

      if (bounds) {
        const vbX = bounds.x * viewport.zoom + viewport.x;
        const vbY = bounds.y * viewport.zoom + viewport.y;
        const vbW = bounds.width * viewport.zoom;
        const vbH = bounds.height * viewport.zoom;
        clone.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
        clone.setAttribute('width', String(Math.round(bounds.width)));
        clone.setAttribute('height', String(Math.round(bounds.height)));
      }

      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(clone);
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.svg`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Diagram exported as SVG (cropped to content)');
    } catch {
      toast.error('SVG export failed');
    }
  }

  return { exportJson, exportPng, exportSvg };
}
