import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import css from './Sheet.module.css';

export function Sheet(props: {
  title?: string;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <motion.div
      className={css.veil}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={props.onClose}
    >
      <motion.div
        className={css.sheet}
        role="dialog"
        aria-modal="true"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 24, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }}
        onClick={(e) => e.stopPropagation()}
        style={props.wide ? { maxWidth: 760 } : undefined}
      >
        {props.onClose && (
          <button type="button" className={css.close} onClick={props.onClose} aria-label="关闭">
            ✕
          </button>
        )}
        {props.title && <h2 className={css.title}>{props.title}</h2>}
        {props.children}
      </motion.div>
    </motion.div>
  );
}
