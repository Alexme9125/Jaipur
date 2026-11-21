import css from './Backdrop.module.css';

/**
 * Quiet architectural studio canvas: calm directional light + subtle matte
 * paper grain. Intentionally free of blurry neon blobs or glassmorphism gimmicks.
 */
export function Backdrop() {
  return (
    <div className={css.backdrop} aria-hidden="true">
      <div className={css.light} />
      <div className={css.grain} />
    </div>
  );
}
