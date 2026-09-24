import { describe, it, expect } from 'vitest';
import {
  generateSmartWidgetEvent,
  formatWidgetEvent,
  generateWidgetJson,
  generatePublishingInstructions,
} from './generator.js';
import {
  buildSlotConfig,
  parseSharedConfigDeclarations,
  SUPPORTED_SLOT_TYPES,
  type CLIOptions,
} from './cli.js';

describe('generateSmartWidgetEvent()', () => {
  const baseOptions = {
    title: 'Test Widget',
    widgetType: 'tool' as const,
    imageUrl: 'https://example.com/image.png',
    iconUrl: 'https://example.com/icon.png',
    appUrl: 'https://example.com/app/index.html',
    buttonTitle: 'Open',
  };

  it('should generate a kind 30033 event', () => {
    const event = generateSmartWidgetEvent(baseOptions);

    expect(event.kind).toBe(30033);
    expect(event.content).toBe('Test Widget');
    expect(typeof event.created_at).toBe('number');
  });

  it('declares deferred inline visibility and rejects unsupported placements', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      visibility: 'widget',
      slot: { type: 'community-home-before-quicklinks', label: 'Call' },
    });
    expect(event.tags).toContainEqual(['visibility', 'widget']);
    expect(() =>
      generateSmartWidgetEvent({
        ...baseOptions,
        visibility: 'widget',
        slot: { type: 'community-home-quicklinks', label: 'Call' },
      })
    ).toThrow(/inline community home slot/);
  });

  it('should include required tags', () => {
    const event = generateSmartWidgetEvent(baseOptions);
    const tagMap = new Map(event.tags.map((t) => [t[0], t]));

    expect(tagMap.get('l')).toEqual(['l', 'tool']);
    expect(tagMap.get('image')).toEqual(['image', 'https://example.com/image.png']);
    expect(tagMap.get('icon')).toEqual(['icon', 'https://example.com/icon.png']);
    expect(tagMap.get('button')).toEqual([
      'button',
      'Open',
      'app',
      'https://example.com/app/index.html',
    ]);
  });

  it('should derive stable identifier from title + appUrl when omitted', () => {
    const event1 = generateSmartWidgetEvent(baseOptions);
    const event2 = generateSmartWidgetEvent(baseOptions);

    const d1 = event1.tags.find((t) => t[0] === 'd')?.[1];
    const d2 = event2.tags.find((t) => t[0] === 'd')?.[1];

    expect(d1).toBe(d2);
    expect(d1).toMatch(/^[a-f0-9]{24}$/);
  });

  it('should use explicit identifier when provided', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      identifier: 'my-custom-id',
    });

    const d = event.tags.find((t) => t[0] === 'd')?.[1];
    expect(d).toBe('my-custom-id');
  });

  it('should add release metadata tags when provided', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      version: '1.2.3',
      changelog: 'Add Blossom-backed release metadata',
    });

    expect(event.tags).toContainEqual(['version', '1.2.3']);
    expect(event.tags).toContainEqual(['changelog', 'Add Blossom-backed release metadata']);
  });

  it('should add ordered fallback app-url tags', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      fallbackAppUrls: [
        'https://cdn.example.com/app/index.html',
        'https://cdn.example.com/app/index.html',
        'https://mirror.example.com/app/index.html',
      ],
    });

    expect(event.tags.filter((t) => t[0] === 'app-url')).toEqual([
      ['app-url', 'https://cdn.example.com/app/index.html'],
      ['app-url', 'https://mirror.example.com/app/index.html'],
    ]);
  });

  it('should generate different identifiers for different inputs', () => {
    const event1 = generateSmartWidgetEvent(baseOptions);
    const event2 = generateSmartWidgetEvent({ ...baseOptions, title: 'Other Widget' });

    const d1 = event1.tags.find((t) => t[0] === 'd')?.[1];
    const d2 = event2.tags.find((t) => t[0] === 'd')?.[1];

    expect(d1).not.toBe(d2);
  });

  it('should add permission tags', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      permissions: ['nostr:publish', 'nostr:query', 'ui:toast'],
    });

    const permTags = event.tags.filter((t) => t[0] === 'permission');
    expect(permTags).toEqual([
      ['permission', 'nostr:publish'],
      ['permission', 'nostr:query'],
      ['permission', 'ui:toast'],
    ]);
  });

  it('should skip empty permission strings', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      permissions: ['nostr:publish', '', '  ', 'ui:toast'],
    });

    const permTags = event.tags.filter((t) => t[0] === 'permission');
    expect(permTags).toHaveLength(2);
  });

  it('should add nostrKinds tags', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      nostrKinds: [30301, 30302],
    });

    const kindTags = event.tags.filter((t) => t[0] === 'nostrKinds');
    expect(kindTags).toEqual([
      ['nostrKinds', '30301'],
      ['nostrKinds', '30302'],
    ]);
  });

  it('should add one shared-config tag per declaration', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      sharedConfigs: [
        { namespace: 'budabit-calendar-widget', key: 'featured-event' },
        { namespace: 'budabit.calendar', key: 'home:header' },
      ],
    });

    expect(event.tags.filter((tag) => tag[0] === 'shared-config')).toEqual([
      ['shared-config', 'budabit-calendar-widget', 'featured-event'],
      ['shared-config', 'budabit.calendar', 'home:header'],
    ]);
  });

  it('should reject shared config parts outside host identifier rules', () => {
    expect(() =>
      generateSmartWidgetEvent({
        ...baseOptions,
        sharedConfigs: [{ namespace: 'bad namespace', key: 'featured-event' }],
      })
    ).toThrow(/Invalid shared config namespace/);
  });

  it('should add repo-tab slot configuration', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      slot: { type: 'repo-tab', label: 'Pipeline', path: 'pipelines' },
    });

    const slotTag = event.tags.find((t) => t[0] === 'slot');
    expect(slotTag).toEqual(['slot', 'repo-tab', 'Pipeline', 'pipelines']);
  });

  it('should add community launcher slot configuration without a path', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      slot: { type: 'chat-message-actions', label: 'Discuss' },
    });

    const slotTag = event.tags.find((t) => t[0] === 'slot');
    expect(slotTag).toEqual(['slot', 'chat-message-actions', 'Discuss']);
  });

  it('should add client tag when provided', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      client: { name: 'budabit', originHint: 'https://budabit.com' },
    });

    const clientTag = event.tags.find((t) => t[0] === 'client');
    expect(clientTag).toEqual(['client', 'budabit', 'https://budabit.com']);
  });

  it('should use custom createdAt timestamp', () => {
    const event = generateSmartWidgetEvent({
      ...baseOptions,
      createdAt: 1700000000,
    });

    expect(event.created_at).toBe(1700000000);
  });
});

