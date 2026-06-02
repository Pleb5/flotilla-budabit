#!/usr/bin/env node

import { Command, Option } from 'commander';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  generateSmartWidgetEvent,
  formatWidgetEvent,
  generateWidgetJson,
  generatePublishingInstructions,
  type SmartWidgetType,
} from './generator.js';
import type { WidgetPermission } from '@flotilla/ext-shared';

interface CLIOptions {
  type: SmartWidgetType;
  appUrl: string;
  icon: string;
  image: string;
  buttonTitle: string;
  identifier?: string;
  title: string;
  permissions: string;
  nostrKinds?: string;
  pubkey?: string;
  output: string;
  slotType?: string;
  slotLabel?: string;
  slotPath?: string;
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

function getIdentifierFromEventTags(tags: string[][]): string {
  return tags.find((t) => t[0] === 'd')?.[1] ?? '';
}

const program = new Command();

program
  .name('generate-widget')
  .description('Generate a Smart Widget (kind 30033) event + widget.json for Flotilla')
  .addOption(
    new Option('--type <tool|action>', 'Smart Widget type (iframe-based)').choices(['tool', 'action']).default('tool')
  )
  .requiredOption('--title <title>', 'Widget title (maps to event.content)')
  .requiredOption('--app-url <url>', 'Iframe app URL (maps to button tag of type app)')
  .requiredOption('--icon <url>', 'Icon URL (maps to icon tag; required for action/tool widgets)')
  .requiredOption('--image <url>', 'Image URL (maps to image tag; required)')
  .option('--button-title <title>', 'Button label (maps to button tag label)', 'Open')
  .option('--identifier <d>', 'Widget identifier (d tag). If omitted, a stable identifier is derived.')
  .option(
    '--permissions <csv>',
    'Comma-separated permissions (permission tags)',
    'nostr:publish,ui:toast'
  )
  .option('--nostr-kinds <csv>', 'Comma-separated Nostr event kinds this widget queries (e.g. "30301,30302")')
  .option('--pubkey <hex>', 'Optional creator pubkey (hex) for widget.json (discovery tooling)')
  .option('--output <dir>', 'Output directory', 'dist/widget')
  .option('--slot-type <type>', 'Slot type for integration (e.g., repo-tab)')
  .option('--slot-label <label>', 'Slot display label')
  .option('--slot-path <path>', 'Slot URL path segment')
  .action((options: CLIOptions) => {
    try {
      const permissions = parsePermissions(options.permissions);

      // Build slot config if all slot options are provided
      const slot = options.slotType && options.slotLabel && options.slotPath
        ? { type: options.slotType, label: options.slotLabel, path: options.slotPath }
        : undefined;

      const nostrKinds = parseNostrKinds(options.nostrKinds);

      const event = generateSmartWidgetEvent({
        identifier: options.identifier,
        title: options.title,
        widgetType: options.type,
        imageUrl: options.image,
        iconUrl: options.icon,
        appUrl: options.appUrl,
        buttonTitle: options.buttonTitle,
        permissions,
        slot,
        nostrKinds,
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
      console.log(`🧩 Widget type: ${options.type}`);
      console.log(`🆔 Identifier (d): ${identifier}\n`);
      console.log(`📄 Event (unsigned): ${eventPath}`);
      console.log(`🪪 widget.json: ${widgetJsonPath}`);
      console.log(`📖 Publishing instructions: ${instructionsPath}\n`);
      console.log('Next steps:');
      console.log('  1. Sign event.json with nostr-tools (see PUBLISHING.md)');
      console.log('  2. Publish to Smart Widget relays (e.g. wss://relay.yakihonne.com)');
      console.log('  3. Install in Flotilla using the resulting naddr\n');
    } catch (error) {
      console.error('❌ Error generating Smart Widget:', error);
      process.exit(1);
    }
  });

program.parse();
