import '@fontsource/jost/300.css';
import '@fontsource/jost/400.css';
import '@fontsource/jost/500.css';
import './ui/base.css';
import { createGame } from './game.js';
import { t } from './core/i18n.js';

createGame().catch((err) => {
  console.error('[main] fatal', err);
  const boot = document.getElementById('boot');
  if (boot) {
    const msg = document.createElement('div');
    msg.className = 'boot-error';
    msg.textContent = t(
      {
        en: 'Ø Universe could not start.\n{err}\n\nCheck that your browser supports WebGL2.',
        nl: 'Ø Universe kon niet starten.\n{err}\n\nControleer of je browser WebGL2 ondersteunt.',
      },
      { err: err?.message || err },
    );
    boot.appendChild(msg);
  }
});
