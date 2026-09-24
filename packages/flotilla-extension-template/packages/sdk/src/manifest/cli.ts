#!/usr/bin/env node

import { Command, Option } from 'commander';
import { mkdirSync, realpathSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import {
  generateSmartWidgetEvent,
  formatWidgetEvent,
  generateWidgetJson,
  generatePublishingInstructions,
  normalizeSharedConfigDeclaration,
  type SharedConfigDeclaration,
  type SlotConfig,
  type SmartWidgetType,
  type WidgetSlotType,
} from './generator.js';
import type { WidgetPermission } from '../types.js';

export interface CLIOptions {
  type: SmartWidgetType;
  appUrl: string;
  fallbackAppUrls?: string;
  icon: string;
  image: string;
  buttonTitle: string;
  identifier?: string;
  title: string;
  version?: string;
  changelog?: string;
  permissions: string;
  nostrKinds?: string;
  pubkey?: string;
  output: string;
  slotType?: string;
  slotLabel?: string;
  slotPath?: string;
  visibility?: 'host' | 'widget';
  sharedConfig?: string[];
}

function parsePermissions(csv: string): WidgetPermission[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0) as WidgetPermission[];
}

function parseNostrKinds(csv: string | undefined): number[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function parseFallbackAppUrls(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((url) => url.trim())
    .filter(Boolean);
}

export function parseSharedConfigDeclarations(values: string[] = []): SharedConfigDeclaration[] {
  return values.map((value) => {
    const separator = value.indexOf('=');
    if (
      separator <= 0 ||
      separator === value.length - 1 ||
      value.indexOf('=', separator + 1) >= 0
    ) {
      throw new Error('--shared-config must use namespace=key');
    }
    return normalizeSharedConfigDeclaration({
      namespace: value.slice(0, separator),
      key: value.slice(separator + 1),
    });
  });
}

function getIdentifierFromEventTags(tags: string[][]): string {
  return tags.find((t) => t[0] === 'd')?.[1] ?? '';
}

export const SUPPORTED_SLOT_TYPES: WidgetSlotType[] = [
  'repo-tab',
  'community-home-before-quicklinks',
  'community-home-after-quicklinks',
  'community-home-quicklinks',
  'chat-message-actions',
  'global-menu',
];

function isWidgetSlotType(value: string): value is WidgetSlotType {
  return SUPPORTED_SLOT_TYPES.includes(value as WidgetSlotType);
}

export function buildSlotConfig(options: CLIOptions): SlotConfig | undefined {
  if (!options.slotType && !options.slotLabel && !options.slotPath) return undefined;
  if (!options.slotType) throw new Error('--slot-type is required when configuring a slot');

  const type = options.slotType.trim();
  if (!isWidgetSlotType(type)) {
    throw new Error(
      `Unsupported slot type "${options.slotType}". Supported slots: ${SUPPORTED_SLOT_TYPES.join(', ')}`
    );
  }

  const label = options.slotLabel?.trim();
  if (!label) throw new Error('--slot-label is required when configuring a slot');

  if (type === 'repo-tab') {
    const path = options.slotPath?.trim();
    if (!path) throw new Error('--slot-path is required for repo-tab slots');
    return { type, label, path };
  }

  if (options.slotPath?.trim()) {
    throw new Error('--slot-path is only valid for repo-tab slots');
  }

  return { type, label };
}

const program = new Command();

program
  .name('generate-widget')
  .description('Generate a Smart Widget (kind 30033) event + widget.json for BudaBit')
  .addOption(
    new Option('--type <tool|action>', 'Smart Widget type (iframe-based)')
      .choices(['tool', 'action'])
      .default('tool')
  )
  .requiredOption('--title <title>', 'Widget title (maps to event.content)')
  .requiredOption('--app-url <url>', 'Iframe app URL (maps to button tag of type app)')
  .option('--fallback-app-urls <urls>', 'Comma- or newline-separated fallback iframe app URLs')
  .requiredOption('--icon <url>', 'Icon URL (maps to icon tag; required for action/tool widgets)')
  .requiredOption('--image <url>', 'Image URL (maps to image tag; required)')
  .option('--button-title <title>', 'Button label (maps to button tag label)', 'Open')
  .option(
    '--identifier <d>',
    'Widget identifier (d tag). Use an explicit stable value for releases. If omitted, a stable identifier is derived.'
  )
  .option('--version <version>', 'Optional release version tag (for BudaBit update summaries)')
  .option('--changelog <text>', 'Optional release changelog tag (for BudaBit update summaries)')
  .option(
    '--permissions <csv>',
    'Comma-separated permissions (permission tags)',
    'nostr:publish,ui:toast'
  )
  .option(
    '--nostr-kinds <csv>',
    'Comma-separated Nostr event kinds this widget queries (e.g. "30301,30302")'
  )
  .option('--pubkey <hex>', 'Optional creator pubkey (hex) for widget.json (discovery tooling)')
  .option('--output <dir>', 'Output directory', 'dist/widget')
  .option('--slot-type <type>', `Supported slot type: ${SUPPORTED_SLOT_TYPES.join(', ')}`)
  .option('--slot-label <label>', 'Slot display label')
  .option('--slot-path <path>', 'Repo-tab URL path segment')
  .addOption(
    new Option('--visibility <mode>', 'Inline surface visibility policy').choices([
      'host',
      'widget',
    ])
  )
  .option(
    '--shared-config <namespace=key>',
    'Shared community config declaration (repeatable)',
    (value, previous: string[]) => [...previous, value],
    []
  )
  .action((options: CLIOptions) => {
    try {
      const permissions = parsePermissions(options.permissions);
      const slot = buildSlotConfig(options);
      const fallbackAppUrls = parseFallbackAppUrls(options.fallbackAppUrls);
      const sharedConfigs = parseSharedConfigDeclarations(options.sharedConfig);

      const nostrKinds = parseNostrKinds(options.nostrKinds);

      const event = generateSmartWidgetEvent({
        identifier: options.identifier,
        title: options.title,
        widgetType: options.type,
        imageUrl: options.image,
        iconUrl: options.icon,
        appUrl: options.appUrl,
        fallbackAppUrls,
        buttonTitle: options.buttonTitle,
        version: options.version,
        changelog: options.changelog,
        permissions,
        slot,
        visibility: options.visibility,
        nostrKinds,
        sharedConfigs,
      });

      const eventJson = formatWidgetEvent(event);
      const widgetJson = generateWidgetJson({
        pubkey: options.pubkey,
        title: options.title,
        appUrl: options.appUrl,
        iconUrl: options.icon,
        imageUrl: options.image,
        buttonTitle: options.buttonTitle,
        tags: [],
      });

      const instructions = generatePublishingInstructions();

      mkdirSync(options.output, { recursive: true });

      const eventPath = join(options.output, 'event.json');
      const widgetJsonPath = join(options.output, 'widget.json');
      const instructionsPath = join(options.output, 'PUBLISHING.md');

      writeFileSync(eventPath, eventJson);
      writeFileSync(widgetJsonPath, widgetJson);
      writeFileSync(instructionsPath, instructions);

      const identifier = getIdentifierFromEventTags(event.tags);

      console.log('✅ Smart Widget files generated successfully!\n');
      if (!options.identifier?.trim()) {
        console.warn(
          '⚠️  Release tip: pass --identifier <stable-d> and reuse it for every public release.\n'
        );
      }
      console.log(`🧩 Widget type: ${options.type}`);
      console.log(`🆔 Identifier (d): ${identifier}`);
      if (options.version?.trim()) console.log(`🏷️  Version: ${options.version.trim()}`);
      if (options.changelog?.trim()) console.log(`📝 Changelog: ${options.changelog.trim()}`);
      console.log(`🌐 App URL: ${options.appUrl}`);
      if (fallbackAppUrls.length > 0)
        console.log(`🪞 Fallback app URLs: ${fallbackAppUrls.length}`);
      console.log('📡 Relay targets: tagged community relays (resolved when publishing)\n');
      console.log(`📄 Event (unsigned): ${eventPath}`);
      console.log(`🪪 widget.json: ${widgetJsonPath}`);
      console.log(`📖 Publishing instructions: ${instructionsPath}\n`);
      console.log('Next steps:');
      console.log('  1. Sign event.json with nostr-tools (see PUBLISHING.md)');
      console.log('  2. Publish to the relays declared by the tagged community');
      console.log('  3. Install in BudaBit using the resulting naddr\n');
    } catch (error) {
      console.error('❌ Error generating Smart Widget:', error);
      process.exit(1);
    }
  });

// pnpm's workspace bin shim invokes this file through the consumer's SDK symlink.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  program.parse();
}
