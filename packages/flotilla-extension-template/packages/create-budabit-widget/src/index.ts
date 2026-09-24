#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { resolve, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const templateDir = resolve(__dirname, '..', 'template');

interface ScaffoldOptions {
  description?: string;
  skipInstall?: boolean;
  local?: boolean;
}

function toPackageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function scaffold(projectName: string, options: ScaffoldOptions) {
  const targetDir = resolve(process.cwd(), projectName);
  const packageName = toPackageName(basename(projectName));

  if (existsSync(targetDir)) {
    console.error(`\n  Error: directory "${projectName}" already exists.\n`);
    process.exit(1);
  }

  console.log(`\n  Creating Budabit widget: ${packageName}`);
  console.log(`  Target: ${targetDir}\n`);

  // Copy template
  mkdirSync(targetDir, { recursive: true });
  cpSync(templateDir, targetDir, { recursive: true });

  // Rename dotfiles that npm strips during publish (gitignore → .gitignore, npmrc → .npmrc)
  const dotfileRenames: [string, string][] = [
    ['gitignore', '.gitignore'],
    ['npmrc', '.npmrc'],
  ];
  for (const [from, to] of dotfileRenames) {
    const src = join(targetDir, from);
    const dest = join(targetDir, to);
    if (existsSync(src) && !existsSync(dest)) {
      renameSync(src, dest);
    }
  }

  // Resolve SDK path for --local mode
  const sdkDir = resolve(__dirname, '..', '..', 'sdk');
  const sdkRef = options.local ? `file:${sdkDir}` : '^0.1.0';

  if (options.local) {
    console.log(`  Using local SDK: ${sdkDir}`);
  }

  // Customize package.json files
  const rootPkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'));
  rootPkg.name = packageName;
  rootPkg.description = options.description ?? `Budabit Smart Widget: ${packageName}`;
  rootPkg.version = '0.1.0';
  // Replace SDK version with local path if --local
  if (rootPkg.devDependencies?.['budabit-sdk']) {
    rootPkg.devDependencies['budabit-sdk'] = sdkRef;
  }
  // Rewrite scripts to use the actual package name
  if (rootPkg.scripts) {
    for (const [key, val] of Object.entries(rootPkg.scripts)) {
      if (typeof val === 'string') {
        rootPkg.scripts[key] = (val as string)
          .replace(/@my-widget\/iframe/g, `@${packageName}/iframe`)
          .replace(/--identifier 'my-widget'/g, `--identifier '${packageName}'`)
          .replace(/--title 'My Widget'/g, `--title '${packageName}'`);
      }
    }
  }
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify(rootPkg, null, 2) + '\n');

  // Update iframe-app package name + SDK ref
  const iframePkgPath = join(targetDir, 'packages', 'iframe-app', 'package.json');
  if (existsSync(iframePkgPath)) {
    const iframePkg = JSON.parse(readFileSync(iframePkgPath, 'utf-8'));
    iframePkg.name = `@${packageName}/iframe`;
    if (iframePkg.dependencies?.['budabit-sdk']) {
      iframePkg.dependencies['budabit-sdk'] = sdkRef;
    }
    writeFileSync(iframePkgPath, JSON.stringify(iframePkg, null, 2) + '\n');
  }

  // Customize README title
  const readmePath = join(targetDir, 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf-8');
    writeFileSync(readmePath, readme.replace('# My BudaBit Widget', `# ${packageName}`));
  }

  // Initialize git
  try {
    execSync('git init', { cwd: targetDir, stdio: 'ignore' });
    console.log('  ✓ Initialized git repository');
  } catch {
    // git not available, skip
  }

  // Install dependencies
  if (!options.skipInstall) {
    console.log('  ⏳ Installing dependencies...\n');
    try {
      execSync('pnpm install', { cwd: targetDir, stdio: 'inherit' });
      console.log('\n  ✓ Dependencies installed');
    } catch {
      console.log('\n  ⚠ Failed to install dependencies. Run `pnpm install` manually.');
    }
  } else {
    console.log('  ⊘ Skipping dependency installation (--skip-install)');
  }

  console.log(`
  ✅ Done! Your Budabit widget is ready.

  Next steps:

    cd ${projectName}
    pnpm dev              # Start dev server
    pnpm build            # Build for production
    pnpm test             # Run tests

  To generate a widget manifest:

    pnpm budabit-generate \\
      --title '${packageName}' \\
      --app-url 'https://your-cdn.com/${packageName}/index.html' \\
      --icon 'https://your-cdn.com/${packageName}/icon.png' \\
      --image 'https://your-cdn.com/${packageName}/preview.png' \\
      --identifier '${packageName}' \\
      --version '0.1.0' \\
      --changelog 'Initial release'

  See docs/ for architecture and integration guides.
`);
}

const program = new Command();

program
  .name('create-budabit-widget')
  .description('Scaffold a new Budabit Smart Widget extension project')
  .argument('<project-name>', 'Name of the new widget project')
  .option('-d, --description <text>', 'Project description')
  .option('--skip-install', 'Skip running pnpm install')
  .option('--local', 'Use local SDK via file: reference (for development)')
  .action((projectName: string, options: ScaffoldOptions) => {
    scaffold(projectName, options);
  });

program.parse();
