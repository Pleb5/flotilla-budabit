import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Check for watch mode flag
const watchMode = process.argv.includes('--watch') || process.argv.includes('-w');

// Read the crypto polyfill banner
const banner = fs.readFileSync(path.join(rootDir, 'src/worker/crypto-polyfill-banner.js'), 'utf-8');

const buildOptions = {
  entryPoints: [path.join(rootDir, 'dist/worker/worker.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(rootDir, 'dist/worker/worker.bundle.js'),
  // Bundle comlink into the worker - it's needed for worker communication
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  banner: {
    js: banner,
  },
  plugins: [{
    name: 'browser-factory-redirect',
    setup(build) {
      // Redirect any import of factory.js from within the git directory to factory-browser.js
      // This catches ./factory.js, ../git/factory.js, ../../git/factory.js, etc.
      build.onResolve({ filter: /factory\.js$/ }, (args) => {
        // Check if this is the git factory (importer is in git directory or path contains git/)
        const isGitFactory = args.importer.includes('/git/') || args.path.includes('git/factory.js');
        const isNotBrowser = !args.path.includes('factory-browser');
        const isNotOtherFactory = !args.path.includes('provider-factory') &&
                                   !args.path.includes('nostr-git-factory') &&
                                   !args.path.includes('vendor-provider-factory') &&
                                   !args.path.includes('errors/factory');

        if (isGitFactory && isNotBrowser && isNotOtherFactory) {
          // Check if this resolves to the git/factory.js file
          const resolved = path.resolve(path.dirname(args.importer), args.path);
          if (resolved.includes('/git/factory.js')) {
            const browserPath = resolved.replace('/git/factory.js', '/git/factory-browser.js');
              return { path: browserPath };
          }
        }
        return null;
      });

      // Mark Node.js built-ins as external (they won't be used in browser)
      const nodeBuiltins = ['fs', 'path', 'http', 'https', 'url', 'querystring', 'crypto', 'stream', 'zlib', 'net', 'tls', 'child_process', 'os'];
      for (const mod of nodeBuiltins) {
        build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
          path: mod,
          external: true,
        }));
      }
      // Also mark isomorphic-git/http/node as external
      build.onResolve({ filter: /^isomorphic-git\/http\/node$/ }, () => ({
        path: 'isomorphic-git/http/node',
        external: true,
      }));
    },
  }],
};

if (watchMode) {
  // Use esbuild context for watch mode
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Worker bundler watching for changes...');
} else {
  // Single build
  await esbuild.build(buildOptions);
  console.log('Worker bundle created successfully');
}
