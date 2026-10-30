<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import ProfileLink from "./ProfileLink.svelte";

  // The bar of a page below the start: back button, a small label, optional actions, and the profile at the right end.
  let {
    label = "",
    backLabel,
    onback,
    actions,
    profile = true,
  }: { label?: string; backLabel: string; onback: () => void; actions?: Snippet; profile?: boolean } = $props();
</script>

<header class="topbar">
  <button type="button" class="icon-btn" aria-label={backLabel} onclick={onback}><Icon name="back" /></button>
  <span class="label grow">{label}</span>
  {@render actions?.()}
  {#if profile}<ProfileLink />{/if}
</header>

<style>
  .grow {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
