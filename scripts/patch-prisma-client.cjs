/**
 * Patches the Prisma v7 generated client.ts to replace `import.meta.url` with
 * the CJS-native `__dirname`. This is required because Node.js 20.19+ detects
 * `import.meta` as ESM syntax and loads the file via the ESM loader, where
 * `exports` is undefined — breaking NestJS's CJS compilation output.
 *
 * Run via: node scripts/patch-prisma-client.cjs
 * Called automatically by `npm run prisma:generate`.
 */

const fs = require('fs');
const path = require('path');

const clientPath = path.join(__dirname, '..', 'generated', 'prisma', 'client.ts');
let content = fs.readFileSync(clientPath, 'utf8');

const before = `import { fileURLToPath } from 'node:url'
globalThis['__dirname'] = path.dirname(fileURLToPath(import.meta.url))`;

const after = `// CJS compatibility patch: use __dirname directly instead of import.meta.url
// (Prisma v7 generates ESM-only syntax; Node.js 20.19+ rejects CJS files with import.meta)
globalThis['__dirname'] = __dirname`;

if (content.includes('import.meta.url')) {
  content = content.replace(before, after);
  fs.writeFileSync(clientPath, content, 'utf8');
  console.log('✓ Patched generated/prisma/client.ts (removed import.meta.url)');
} else {
  console.log('✓ generated/prisma/client.ts already patched — skipping');
}
