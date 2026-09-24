// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('offline manifest generation', () => {
  it.each(['', 'https://cdn.example/custom-releases-icon.png'])(
    'expands app/icon URLs and declares exact capabilities (icon override: %s)',
    (iconOverride) => {
      const destination = mkdtempSync(
        join(process.env.TMPDIR || tmpdir(), 'release-manifest-test-')
      );
      const packageJson = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8'));
      const icon = readFileSync(resolve(extensionRoot, 'assets/releases-icon.png'));
      expect(icon.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(icon.readUInt32BE(16)).toBe(512);
      expect(icon.readUInt32BE(20)).toBe(512);
      const iconHash = createHash('sha256').update(icon).digest('hex');
      try {
        execFileSync(
          'bash',
          ['-c', `${packageJson.scripts['manifest:generate']} --output "$MANIFEST_TEST_OUTPUT"`],
          {
            cwd: extensionRoot,
            env: {
              ...process.env,
              WIDGET_APP_URL: 'https://cdn.example/releases.html',
              WIDGET_ICON_URL: iconOverride,
              MANIFEST_TEST_OUTPUT: destination,
              PATH: `${resolve(extensionRoot, 'node_modules/.bin')}:${process.env.PATH}`,
            },
            stdio: 'pipe',
          }
        );
        const event = JSON.parse(readFileSync(join(destination, 'event.json'), 'utf8')) as {
          kind: number;
          tags: string[][];
        };
        expect(event.kind).toBe(30033);
        expect(event.tags.filter((t) => t[0] === 'icon')).toEqual([
          ['icon', iconOverride || `https://blossom.budabit.club/${iconHash}.png`],
        ]);
        expect(event.tags.find((t) => t[0] === 'button')).toContain(
          'https://cdn.example/releases.html'
        );
        expect(event.tags.filter((t) => t[0] === 'permission').map((t) => t[1])).toEqual([
          'nostr:sign',
          'nostr:publish',
          'nostr:query',
          'nostr:subscribe',
          'nostr:unsubscribe',
          'storage:get',
          'storage:set',
          'storage:compareAndSet',
        ]);
        expect(event.tags.filter((t) => t[0] === 'nostrKinds').map((t) => t[1])).toEqual([
          '32267',
          '30063',
          '3063',
          '1063',
          '5401',
        ]);
        expect(JSON.stringify(event)).not.toContain('${');
      } finally {
        rmSync(destination, { recursive: true, force: true });
      }
    }
  );
});
