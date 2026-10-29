<script lang="ts">
  import { page } from "$app/state";
  import { app, loadSession } from "../../../store.svelte";

  let { children } = $props();

  const sessionId = $derived(page.params.sessionId!);

  // A session page loads its session when it is not the one already shown.
  $effect(() => {
    if (app.session?.id !== sessionId) loadSession(sessionId);
  });
</script>

{#if app.session?.id === sessionId}
  {@render children()}
{:else}
  <p class="empty">Lade …</p>
{/if}
