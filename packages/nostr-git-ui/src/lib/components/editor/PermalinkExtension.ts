import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { type EventTemplate, type NostrEvent } from "nostr-tools";
import { PermalinkNode } from "./PermalinkNodeView.svelte";
import type { Component } from "svelte";
import { isPermalink } from "@nostr-git/core/git";
import Spinner from "./Spinner.svelte";

export interface PermalinkExtensionOptions {
  signer: (event: EventTemplate) => Promise<NostrEvent>;
  relays: string[];
  spinnerComponent: Component;
}

export const PermalinkExtension = Extension.create<PermalinkExtensionOptions>({
  name: "permalinkExtension",

  addOptions() {
    return {
      signer: () => {
        throw new Error("nostr.signEvent is not available");
      },
      relays: ["wss://relay.sharegap.net"],
      spinnerComponent: Spinner,
    };
  },

  addExtensions() {
    return [
      PermalinkNode.configure({
        signer: this.options.signer,
        relays: this.options.relays,
        spinnerComponent: this.options.spinnerComponent,
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("permalinkHandler"),
        props: {
          handlePaste: (view, event) => {
            const pastedText = event.clipboardData?.getData("text/plain");
            if (!pastedText) {
              return false;
            }

            if (isPermalink(pastedText)) {
              event.preventDefault();

              const { state, dispatch } = view;
              const permalinkNodeType = state.schema.nodes.permalinkNode;
              if (!permalinkNodeType) {
                console.warn("PermalinkNode type not found in schema.");
                return false;
              }

              const node = permalinkNodeType.create({
                permalink: pastedText,
                isLoading: true,
              });

              dispatch(state.tr.replaceSelectionWith(node));
              return true;
            } else {
              return false;
            }
          },
        },
      }),
    ];
  },
});
