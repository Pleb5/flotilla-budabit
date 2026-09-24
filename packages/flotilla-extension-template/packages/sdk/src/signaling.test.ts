import { describe, it, expect } from 'vitest';
import { createEvent, createTextNote, createCustomEvent, validateEvent } from './signaling.js';

describe('signaling helpers', () => {
  describe('createEvent()', () => {
    it('should create an unsigned event with correct fields', () => {
      const event = createEvent(1, 'Hello', [['p', 'abc123']]);

      expect(event.kind).toBe(1);
      expect(event.content).toBe('Hello');
      expect(event.tags).toEqual([['p', 'abc123']]);
      expect(typeof event.created_at).toBe('number');
      expect(event.created_at).toBeGreaterThan(0);
    });

    it('should default tags to empty array', () => {
      const event = createEvent(1, 'Hello');
      expect(event.tags).toEqual([]);
    });

    it('should set created_at to approximately now', () => {
      const before = Math.floor(Date.now() / 1000);
      const event = createEvent(1, '');
      const after = Math.floor(Date.now() / 1000);

      expect(event.created_at).toBeGreaterThanOrEqual(before);
      expect(event.created_at).toBeLessThanOrEqual(after);
    });
  });

  describe('createTextNote()', () => {
    it('should create a kind 1 event', () => {
      const note = createTextNote('Hello, world!');
      expect(note.kind).toBe(1);
      expect(note.content).toBe('Hello, world!');
    });

    it('should accept optional tags', () => {
      const note = createTextNote('reply', [['e', 'parent-id']]);
      expect(note.tags).toEqual([['e', 'parent-id']]);
    });
  });

  describe('createCustomEvent()', () => {
    it('should create an event with contextId and data', () => {
      const event = createCustomEvent('room-123', {
        action: 'pipeline-run',
        status: 'running',
      });

      expect(event.kind).toBe(30000);
      expect(JSON.parse(event.content)).toEqual({
        action: 'pipeline-run',
        status: 'running',
      });
      expect(event.tags).toContainEqual(['h', 'room-123']);
      expect(event.tags).toContainEqual(['alt', 'Custom extension event']);
    });
  });

  describe('validateEvent()', () => {
    it('should return true for allowed kinds', () => {
      const event = createEvent(1, 'test');
      expect(validateEvent(event, [1, 30301])).toBe(true);
    });

    it('should return false for disallowed kinds', () => {
      const event = createEvent(999, 'test');
      expect(validateEvent(event, [1, 30301])).toBe(false);
    });

    it('should return false for empty allowed list', () => {
      const event = createEvent(1, 'test');
      expect(validateEvent(event, [])).toBe(false);
    });
  });
});
