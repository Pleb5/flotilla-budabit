import { describe, expect, it } from 'vitest';
import { generateSmartWidgetEvent } from './generator.js';
import { parseSharedConfigDeclarations } from './cli.js';

const baseOptions = {
  title: 'Test Widget',
  widgetType: 'tool' as const,
  imageUrl: 'https://example.com/image.png',
  iconUrl: 'https://example.com/icon.png',
  appUrl: 'https://example.com/app/index.html',
  buttonTitle: 'Open',
};

describe('manifest shared config declarations', () => {
  it('emits validated repeatable shared-config tags', () => {
    const sharedConfigs = parseSharedConfigDeclarations([
      'budabit-calendar-widget=featured-event',
      'budabit.calendar=home:header',
    ]);
    const event = generateSmartWidgetEvent({ ...baseOptions, sharedConfigs });

    expect(event.tags.filter((tag) => tag[0] === 'shared-config')).toEqual([
      ['shared-config', 'budabit-calendar-widget', 'featured-event'],
      ['shared-config', 'budabit.calendar', 'home:header'],
    ]);
  });

  it('rejects malformed identifiers', () => {
    expect(() => parseSharedConfigDeclarations(['bad namespace=featured-event'])).toThrow(
      /Invalid shared config namespace/
    );
  });
});