describe('parseSharedConfigDeclarations()', () => {
  it('parses repeatable namespace=key values', () => {
    expect(
      parseSharedConfigDeclarations([
        'budabit-calendar-widget=featured-event',
        'budabit.calendar=home:header',
      ])
    ).toEqual([
      { namespace: 'budabit-calendar-widget', key: 'featured-event' },
      { namespace: 'budabit.calendar', key: 'home:header' },
    ]);
  });

  it('rejects malformed declarations', () => {
    expect(() => parseSharedConfigDeclarations(['missing-separator'])).toThrow(/namespace=key/);
    expect(() => parseSharedConfigDeclarations(['namespace=bad key'])).toThrow(
      /Invalid shared config key/
    );
  });
});

describe('buildSlotConfig()', () => {
  const build = (slotOptions: Partial<Pick<CLIOptions, 'slotType' | 'slotLabel' | 'slotPath'>>) =>
    buildSlotConfig(slotOptions as CLIOptions);

  it('should list the supported slot types', () => {
    expect(SUPPORTED_SLOT_TYPES).toEqual([
      'repo-tab',
      'community-home-before-quicklinks',
      'community-home-after-quicklinks',
      'community-home-quicklinks',
      'chat-message-actions',
      'global-menu',
    ]);
  });

  it('should build a repo-tab slot config with a path', () => {
    expect(build({ slotType: 'repo-tab', slotLabel: 'Pipeline', slotPath: 'pipelines' })).toEqual({
      type: 'repo-tab',
      label: 'Pipeline',
      path: 'pipelines',
    });
  });

  it('should build a community slot config without a path', () => {
    expect(build({ slotType: 'global-menu', slotLabel: 'Tools' })).toEqual({
      type: 'global-menu',
      label: 'Tools',
    });
  });

  it('should reject unsupported slots', () => {
    expect(() => build({ slotType: 'unsupported-slot', slotLabel: 'Discuss' })).toThrow(
      /Unsupported slot type/
    );
  });

  it('should require repo-tab slots to include a path', () => {
    expect(() => build({ slotType: 'repo-tab', slotLabel: 'Pipeline' })).toThrow(
      /--slot-path is required/
    );
  });

  it('should reject slot paths for community slots', () => {
    expect(() =>
      build({ slotType: 'chat-message-actions', slotLabel: 'Discuss', slotPath: 'x' })
    ).toThrow(/--slot-path is only valid/);
  });
});

describe('formatWidgetEvent()', () => {
  it('should return pretty-printed JSON', () => {
    const event = generateSmartWidgetEvent({
      title: 'Test',
      widgetType: 'tool',
      imageUrl: 'https://example.com/img.png',
      iconUrl: 'https://example.com/icon.png',
      appUrl: 'https://example.com/app',
      buttonTitle: 'Open',
      createdAt: 1700000000,
    });

    const json = formatWidgetEvent(event);
    const parsed = JSON.parse(json);

    expect(parsed.kind).toBe(30033);
    expect(json).toContain('\n'); // pretty-printed
  });
});

describe('generateWidgetJson()', () => {
  it('should generate valid widget.json content', () => {
    const json = generateWidgetJson({
      title: 'My Widget',
      appUrl: 'https://example.com/app',
      iconUrl: 'https://example.com/icon.png',
      imageUrl: 'https://example.com/image.png',
      buttonTitle: 'Open',
    });

    const parsed = JSON.parse(json);
    expect(parsed.widget.title).toBe('My Widget');
    expect(parsed.widget.appUrl).toBe('https://example.com/app');
    expect(parsed.pubkey).toBeUndefined();
  });

  it('should include pubkey when provided', () => {
    const json = generateWidgetJson({
      title: 'My Widget',
      appUrl: 'https://example.com/app',
      iconUrl: 'https://example.com/icon.png',
      imageUrl: 'https://example.com/image.png',
      buttonTitle: 'Open',
      pubkey: 'hex-pubkey-123',
    });

    const parsed = JSON.parse(json);
    expect(parsed.pubkey).toBe('hex-pubkey-123');
  });
});

describe('generatePublishingInstructions()', () => {
  it('should return markdown with signing instructions', () => {
    const md = generatePublishingInstructions();

    expect(md).toContain('# Publishing');
    expect(md).toContain('finalizeEvent');
    expect(md).toContain('naddr');
    expect(md).toContain('relay');
  });
});
