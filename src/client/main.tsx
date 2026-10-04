import '@fontsource-variable/bricolage-grotesque';
import './styles/tokens.css';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
import { applyTheme, loadTheme } from './game/theme';

applyTheme(loadTheme());

createRoot(document.getElementById('root')!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
);
