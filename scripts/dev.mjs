import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const vite = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--host', '127.0.0.1'], { stdio: 'inherit' });
let electron;
const launch = async () => {
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch('http://127.0.0.1:5187'); if (response.ok) break; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  electron = spawn(require('electron'), ['.'], { stdio: 'inherit', env: { ...process.env, CLERK_DEV_URL: 'http://127.0.0.1:5187' } });
  electron.on('exit', code => { vite.kill(); process.exit(code ?? 0); });
};
vite.on('exit', code => { if (electron) electron.kill(); process.exit(code ?? 1); });
launch();
