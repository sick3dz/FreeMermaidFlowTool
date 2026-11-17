import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {spawn} from 'child_process';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function getLatestMtimeMs(targetPath: string): number {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }
  let latest = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const childMtime = getLatestMtimeMs(path.join(targetPath, entry.name));
    if (childMtime > latest) {
      latest = childMtime;
    }
  }
  return latest;
}

function runOfflineBuilderChild(rootDir: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.resolve(rootDir, 'scripts/buildOfflineApp.mjs');
    const child = spawn(process.execPath, [scriptPath, '--out', outPath], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {...process.env, OFFLINE_SINGLEFILE: '1'},
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Offline build exited with code ${code}`));
      }
    });
  });
}

function offlineAppPlugin(rootDir: string): Plugin[] {
  const isOfflineSubBuild = process.env.OFFLINE_SINGLEFILE === '1';
  if (isOfflineSubBuild) {
    return [];
  }

  let inFlightDevBuild: Promise<void> | null = null;

  return [
    {
      name: 'offline-app-prod-emit',
      apply: 'build',
      async closeBundle(error?: Error): Promise<void> {
        if (error) {
          return;
        }
        const {generateSingleFileOfflineHtml} = await import('./scripts/buildOfflineApp.mjs');
        const outPath = path.resolve(rootDir, 'dist/offline-app.html');
        await generateSingleFileOfflineHtml(outPath);
      },
    },
    {
      name: 'offline-app-dev-serve',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/offline-app.html', async (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            next();
            return;
          }
          try {
            const cachePath = path.resolve(rootDir, 'node_modules/.vite/offline-app.html');
            const latestSourceMtime = Math.max(
              getLatestMtimeMs(path.resolve(rootDir, 'index.html')),
              getLatestMtimeMs(path.resolve(rootDir, 'package.json')),
              getLatestMtimeMs(path.resolve(rootDir, 'vite.config.ts')),
              getLatestMtimeMs(path.resolve(rootDir, 'scripts/buildOfflineApp.mjs')),
              getLatestMtimeMs(path.resolve(rootDir, 'src')),
            );
            const cacheMtime = fs.existsSync(cachePath) ? fs.statSync(cachePath).mtimeMs : 0;

            if (!cacheMtime || cacheMtime < latestSourceMtime) {
              if (!inFlightDevBuild) {
                inFlightDevBuild = runOfflineBuilderChild(rootDir, cachePath).finally(() => {
                  inFlightDevBuild = null;
                });
              }
              await inFlightDevBuild;
            }

            const html = fs.readFileSync(cachePath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Length', String(html.byteLength));
            res.setHeader('Cache-Control', 'no-store');
            if (req.method === 'HEAD') {
              res.end();
              return;
            }
            res.end(html);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Offline-Build fehlgeschlagen';
            res.statusCode = 500;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(message);
          }
        });
      },
    },
  ];
}

export default defineConfig(({command}) => {
  const rootDir = import.meta.dirname;
  const isServe = command === 'serve';
  const isOfflineSubBuild = process.env.OFFLINE_SINGLEFILE === '1';

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      ...offlineAppPlugin(rootDir),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      ...(!isOfflineSubBuild
        ? [
            {
              name: 'copy-unbundled-src-assets',
              apply: 'build' as const,
              closeBundle(error?: Error): void {
                if (error) {
                  return;
                }
                const distDir = path.resolve(rootDir, 'dist');
                const srcAssets = path.resolve(rootDir, 'src/assets');
                const distAssets = path.resolve(distDir, 'src/assets');
                if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
                  fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
                }
              },
            },
          ]
        : []),
    ],
    optimizeDeps: {
      exclude: ['mermaid', '@mermaid-js/layout-elk'],
    },
    resolve: {
      alias: {
        '@': path.resolve(rootDir, '.'),
        ...(isServe && !isOfflineSubBuild
          ? {
              mermaid: path.resolve(
                rootDir,
                'node_modules/mermaid/dist/mermaid.esm.min.mjs',
              ),
              '@mermaid-js/layout-elk': path.resolve(
                rootDir,
                'node_modules/@mermaid-js/layout-elk/dist/mermaid-layout-elk.esm.min.mjs',
              ),
            }
          : {}),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
