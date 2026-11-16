import { readFileSync, writeFileSync } from 'node:fs';

// Runtime libraries bundled by the current browser entry points. Review this
// list whenever imports change; lockfile metadata alone misses nested notices.
const packages = ['react', 'react-dom', 'scheduler', 'lucide-react'];
const notices = packages.map((name) => {
  const directory = new URL(`../node_modules/${name}/`, import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8'));
  return `=== ${name}@${version} ===\n\n${readFileSync(new URL('LICENSE', directory), 'utf8').trim()}\n`;
});
writeFileSync(new URL('../apps/web/public/THIRD_PARTY_NOTICES.txt', import.meta.url),
  `ModelPort browser runtime — third-party notices\n\nThese libraries retain their own copyright and license terms.\nGenerated from the installed packages by scripts/browser-notices.mjs.\nIncludes Lucide's notices for Feather-derived icons. This is not a license grant for provider services or models.\n\n${notices.join('\n')}`);
console.log('Updated browser third-party notices (4 runtime libraries).');
