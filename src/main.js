import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import './ui/base.css';
import { createGame } from './game.js';

createGame().catch((err) => {
  console.error('[main] fatal', err);
  const boot = document.getElementById('boot');
  if (boot) {
    const msg = document.createElement('div');
    msg.className = 'boot-error';
    msg.textContent = `Ø Universe kon niet starten.\n${err?.message || err}\n\nControleer of je browser WebGL2 ondersteunt.`;
    boot.appendChild(msg);
  }
});
