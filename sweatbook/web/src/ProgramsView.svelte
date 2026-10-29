<script lang="ts">
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { goUp, navigate, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { ProgramSummary } from "./types";

  // The programs (plans): progress and the next workout. Opening one shows its weeks.
  let programs = $state<ProgramSummary[]>([]);
  let loaded = $state(false);

  $effect(() => {
    guard(async () => {
      programs = await api.listPrograms();
    }).then(() => (loaded = true));
  });

  const active = $derived(programs.filter((p) => !p.archived));
  const archived = $derived(programs.filter((p) => p.archived));
</script>

{#snippet card(p: ProgramSummary)}
  <a
    class="card program"
    href={paths.program(p.id)}
    onclick={(e) => {
      e.preventDefault();
      navigate(paths.program(p.id));
    }}
  >
    <span class="name">{p.name}</span>
    <span class="muted">{p.done} von {p.total} Einheiten</span>
    {#if p.next}
      <span class="num-text">Nächstes: Woche {p.next.week} · {p.next.label}</span>
    {:else if p.total > 0}
      <span class="num-text">Abgeschlossen</span>
    {/if}
  </a>
{/snippet}

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zum Start" onclick={() => goUp(paths.start())}><Icon name="back" /></button>
    <span class="label">Start</span>
  </header>
  <main>
    <h1 class="display page-title">Pläne</h1>
    {#each active as p (p.id)}
      {@render card(p)}
    {:else}
      {#if loaded}<p class="muted none">Noch kein Plan. Importiere eine Plandatei.</p>{/if}
    {/each}
    {#if archived.length}
      <h2 class="label section">Archiviert</h2>
      {#each archived as p (p.id)}
        {@render card(p)}
      {/each}
    {/if}
  </main>
  <footer>
    <button type="button" class="btn big primary grow" onclick={() => navigate(paths.programImport())}>
      <Icon name="plus" />Importieren
    </button>
  </footer>
</div>

<style>
  .program {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
  }
  .name {
    font: 800 22px/1 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .section {
    margin: 12px 4px 0;
  }
  .none {
    padding: 16px 4px;
  }
  .grow {
    flex: 1;
  }
</style>
