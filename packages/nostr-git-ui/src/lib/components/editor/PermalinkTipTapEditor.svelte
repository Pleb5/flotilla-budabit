<script lang="ts">
  import { Editor } from "@tiptap/core";
  import StarterKit from "@tiptap/starter-kit";
  import { PermalinkExtension } from "./PermalinkExtension.js";
  import { onDestroy, onMount } from "svelte";
  import Spinner from "./Spinner.svelte";

  let element: HTMLElement;
  let editor: Editor;

  onMount(() => {
    editor = new Editor({
      element: element,
      extensions: [
        StarterKit,
        PermalinkExtension.configure({
          signer: () => {
            throw new Error("nostr.signEvent is not available");
          },
          spinnerComponent: Spinner,
        }),
      ],
      content: "<p>Paste a link!</p>",
    });
  });

  onDestroy(() => {
    editor?.destroy();
  });
</script>

<div bind:this={element}></div>
