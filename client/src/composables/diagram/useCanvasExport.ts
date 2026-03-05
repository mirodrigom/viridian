import type { Ref } from 'vue';
import type { ViewportTransform } from '@vue-flow/core';
import { toast } from 'vue-sonner';
import type { useDiagramsStore } from '@/stores/diagrams';

interface UseCanvasExportOptions {
  flowContainer: Ref<HTMLDivElement | undefined>;
  diagrams: ReturnType<typeof useDiagramsStore>;
  getViewport: () => ViewportTransform;
}

export function useCanvasExport({ flowContainer, diagrams, getViewport }: UseCanvasExportOptions) {
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
      const captureTarget = flowContainer.value?.querySelector('.vue-flow__transformationpane') as HTMLElement
        ?? flowContainer.value?.querySelector('.vue-flow__viewport') as HTMLElement
        ?? flowContainer.value;
      if (!captureTarget) { toast.error('Cannot find canvas element'); return; }

      const html2canvas = (await import('html2canvas')).default;
      const bounds = diagrams.getContentBounds(50);
      const viewport = getViewport();

      if (bounds) {
        const screenX = bounds.x * viewport.zoom + viewport.x;
        const screenY = bounds.y * viewport.zoom + viewport.y;
        const screenW = bounds.width * viewport.zoom;
        const screenH = bounds.height * viewport.zoom;

        const scale = 2;
        const canvas = await html2canvas(captureTarget, {
          x: screenX,
          y: screenY,
          width: screenW,
          height: screenH,
          scale,
          backgroundColor: '#0a0a0a',
          logging: false,
          useCORS: true,
          allowTaint: true,
        });

        canvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${diagrams.currentDiagramName.replace(/\s+/g, '-').toLowerCase()}.png`;
          a.click();
          URL.revokeObjectURL(url);
          toast.success('Diagram exported as PNG (cropped to content)');
        });
      } else {
        toast.error('No nodes to export');
      }
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
