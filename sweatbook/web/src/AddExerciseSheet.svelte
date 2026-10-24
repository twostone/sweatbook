<script lang="ts">
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { formatShortDate } from "./logic/format";
  import { navigate, paths, replace } from "./router.svelte";
  import { app, changeSession, closeSheet, closeSheetThen, guard, rememberSheet, type SheetState } from "./store.svelte";
  import type { Exercise } from "./types";

  // Picks an exercise from the catalog for a new block or an existing one (superset). Creates nothing: a missing
  // exercise is made on its own page ("Übung anlegen"), which comes back here with it shown first.
  let { sheet }: { sheet: Extract<SheetState, { kind: "add-exercise" }> } = $props();

  // The form starts from the sheet as opened (or as remembered when coming back from "Übung anlegen").
  let query = $state(untrack(() => app.created?.name ?? sheet.query));
  let results = $state<Exercise[]>([]);
  let busy = $state(false);
  let searchField: HTMLInputElement;

  // Searching is what the sheet is for, so the field gets the focus (the dialog would give it to "Schließen").
  $effect(() => {
    searchField.focus();
  });
  const SEARCH_DELAY_MS = 150;
  const target = untrack(() => sheet.target);
  const block = $derived(target.blockId ? app.session?.blocks.find((b) => b.id === target.blockId) : undefined);

  // The search runs on the server (names and aliases); typing is debounced, and an answer that arrives after a newer
  // search started is dropped.
  let searchNo = 0;
  $effect(() => {
    const q = query.trim();
    const no = ++searchNo;
    const timer = setTimeout(() => {
      guard(async () => {
        const found = (await api.listExercises(q)).filter((e) => !e.archived);
        if (no === searchNo) results = found;
      });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  });

  // The exercise just made on "Übung anlegen" comes first.
  const createdId = $derived(app.created?.id);
  const sorted = $derived(createdId ? [...results].sort((a, b) => Number(b.id === createdId) - Number(a.id === createdId)) : results);

  // Which alias matched, so a hit by alias is understandable.
  function hint(e: Exercise): string {
    const q = query.trim().toLocaleLowerCase("de");
    const alias = q && !e.name.toLocaleLowerCase("de").includes(q) ? e.aliases.find((a) => a.toLocaleLowerCase("de").includes(q)) : undefined;
    if (alias) return `Alias: ${alias}`;
    if (e.id === createdId) return "neu angelegt";
    return e.last_used_at ? `zuletzt ${formatShortDate(e.last_used_at)}` : "";
  }

  async function pick(e: Exercise) {
    if (busy) return;
    busy = true;
    const ok = await changeSession(() => (target.blockId ? api.addExerciseToBlock(target.blockId, e.id) : api.addBlock(target.sessionId, e.id)));
    busy = false;
    if (!ok) return;
    app.created = null;
    const added = app.session!.blocks.at(-1)!;
    // From the last block's page: on to the new block as its sibling, so "back" still leads to the overview.
    if (!target.blockId && target.openAfter) closeSheetThen(() => replace(paths.block(target.sessionId, added.id)));
    else closeSheet();
  }

  // "Übung anlegen" is a page on top of this sheet's history entry: back (or saving) returns to the sheet as it was.
  function createNew() {
    rememberSheet({ kind: "add-exercise", target, query });
    navigate(paths.newExercise(query.trim()));
  }
</script>

<Sheet title={block ? "Zum Supersatz" : "Übung hinzufügen"}>
  {#if block}
    <p class="muted target">Kommt dazu zu: {block.exercises.map((e) => e.exercise.name).join(" + ")}</p>
  {/if}
  <div class="search">
    <span class="icon"><Icon name="search" size={20} /></span>
    <label class="sr-only" for="exercise-search">Übung suchen</label>
    <input id="exercise-search" class="field" type="search" placeholder="Suchen" autocomplete="off" bind:value={query} bind:this={searchField} />
  </div>

  <div class="list">
    <h3 class="label">{query.trim() ? "Treffer" : "Zuletzt genutzt"}</h3>
    {#each sorted as e (e.id)}
      <button type="button" class="row" class:fresh={e.id === createdId} disabled={busy} onclick={() => pick(e)}>
        <span>{e.name}</span><span class="muted small">{hint(e)}</span>
      </button>
    {:else}
      <p class="muted none">{query.trim() ? "Keine Übung gefunden." : "Der Katalog ist noch leer."}</p>
    {/each}
    <button type="button" class="row create" onclick={createNew}>
      <span class="create-text"><span class="muted small">Nicht dabei?</span><span>Im Katalog anlegen</span></span>
      <Icon name="chevron" size={20} />
    </button>
  </div>
</Sheet>

<style>
  .target {
    margin: -6px 0 0;
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
    display: flex;
    flex-direction: column;
    max-height: 55dvh;
    overflow-y: auto;
  }
  .list h3 {
    margin: 4px 4px 6px;
  }
  .row {
    width: 100%;
    min-height: 52px;
    border: 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 4px;
    font-weight: 500;
    font-size: 17px;
    text-align: left;
  }
  .row.fresh {
    background: var(--accent-soft);
    border-radius: var(--radius-field);
    padding: 0 10px;
  }
  .small {
    font-size: 14px;
  }
  .none {
    padding: 8px 4px;
    margin: 0;
  }
  .create {
    border-bottom: 0;
    font-weight: 700;
    color: var(--accent-ink);
  }
  .create-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .create-text .muted {
    font-weight: 500;
  }
</style>
