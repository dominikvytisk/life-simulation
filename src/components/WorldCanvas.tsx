/**
 * The world view. Owns the camera, the render loop and picking.
 *
 * Camera state lives in a ref rather than React state on purpose: it changes
 * every frame during a drag, and routing that through a re-render would make
 * panning stutter at high organism counts.
 */
import { useEffect, useRef, useState } from 'react';
import { getClient } from '../app/client';
import { useStore } from '../app/store';
import { createRenderer, type Camera, type LifeRenderer } from '../gpu/renderer';
import { WORLD_EVENT_INFO, type WorldEventTypeId } from '../sim/events/worldEvents';

export function WorldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<LifeRenderer | null>(null);
  const cameraRef = useRef<Camera>({ x: 2048, y: 2048, scale: 0.22 });
  const [hint, setHint] = useState<string | null>(null);
  const setState = useStore((s) => s.set);
  const eventPlacement = useStore((s) => s.eventPlacement);
  const followSelection = useStore((s) => s.followSelection);
  const inspection = useStore((s) => s.inspection);

  // Keep the latest values readable from inside the rAF loop without
  // re-subscribing it every render.
  const followRef = useRef(followSelection);
  followRef.current = followSelection;
  const inspectionRef = useRef(inspection);
  inspectionRef.current = inspection;
  const placementRef = useRef(eventPlacement);
  placementRef.current = eventPlacement;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let disposed = false;
    let raf = 0;
    let observer: ResizeObserver | null = null;
    const client = getClient();

    createRenderer(canvas).then((renderer) => {
      if (disposed) {
        renderer.destroy();
        return;
      }
      rendererRef.current = renderer;
      setState({ backend: renderer.backend });

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const resize = () => {
        const r = wrap.getBoundingClientRect();
        renderer.resize(r.width, r.height, dpr);
      };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(wrap);

      // Frame the whole world on first paint.
      const rect = wrap.getBoundingClientRect();
      cameraRef.current.scale = (Math.min(rect.width, rect.height) * dpr) / client.worldSize;
      cameraRef.current.x = client.worldSize / 2;
      cameraRef.current.y = client.worldSize / 2;

      const loop = () => {
        raf = requestAnimationFrame(loop);
        const terrain = client.takeTerrain();
        if (terrain) renderer.updateTerrain(terrain.pixels, terrain.grid);

        if (followRef.current && inspectionRef.current) {
          const cam = cameraRef.current;
          cam.x += (inspectionRef.current.x - cam.x) * 0.12;
          cam.y += (inspectionRef.current.y - cam.y) * 0.12;
        }

        // The listening point follows the camera, so what is audible is what
        // is on screen. The client throttles this and ignores it entirely
        // while nothing is listening.
        {
          const cam = cameraRef.current;
          const r = wrap.getBoundingClientRect();
          const halfWidth = (r.width * dpr) / 2 / cam.scale;
          client.trackListener(cam.x, cam.y, Math.max(240, Math.min(1600, halfWidth * 1.2)));
        }

        if (client.snapshot) {
          renderer.render(
            client.snapshot,
            client.count,
            cameraRef.current,
            client.worldSize,
            performance.now() / 1000,
          );
        }
      };
      raf = requestAnimationFrame(loop);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, [setState]);

  // ---- interaction ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const client = getClient();
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    const toWorld = (clientX: number, clientY: number) => {
      const r = wrap.getBoundingClientRect();
      const cam = cameraRef.current;
      const px = (clientX - r.left) * dpr;
      const py = (clientY - r.top) * dpr;
      return {
        x: cam.x + (px - (r.width * dpr) / 2) / cam.scale,
        y: cam.y + (py - (r.height * dpr) / 2) / cam.scale,
      };
    };

    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      const cam = cameraRef.current;
      cam.x -= (dx * dpr) / cam.scale;
      cam.y -= (dy * dpr) / cam.scale;
      if (moved > 4) useStore.getState().set({ followSelection: false });
    };

    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
      if (moved > 5) return; // it was a pan, not a click

      const p = toWorld(e.clientX, e.clientY);
      const placing = placementRef.current;
      if (placing) {
        client.worldEvent({ type: placing as WorldEventTypeId, x: p.x, y: p.y });
        useStore.getState().set({ eventPlacement: null });
        setHint(null);
        return;
      }
      // Pick radius scales with zoom so clicking stays forgiving when zoomed out.
      client.pick(p.x, p.y, Math.max(12, 26 / cameraRef.current.scale));
      useStore.getState().set({ showInspector: true });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const before = toWorld(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0016);
      cam.scale = Math.min(14, Math.max(0.03, cam.scale * factor));
      const after = toWorld(e.clientX, e.clientY);
      // Zoom about the cursor: keep the world point under the pointer fixed.
      cam.x += before.x - after.x;
      cam.y += before.y - after.y;
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  useEffect(() => {
    if (eventPlacement) {
      const info = WORLD_EVENT_INFO[eventPlacement as WorldEventTypeId];
      setHint(`Click the map to place: ${info?.label ?? eventPlacement}`);
    } else {
      setHint(null);
    }
  }, [eventPlacement]);

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-ground">
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${eventPlacement ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />
      {hint && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 border border-warn/40 bg-panel/90 px-3 py-1.5 text-[11px] text-warn">
          {hint}
          <span className="ml-2 text-ink-dim">esc to cancel</span>
        </div>
      )}
      <CameraReadout cameraRef={cameraRef} />
    </div>
  );
}

/** Zoom/position readout, updated outside React's render cycle. */
function CameraReadout({ cameraRef }: { cameraRef: React.RefObject<Camera> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const c = cameraRef.current;
      if (ref.current) {
        ref.current.textContent = `x ${c.x.toFixed(0)}  y ${c.y.toFixed(0)}  ×${c.scale.toFixed(2)}`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraRef]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute bottom-2 left-2 bg-ground/70 px-2 py-1 text-[10px] text-ink-dim"
    />
  );
}
