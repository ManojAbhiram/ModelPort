import { readFileSync, writeFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const rows = Object.entries(lock.packages)
  .filter(([path, entry]) => path.includes('node_modules/') && !entry.link)
  .map(([path, entry]) => ({
    name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
    version: entry.version,
    license: typeof entry.license === 'string' ? entry.license : 'UNDECLARED — review required',
    scope: entry.dev ? 'Development' : 'Runtime/build',
    optional: entry.optional ? 'Yes' : 'No',
  }))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const escape = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const report = `# Dependency License Inventory

Generated from the committed package-lock.json by \`npm run licenses:report\`.
Includes transitive, development, optional, and platform-specific packages; not every entry is shipped or installed on this machine. Runtime/build is lockfile classification, not proof that a dependency is included in the browser bundle.

This is declared package metadata, not a legal clearance or a review of source files and bundled assets. Verify license texts, copyright notices, exceptions and distribution obligations against the exact artifacts you release. The root MIT license covers ModelPort's original material only.

| Package | Version | Declared license | Scope | Optional |
| --- | --- | --- | --- | --- |
${rows.map((row) => `| ${[row.name, row.version, row.license, row.scope, row.optional].map(escape).join(' | ')} |`).join('\n')}

Total lockfile entries: ${rows.length}.
`;
writeFileSync(new URL('../docs/DEPENDENCY-LICENSES.md', import.meta.url), report);
console.log(`Wrote docs/DEPENDENCY-LICENSES.md (${rows.length} entries).`);
const undeclared = rows.filter((row) => row.license.startsWith('UNDECLARED'));
if (undeclared.length) {
  console.error(`${undeclared.length} entries have no declared license; resolve before release.`);
  process.exitCode = 1;
}
