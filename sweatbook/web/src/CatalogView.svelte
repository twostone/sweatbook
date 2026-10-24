<script lang="ts">
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { matches } from "./logic/catalog";
  import { formatShortDate } from "./logic/format";
  import { goUp, navigate, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { Exercise } from "./types";

  // The whole catalog: search, open an exercise, make a new one. Archived ones come last, apart.
  let catalog = $state<Exercise[]>([]);
  let query = $state("");
  let loaded = $state(false);

  $effect(() => {
    guard(async () => {
      catalog = await api.listExercises();
    }).then(() => (loaded = true));
  });

  const found = $derived(catalog.filter((e) => matches(e, query)));
  const active = $derived(found.filter((e) => !e.archived));
  const archived = $derived(found.filter((e) => e.archived));

  const open = (e: Exercise) => navigate(paths.exercise(e.id));
</script>

{#snippet row(e: Exercise)}
  <a
    class="row"
    href={paths.exercise(e.id)}
    onclick={(ev) => {
      ev.preventDefault();
      open(e);
    }}
  >
    <span class="row-name">{e.name}</span>
    <span class="muted small">{e.last_used_at ? `zuletzt ${formatShortDate(e.last_used_at)}` : "unbenutzt"}</span>
    <Icon name="chevron" size={18} />
  </a>
{/snippet}

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zum Start" onclick={() => goUp(paths.start())}><Icon name="back" /></button>
    <span class="label">Start</span>
  </header>
  <main>
    <h1 class="display">Übungskatalog</h1>
    <div class="search">
      <span class="icon"><Icon name="search" size={20} /></span>
      <label class="sr-only" for="catalog-search">Übung suchen</label>
      <input id="catalog-search" class="field" type="search" placeholder="Suchen (Name oder Alias)" autocomplete="off" bind:value={query} />
    </div>
    <div class="card list">
      {#each active as e (e.id)}
        {@render row(e)}
      {:else}
        {#if loaded}<p class="muted none">{query.trim() ? "Keine Übung gefunden." : "Der Katalog ist noch leer."}</p>{/if}
      {/each}
    </div>
    {#if archived.length}
      <h2 class="label section">Archiviert</h2>
      <div class="card list archived">
        {#each archived as e (e.id)}
          {@render row(e)}
        {/each}
      </div>
    {/if}
  </main>
  <footer>
    <button type="button" class="btn big primary grow" onclick={() => navigate(paths.newExercise(query.trim()))}>
      <Icon name="plus" />Übung anlegen
    </button>
  </footer>
</div>

<style>
  h1 {
    font-size: 36px;
    padding: 0 4px 4px;
  }
  .search {
    position: relative;
  }
  .search .icon {
    position: absolute;
    left: 14px;
    top: 14px;
    color: var(--muted);
    display: flex;
  }
  .search .field {
    padding-left: 42px;
  }
  .list {
    padding: 4px 10px;
    display: flex;
    flex-direction: column;
  }
  .row {
    min-height: 52px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--line);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .row :global(svg) {
    color: var(--muted);
    flex: none;
  }
  .row-name {
    flex: 1;
    min-width: 0;
    font-weight: 600;
    font-size: 17px;
    overflow-wrap: anywhere;
  }
  .archived .row-name {
    color: var(--muted);
  }
  .small {
    font-size: 14px;
  }
  .none {
    margin: 12px 0;
  }
  .section {
    margin: 12px 4px 0;
  }
  .grow {
    flex: 1;
  }
</style>
