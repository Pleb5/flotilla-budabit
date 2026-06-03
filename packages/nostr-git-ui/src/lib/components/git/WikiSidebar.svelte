<script lang="ts">
  import { Book, Search, ChevronDown, ChevronRight, Link as LinkIcon, List } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  import { Collapsible } from "../../components";
  const { Input } = useRegistry();

  interface WikiPage {
    id: string;
    title: string;
    children?: WikiPage[];
  }

  const {
    selectedPage,
    onSelectPage,
  }: {
    selectedPage: string;
    onSelectPage: (page: string) => void;
  } = $props();

  const wikiPages = $derived(() => [
    { id: "1", title: "Home" },
    { id: "2", title: "Getting Started" },
    {
      id: "3",
      title: "Features",
      children: [
        { id: "3-1", title: "Git Integration" },
        { id: "3-2", title: "Nostr Protocol" },
        { id: "3-3", title: "Pull Request Management" },
      ],
    },
    { id: "4", title: "Installation" },
    { id: "5", title: "API Reference" },
    { id: "6", title: "Contributing" },
    { id: "7", title: "FAQ" },
  ]);

  let searchQuery = $state("");
  let openSections: string[] = ["3"];

  const toggleSection = (id: string) =>
    (openSections = openSections.includes(id)
      ? openSections.filter((s) => s !== id)
      : [...openSections, id]);

  function renderPages(pages: WikiPage[]) {
    return pages.map((p) => ({
      ...p,
      hasChildren: p.children && p.children.length > 0,
      isOpen: openSections.includes(p.id),
    }));
  }
</script>

<div class="w-60 shrink-0 border-r border-border">
  <div class="p-4">
    <!-- search -->
    <div class="relative mb-4">
      <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input placeholder="Search wiki…" class="pl-8 h-8 bg-secondary/50" bind:value={searchQuery} />
    </div>

    <!-- heading -->
    <div class="flex items-center gap-2 mb-4 p-2 bg-secondary/20 rounded-md">
      <Book class="h-5 w-5 text-primary" />
      <span class="font-semibold text-sm">Wiki Pages</span>
    </div>

    <!-- nav -->
    <nav class="space-y-1">
      {#each renderPages(wikiPages()) as page (page.id)}
        {#if page.hasChildren}
          <Collapsible bind:open={page.isOpen} class="mb-1">
            <div class="flex items-center">
              <button
                class="flex w-full items-center gap-2 rounded-md p-2 hover:bg-muted/50"
                onclick={() => toggleSection(page.id)}
              >
                {#if page.isOpen}
                  <ChevronDown class="h-4 w-4" />
                {:else}
                  <ChevronRight class="h-4 w-4" />
                {/if}
                <span class="text-sm font-medium">{page.title}</span>
              </button>
            </div>

            {#if page.isOpen}
              <div class="ml-4 pl-2 border-l border-border">
                {#each page.children as child (child.id)}
                  <button
                    type="button"
                    class="flex items-center gap-2 p-2 ml-2 rounded-md text-sm cursor-pointer transition-colors
                             {selectedPage === child.title
                      ? 'bg-accent/20 text-accent'
                      : 'hover:bg-muted/50'}"
                    onclick={() => onSelectPage(child.title)}
                  >
                    <Book class="h-4 w-4" />
                    <span>{child.title}</span>
                  </button>
                {/each}
              </div>
            {/if}
          </Collapsible>
        {:else}
          <button
            type="button"
            class="flex items-center gap-2 p-2 ml-4 rounded-md text-sm cursor-pointer transition-colors
                     {selectedPage === page.title
              ? 'bg-accent/20 text-accent'
              : 'hover:bg-muted/50'}"
            onclick={() => onSelectPage(page.title)}
          >
            <Book class="h-4 w-4" /> <span>{page.title}</span>
          </button>
        {/if}
      {/each}
    </nav>

    <!-- footer -->
    <div class="mt-8 space-y-2 pt-4 border-t border-border">
      <button
        class="flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground hover:bg-muted/50"
      >
        <LinkIcon class="h-4 w-4" /> <span>External Links</span>
      </button>
      <button
        class="flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground hover:bg-muted/50"
      >
        <List class="h-4 w-4" /> <span>All Pages</span>
      </button>
    </div>
  </div>
</div>
