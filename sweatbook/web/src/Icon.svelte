<script lang="ts">
  type Name = "back" | "arrow-left" | "arrow-right" | "plus" | "check" | "more" | "note" | "search" | "close" | "pencil" | "up" | "down" | "chevron" | "list";
  let { name, size = 22 }: { name: Name; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === "back"}
    <path d="M15 18l-6-6 6-6" />
  {:else if name === "chevron"}
    <path d="M9 18l6-6-6-6" />
  {:else if name === "arrow-left"}
    <path d="M19 12H5M11 18l-6-6 6-6" />
  {:else if name === "arrow-right"}
    <path d="M5 12h14M13 6l6 6-6 6" />
  {:else if name === "plus"}
    <path d="M12 5v14M5 12h14" />
  {:else if name === "check"}
    <path d="M5 12l5 5L20 7" />
  {:else if name === "more"}
    <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
  {:else if name === "note"}
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  {:else if name === "search"}
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
  {:else if name === "close"}
    <path d="M18 6L6 18M6 6l12 12" />
  {:else if name === "pencil"}
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
  {:else if name === "list"}
    <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
  {:else if name === "up"}
    <path d="M6 15l6-6 6 6" />
  {:else if name === "down"}
    <path d="M6 9l6 6 6-6" />
  {/if}
</svg>
