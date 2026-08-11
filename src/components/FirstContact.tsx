import { useEffect, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { getClient } from '../app/client';
import { MicCapture } from '../audio/mic';
import { Bar, Button, Section, Stat, fmt } from './ui';
import { pitchToHz } from '../sim/acoustics/sound';

/**
 * FIRST CONTACT — Phase 13.
 *
 * You make a noise. It is measured into six numbers and put into the world at
 * a point on the map. Organisms near enough hear it through the same ear they
 * hear each other with, and it arrives with no label attached.
 *
 * There is no path from this panel to any organism's behaviour except through
 * the air. If something starts reacting to you, it is because it learned that
 * your sound tended to precede something that mattered to it — which means it
 * is on you to make that true, repeatedly, with food or with anything else the
 * Events panel can do.
 *
 * The audio never leaves the browser.
 */
export function FirstContact() {
  const micEnabled = useStore((s) => s.micEnabled);
  const micError = useStore((s) => s.micError);
  const micFrame = useStore((s) => s.micFrame);
  const firstContact = useStore((s) => s.firstContact);
  const contactPoint = useStore((s) => s.contactPoint);
  const set = useStore((s) => s.set);
  const [level, setLevel] = useState(0);
  const captureRef = useRef<MicCapture | null>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!micEnabled) {
      captureRef.current?.stop();
      captureRef.current = null;
      setLevel(0);
      return;
    }

    let cancelled = false;
    let raf = 0;
    const capture = new MicCapture();
    captureRef.current = capture;

    capture
      .start()
      .then(() => {
        if (cancelled) {
          capture.stop();
          return;
        }
        set({ micError: null });
        const client = getClient();
        const tick = () => {
          const read = capture.read();
          if (read) {
            setLevel(read.rms);
            drawWave(waveRef.current, read.wave, read.voiced);
            if (read.voiced) {
              const p = useStore.getState().contactPoint;
              const world = client.worldSize;
              const x = p ? p.x : world * 0.5;
              const y = p ? p.y : world * 0.5;
              client.externalSound(x, y, read.frame, 4);
              set({ micFrame: read.frame });
            } else {
              set({ micFrame: null });
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        set({
          micEnabled: false,
          micError: err instanceof Error ? err.message : 'Microphone unavailable',
        });
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      capture.stop();
      captureRef.current = null;
    };
  }, [micEnabled, set]);

  return (
    <Section
      title="First contact"
      right={
        <Button
          active={micEnabled}
          tone="accent"
          onClick={() => set({ micEnabled: !micEnabled })}
          title="Open the microphone. Audio is measured locally into acoustic features and never leaves this page."
        >
          {micEnabled ? 'microphone on' : 'use microphone'}
        </Button>
      }
    >
      {micError && (
        <p className="mb-2 border border-danger/40 bg-panel-2 px-2 py-1 text-[9px] text-danger">
          {micError}
        </p>
      )}

      <div className="mb-2">
        <canvas
          ref={waveRef}
          width={340}
          height={40}
          className="w-full border border-edge/60 bg-ground"
          style={{ imageRendering: 'pixelated' }}
        />
        <div className="mt-1">
          <Bar value={Math.min(1, level * 8)} color="var(--color-accent-2)" height={3} />
        </div>
      </div>

      {micEnabled && (
        <div className="mb-2 grid grid-cols-3 gap-3">
          <Stat
            label="your pitch"
            value={micFrame ? `${pitchToHz(micFrame[0]).toFixed(0)} Hz` : '—'}
            tone="accent"
          />
          <Stat label="noisiness" value={micFrame ? micFrame[2].toFixed(2) : '—'} />
          <Stat label="brightness" value={micFrame ? micFrame[3].toFixed(2) : '—'} />
        </div>
      )}

      <div className="mb-2 flex items-center gap-2">
        <Button
          onClick={() => {
            const client = getClient();
            set({
              contactPoint: contactPoint
                ? null
                : { x: client.worldSize * 0.5, y: client.worldSize * 0.5 },
            });
          }}
          active={contactPoint !== null}
        >
          {contactPoint ? 'sound at fixed point' : 'sound at world centre'}
        </Button>
        <span className="text-[9px] text-ink-dim">
          {contactPoint
            ? `(${contactPoint.x.toFixed(0)}, ${contactPoint.y.toFixed(0)})`
            : 'default position'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="sounds made" value={fmt(firstContact?.sounds ?? 0)} />
        <Stat
          label="toward you"
          value={(firstContact?.humanApproach ?? 0).toFixed(3)}
          tone={(firstContact?.difference ?? 0) > 0.02 ? 'life' : 'default'}
          title="Mean closing rate of listeners in the window after one of your sounds."
        />
        <Stat
          label="toward each other"
          value={(firstContact?.nativeApproach ?? 0).toFixed(3)}
          title="The same measurement for sounds an organism made. This is the comparison that matters."
        />
      </div>

      {(firstContact?.samples ?? 0) < 20 ? (
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          {fmt(firstContact?.samples ?? 0)} listener-samples so far. Nothing is claimed until there
          are at least twenty on each side.
        </p>
      ) : (
        <p className="mt-2 text-[9px] leading-snug text-ink-dim">
          Listeners close on your sounds at {(firstContact!.humanApproach).toFixed(3)} against{' '}
          {(firstContact!.nativeApproach).toFixed(3)} for sounds made by organisms — a difference of{' '}
          <span className={firstContact!.difference > 0 ? 'text-life' : 'text-danger'}>
            {firstContact!.difference > 0 ? '+' : ''}
            {firstContact!.difference.toFixed(3)}
          </span>
          . That is a difference in how they move, not evidence that anything was understood. Your
          sound is an unusual one and novelty alone would produce a difference here.
        </p>
      )}

      <p className="mt-2 border-t border-edge/60 pt-2 text-[9px] leading-snug text-ink-dim">
        There is no code anywhere that maps a human sound to an outcome. If you want a sound of
        yours to come to mean something, you have to make it mean something the way the world does:
        make the same noise, then cause something the organisms care about, and do it enough times
        that the ones who happen to react correctly outlive the ones who do not. It may never work.
      </p>
    </Section>
  );
}

function drawWave(canvas: HTMLCanvasElement | null, wave: Float32Array, voiced: boolean): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = voiced ? 'var(--color-accent)' : '#2a3446';
  ctx.strokeStyle = voiced ? '#5fd3f3' : '#2a3446';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < wave.length; i++) {
    const x = (i / (wave.length - 1)) * w;
    const y = h / 2 - wave[i] * h * 0.45;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
