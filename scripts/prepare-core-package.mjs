import { copyFileSync } from 'node:fs';

// Keep the package's grant identical to the repository's reviewed license.
copyFileSync(new URL('../LICENSE', import.meta.url), new URL('../packages/core/LICENSE', import.meta.url));
