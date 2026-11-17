import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { build } from 'vite';

const rootDir = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  let outPath = path.resolve(rootDir, 'dist/offline-app.html');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      outPath = path.resolve(rootDir, argv[i + 1]);
      i += 1;
    }
  }
  return { outPath };
}

function escapeInlineScript(jsContent) {
  // Neutralize closing </script tags (case-insensitive) inside string literals,
  // template literals, or comments without altering runtime JS semantics.
  return jsContent.replace(/<\/(script)/gi, '<\\/$1');
}

function escapeInlineStyle(cssContent) {
  return cssContent.replace(/<\/(style)/gi, '<\\/$1');
}

export async function generateSingleFileOfflineHtml(outPath) {
  const tempOutDir = path.resolve(rootDir, 'node_modules/.vite/offline-build-tmp');
  fs.rmSync(tempOutDir, { recursive: true, force: true });

  const previousFlag = process.env.OFFLINE_SINGLEFILE;
  process.env.OFFLINE_SINGLEFILE = '1';

  try {
    await build({
      configFile: path.resolve(rootDir, 'vite.config.ts'),
      logLevel: 'warn',
      publicDir: false,
      define: {
        'import.meta.url': JSON.stringify('file:///offline-app.html'),
      },
      build: {
        outDir: tempOutDir,
        emptyOutDir: true,
        cssCodeSplit: false,
        assetsInlineLimit: 100_000_000,
        chunkSizeWarningLimit: 12_000,
        minify: true,
        rollupOptions: {
          output: {
            format: 'iife',
            codeSplitting: false,
            name: 'MermaidFree2UseOpenApp',
          },
        },
      },
    });

    const builtHtmlPath = path.join(tempOutDir, 'index.html');
    const assetsDir = path.join(tempOutDir, 'assets');
    if (!fs.existsSync(builtHtmlPath) || !fs.existsSync(assetsDir)) {
      throw new Error('Offline build did not emit index.html and assets.');
    }

    const assetFiles = fs.readdirSync(assetsDir);
    const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));
    const cssFiles = assetFiles.filter((f) => f.endsWith('.css'));

    if (jsFiles.length !== 1) {
      throw new Error(`Expected single IIFE JS bundle, found ${jsFiles.length}: ${jsFiles.join(', ')}`);
    }

    const jsContent = fs.readFileSync(path.join(assetsDir, jsFiles[0]), 'utf8');
    const cssContent = cssFiles
      .map((file) => fs.readFileSync(path.join(assetsDir, file), 'utf8'))
      .join('\n');

    let html = fs.readFileSync(builtHtmlPath, 'utf8');

    // Remove Vite's external <script type="module" ...>, <link rel="stylesheet" ...>, and modulepreload links
    html = html
      .replace(/<script\b[^>]*type=["']module["'][^>]*><\/script>\s*/gi, '')
      .replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>\s*/gi, '')
      .replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>\s*/gi, '');

    const inlineStyleTag = `<style id="mermaid-offline-app-style">\n${escapeInlineStyle(cssContent)}\n</style>`;
    const inlineRuntimeScripts = [
      '<script id="mermaid-offline-flag">window.__IS_OFFLINE_SINGLEFILE__ = true;</script>',
      '<!--MERMAID_OFFLINE_SEED_SLOT-->',
      `<script id="mermaid-offline-app-script">\n${escapeInlineScript(jsContent)}\n</script>`,
    ].join('\n    ');

    if (html.includes('</head>')) {
      html = html.replace('</head>', () => `  ${inlineStyleTag}\n  </head>`);
    } else {
      html = `${inlineStyleTag}\n${html}`;
    }

    if (html.includes('</body>')) {
      html = html.replace('</body>', () => `  ${inlineRuntimeScripts}\n  </body>`);
    } else {
      html = `${html}\n${inlineRuntimeScripts}`;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf8');
    return outPath;
  } finally {
    if (previousFlag === undefined) {
      delete process.env.OFFLINE_SINGLEFILE;
    } else {
      process.env.OFFLINE_SINGLEFILE = previousFlag;
    }
    fs.rmSync(tempOutDir, { recursive: true, force: true });
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const { outPath } = parseArgs(process.argv.slice(2));
  generateSingleFileOfflineHtml(outPath)
    .then((written) => {
      const sizeKb = Math.round(fs.statSync(written).size / 1024);
      console.log(`Offline single-file HTML generated: ${written} (${sizeKb} KB)`);
    })
    .catch((err) => {
      console.error('Failed to build offline HTML:', err);
      process.exit(1);
    });
}
