import { useEffect } from 'react';
import css from './Backdrop.module.css';

/**
 * Fixed atmospheric backdrop: dusk gradient, two drifting light pools,
 * grain overlay. Also detects Chromium for the liquid-glass rim.
 */
export function Backdrop() {
  useEffect(() => {
    interface UAData {
      brands?: { brand: string; version: string }[];
    }
    const ua = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
    if (ua?.brands?.some((b) => /Chromium|Chrome/.test(b.brand))) {
      document.documentElement.classList.add('has-liquid');
    }
  }, []);

  return (
    <div className={css.backdrop} aria-hidden="true">
      <div className={`${css.pool} ${css.poolPink}`} />
      <div className={`${css.pool} ${css.poolJal}`} />
      <div className={css.grain} />
      {/* liquid refraction filter, used by the table rim on Chromium */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <filter id="liquid-glass">
          <feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="2" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="18" />
        </filter>
      </svg>
    </div>
  );
}
