import type { NostrEvent } from "nostr-tools";
import type { UnsignedEvent } from "nostr-tools";
import { NostrGitKind } from "../kinds.js";

export class RepositoryAnnouncement implements UnsignedEvent {
  // Define the structure for NIP-34 repository announcement events
  // This would include fields like repo name, description, tags, etc.
  
  // Required Event fields
  id: string;
  pubkey: string;
  created_at: number;
  kind: number = NostrGitKind.RepositoryAnnouncement;
  tags: string[][];
  content: string;
  sig: string;
  
  constructor(event: NostrEvent) {
    this.id = event.id;
    this.pubkey = event.pubkey;
    this.created_at = event.created_at;
    this.kind = NostrGitKind.RepositoryAnnouncement;
    this.tags = event.tags;
    this.content = event.content;
    this.sig = event.sig;
  }

  static fromEvent(event: NostrEvent): RepositoryAnnouncement {
    return new RepositoryAnnouncement(event);
  }

  get name(): string | undefined {
    return this.tags.find(t => t[0] === 'name')?.[1];
  }

  set name(value: string | undefined) {
    const index = this.tags.findIndex(t => t[0] === 'name');
    if (index >= 0) {
      if (value) {
        this.tags[index][1] = value;
      } else {
        this.tags.splice(index, 1);
      }
    } else if (value) {
      this.tags.push(['name', value]);
    }
  }

  get description(): string | undefined {
    return this.tags.find(t => t[0] === 'description')?.[1];
  }

  set description(value: string | undefined) {
    const index = this.tags.findIndex(t => t[0] === 'description');
    if (index >= 0) {
      if (value) {
        this.tags[index][1] = value;
      } else {
        this.tags.splice(index, 1);
      }
    } else if (value) {
      this.tags.push(['description', value]);
    }
  }

  get web(): string[] | undefined {
    const tag = this.tags.find(t => t[0] === 'web');
    return tag ? tag.slice(1) : undefined;
  }

  set web(value: string[] | undefined) {
    const index = this.tags.findIndex(t => t[0] === 'web');
    if (index >= 0) {
      if (value && value.length > 0) {
        this.tags[index] = ['web', ...value];
      } else {
        this.tags.splice(index, 1);
      }
    } else if (value && value.length > 0) {
      this.tags.push(['web', ...value]);
    }
  }

  get clone(): string[] | undefined {
    const tag = this.tags.find(t => t[0] === 'clone');
    return tag ? tag.slice(1) : undefined;
  }

  set clone(value: string[] | undefined) {
    const index = this.tags.findIndex(t => t[0] === 'clone');
    if (index >= 0) {
      if (value && value.length > 0) {
        this.tags[index] = ['clone', ...value];
      } else {
        this.tags.splice(index, 1);
      }
    } else if (value && value.length > 0) {
      this.tags.push(['clone', ...value]);
    }
  }

  get relays(): string[] | undefined {
    const tag = this.tags.find(t => t[0] === 'relays');
    return tag ? tag.slice(1) : undefined;
  }

  set relays(value: string[] | undefined) {
    const index = this.tags.findIndex(t => t[0] === 'relays');
    if (index >= 0) {
      if (value && value.length > 0) {
        this.tags[index] = ['relays', ...value];
      } else {
        this.tags.splice(index, 1);
      }
    } else if (value && value.length > 0) {
      this.tags.push(['relays', ...value]);
    }
  }

  get maintainers(): string[] | undefined {
    const tag = this.tags.find(t => t[0] === 'maintainers');
    return tag ? tag.slice(1) : undefined;
  }

  set maintainers(value: string[] | undefined) {
    const index = this.tags.findIndex(t => t[0] === 'maintainers');
    if (index >= 0) {
      if (value && value.length > 0) {
        this.tags[index] = ['maintainers', ...value];
      } else {
        this.tags.splice(index, 1);
      }
    } else if (value && value.length > 0) {
      this.tags.push(['maintainers', ...value]);
    }
  }

  get hashtags(): string[] {
    return this.tags
      .filter(t => t[0] === 't')
      .map(t => t[1])
      .filter((v, i, a) => a.indexOf(v) === i); // unique
  }

  set hashtags(value: string[]) {
    // Remove existing t tags
    this.tags = this.tags.filter(t => t[0] !== 't');
    
    // Add new t tags
    for (const tag of value) {
      this.tags.push(['t', tag]);
    }
  }

  get earliestUniqueCommit(): string | undefined {
    const tag = this.tags.find(t => t[0] === 'r' && t[2] === 'euc');
    return tag?.[1];
  }

  set earliestUniqueCommit(value: string | undefined) {
    const index = this.tags.findIndex(t => t[0] === 'r' && t[2] === 'euc');
    if (index >= 0) {
      if (value) {
        this.tags[index][1] = value;
      } else {
        this.tags.splice(index, 1);
      }
    } else if (value) {
      this.tags.push(['r', value, 'euc']);
    }
  }

}