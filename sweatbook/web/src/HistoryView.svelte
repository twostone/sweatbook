<script lang="ts">
  import Icon from "./Icon.svelte";
  import SessionRow from "./SessionRow.svelte";
  import * as api from "./api";
  import { goUp, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { SessionSummary } from "./types";

  // Every session, newest first, page by page.
  let sessions = $state<SessionSummary[]>([]);
  let more = $state(false); // the last page was full, so older sessions may exist
  let loaded = $state(false);
  const PAGE = 20; // sessions per load

  async function load(before?: string) {
    await guard(async () => {
      const page = await api.listSessions(PAGE, before);
      sessions = before ? [...sessions, ...page] : page;
      more = page.length === PAGE;
    });
    loaded = true;
  }

  $effect(() => {
    load();
  });
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zum Start" onclick={() => goUp(paths.start())}><Icon name="back" /></button>
    <span class="label">Start</span>
  </header>
  <main>
    <h1 class="display page-title">Verlauf</h1>
    {#each sessions as s (s.id)}
      <SessionRow session={s} />
    {:else}
      {#if loaded}<p class="empty">Noch keine Sessions.</p>{/if}
    {/each}
    {#if more}
      <button type="button" class="btn" onclick={() => load(sessions.at(-1)?.started_at)}>Mehr laden</button>
    {/if}
  </main>
</div>
