import { buildApp } from './app.js';

const development = process.argv.includes('--dev');
const app = await buildApp({ development });
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close();
  });
}

try {
  await app.listen({ host: '127.0.0.1', port: 8787 });
  console.info(development ? 'ModelPort API: http://127.0.0.1:8787 (workbench: http://127.0.0.1:5173)' : 'ModelPort: http://127.0.0.1:8787');
  console.info('Local-only. Credentials stay in process memory. Inference requires explicit approval.');
} catch {
  console.error('ModelPort could not listen on 127.0.0.1:8787. Check whether the port is already in use.');
  await app.close();
  process.exitCode = 1;
}
