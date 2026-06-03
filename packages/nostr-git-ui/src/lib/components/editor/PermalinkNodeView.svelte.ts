import {
  mergeAttributes,
  Node,
  nodePasteRule,
  type PasteRuleMatch,
  type RawCommands,
} from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createNeventFromPermalink } from "@nostr-git/core/git";
import type { EventTemplate, NostrEvent } from "nostr-tools";
import type { EventIO } from "@nostr-git/core/types";
import type { MarkdownSerializerState } from "@tiptap/pm/markdown";
import { mount, unmount, type Component } from "svelte";
import Spinner from "./Spinner.svelte";
import PermalinkNodeViewWrapper from "./PermalinkNodeViewWrapper.svelte";

const PERMALINK_REGEX = /https?:\/\/(?:github\.com|gitlab\.com|gitea\.com)\/\S+/gi;

const createPasteRuleMatch = <T extends Record<string, unknown>>(
  match: RegExpMatchArray,
  data: T
): PasteRuleMatch => ({ index: match.index!, replaceWith: match[2], text: match[0], match, data });

interface PermalinkNodeAttrs {
  permalink?: string;
  nevent?: string;
  error?: string;
}

export interface PermalinkNodeOptions {
  signer: (event: EventTemplate) => Promise<NostrEvent>;
  relays: string[];
  spinnerComponent: Component;
}

export const PermalinkNode = Node.create<PermalinkNodeOptions>({
  name: "permalinkNode",

  group: "block",
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      permalink: { default: null },
      nevent: { default: "" },
      error: { default: null },
    };
  },

  addOptions() {
    return {
      signer: () => {
        throw new Error("nostr.signEvent is not available");
      },
      relays: ["wss://relay.sharegap.net"],
      spinnerComponent: Spinner,
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": this.name })];
  },

  renderText({ node }) {
    const { nevent, permalink } = node.attrs;
    return nevent || permalink || "";
  },

  parseHTML() {
    return [{ tag: `div[data-type="${this.name}"]` }];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MarkdownSerializerState, node: ProseMirrorNode) {
          const { nevent } = node.attrs;
          state.write(nevent || "");
        },
        parse: {},
      },
    };
  },

  addCommands() {
    return {
      insertPermalink:
        (url: string) =>
        ({ commands }: { commands: any }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              permalink: url,
              nevent: null,
            },
          });
        },
    } as Partial<RawCommands>;
  },

  addPasteRules() {
    return [
      nodePasteRule({
        type: this.type,
        find: (text) => {
          const matches: PasteRuleMatch[] = [];
          for (const match of text.matchAll(PERMALINK_REGEX)) {
            const rawLink = match[0];
            matches.push(createPasteRuleMatch(match, { permalink: rawLink }));
          }
          return matches;
        },
        getAttributes: (match) => match.data,
      }),
    ];
  },

  addNodeView() {
    return ({ editor, node, getPos }) => {
      let currentNode = node;

      const dom = document.createElement("div");
      dom.classList.add("permalink-node");

      const props = $state({
        Spinner: this.options.spinnerComponent,
        loading: !currentNode.attrs.nevent && !currentNode.attrs.error,
        nevent: currentNode.attrs.nevent,
        permalink: currentNode.attrs.permalink,
        error: currentNode.attrs.error,
      });
      const component = mount(PermalinkNodeViewWrapper, {
        target: dom,
        props,
      });

      function updateNode(attrs: Partial<PermalinkNodeAttrs>) {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, {
            ...currentNode.attrs,
            ...attrs,
          })
        );
      }

      async function maybeFetch(options: PermalinkNodeOptions) {
        if (!currentNode.attrs.nevent && currentNode.attrs.permalink) {
          try {
            const eventIO: EventIO = {
              fetchEvents: async () => [],
              publishEvent: async (unsigned) => {
                await options.signer(unsigned as unknown as EventTemplate);
                return { ok: true, relays: options.relays };
              },
              publishEvents: async (events) => {
                await Promise.all(events.map((e) => options.signer(e as unknown as EventTemplate)));
                return events.map(() => ({ ok: true, relays: options.relays }));
              },
              getCurrentPubkey: () => null,
            };

            const nevent = await createNeventFromPermalink(
              currentNode.attrs.permalink,
              eventIO,
              options.relays
            );
            console.log(nevent);
            updateNode({ nevent });
          } catch (err) {
            updateNode({ error: `(Error: ${String(err)})` });
          }
        }
      }

      maybeFetch(this.options);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== currentNode.type.name) return false;
          currentNode = updatedNode;
          props.loading = !currentNode.attrs.nevent && !currentNode.attrs.error;
          props.nevent = currentNode.attrs.nevent;
          props.permalink = currentNode.attrs.permalink;
          props.error = currentNode.attrs.error;
          return true;
        },
        destroy() {
          unmount(component);
        },
      };
    };
  },
});
