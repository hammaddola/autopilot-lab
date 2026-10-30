/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Generates dist/sw.js after the build: the precache list is every emitted file (hashed assets, icons,
 * manifest, offline page) and the cache version is a hash of their contents, so each deploy gets a new
 * versioned cache and old caches are cleaned up on activation.
 */
function serviceWorker(): Plugin {
  return {
    name: 'autopilot-sw',
    apply: 'build',
    closeBundle() {
      const dist = 'dist';
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const f of readdirSync(dir)) {
          const p = join(dir, f);
          if (statSync(p).isDirectory()) walk(p);
          else if (!p.endsWith('.map') && !p.endsWith('sw.js'))
            files.push(relative(dist, p).replace(/\\/g, '/'));
        }
      };
      walk(dist);
      files.sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(dist, f)));
      const version = hash.digest('hex').slice(0, 12);
      const precache = JSON.stringify(['./', ...files.map((f) => `./${f}`)], null, 2);
      const sw = readFileSync('pwa/sw.template.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', precache);
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}

// `base: './'` keeps asset URLs relative so the same build works on GitHub Pages sub-paths and Netlify.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [serviceWorker()],
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
