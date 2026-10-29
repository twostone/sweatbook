<script lang="ts">
  import ExerciseForm from "./ExerciseForm.svelte";
  import ExerciseTests from "./ExerciseTests.svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { formatSessionDate, formatSet } from "./logic/format";
  import { goUp, navigate, paths, replace } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { Exercise, ExerciseInput, HistoryEntry } from "./types";

  // One catalog exercise: its fields, archive or delete, and every set ever logged with it.
  let { exerciseId }: { exerciseId: string } = $props();

  let exercise = $state<Exercise | null>(null);
  let entries = $state<HistoryEntry[]>([]);
  let more = $state(false); // the last page was full, so older sessions may exist
  let saved = $state(false);
  let loadingMore = $state(false); // a second tap must not load the same page twice
  let confirmDelete = $state(false);
  const PAGE = 10; // sessions per load of the history

  $effect(() => {
    guard(async () => {
      [exercise, entries] = await Promise.all([api.getExercise(exerciseId), api.exerciseHistory(exerciseId, undefined, PAGE)]);
      more = entries.length === PAGE;
    });
  });

  async function loadMore() {
    if (loadingMore) return;
    loadingMore = true;
    await guard(async () => {
      const older = await api.exerciseHistory(exerciseId, entries.at(-1)?.started_at, PAGE);
      entries = [...entries, ...older];
      more = older.length === PAGE;
    });
    loadingMore = false;
  }

  async function save(input: ExerciseInput) {
    exercise = await api.updateExercise(exerciseId, input);
    saved = true;
  }

  const setArchived = (archived: boolean) =>
    guard(async () => {
      exercise = await api.updateExercise(exerciseId, { archived });
    });

  async function remove() {
    if (await guard(() => api.deleteExercise(exerciseId))) goUp(paths.catalog());
  }
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zum Katalog" onclick={() => goUp(paths.catalog())}><Icon name="back" /></button>
    <span class="label">Übungskatalog</span>
  </header>
  <main>
    {#if exercise}
      <h1 class="display page-title">{exercise.name}</h1>
      {#if exercise.archived}<p class="archived label">Archiviert</p>{/if}
      {#key exercise.id}
        <ExerciseForm
          initial={{ name: exercise.name, fields: exercise.fields, aliases: exercise.aliases, note: exercise.note ?? "" }}
          exceptId={exercise.id}
          submitLabel="Speichern"
          onsave={save}
          onpick={(e) => replace(paths.exercise(e.id))}
        />
      {/key}
      {#if saved}<p class="muted saved" role="status">Gespeichert.</p>{/if}

      <div class="manage">
        {#if exercise.archived}
          <button type="button" class="btn" onclick={() => setArchived(false)}>Wieder aktivieren</button>
        {:else}
          <button type="button" class="btn" onclick={() => setArchived(true)}>Archivieren</button>
        {/if}
        {#if exercise.last_used_at === null}
          {#if confirmDelete}
            <button type="button" class="btn danger" onclick={remove}>Wirklich löschen</button>
          {:else}
            <button type="button" class="btn danger" onclick={() => (confirmDelete = true)}>Löschen</button>
          {/if}
        {/if}
      </div>
      <p class="muted small">
        {exercise.last_used_at === null
          ? "Noch nie benutzt: Löschen ist möglich."
          : "Benutzte Übungen werden archiviert statt gelöscht. Archivierte stehen nicht mehr zur Auswahl."}
      </p>

      {#key exercise.id}
        <ExerciseTests {exercise} />
      {/key}

      <h2 class="label section">Verlauf</h2>
      {#each entries as entry (entry.session_id)}
        <a
          class="card entry"
          href={paths.session(entry.session_id)}
          onclick={(e) => {
            e.preventDefault();
            navigate(paths.session(entry.session_id));
          }}
        >
          <span class="entry-head">
            <span class="label">{formatSessionDate(entry.started_at)}</span>
            <span class="entry-title">{entry.title ?? "Training"}</span>
          </span>
          <ol class="sets">
            {#each entry.sets as set (set.id)}
              <li><span class="num-text">{formatSet(set, exercise.fields)}</span>{#if set.note}<span class="muted note"> · {set.note}</span>{/if}</li>
            {/each}
          </ol>
        </a>
      {:else}
        <p class="muted">Noch keine Sätze.</p>
      {/each}
      {#if more}
        <button type="button" class="btn" disabled={loadingMore} onclick={loadMore}>Mehr laden</button>
      {/if}
    {/if}
  </main>
</div>

<style>
  .archived {
    margin: 0 4px;
    color: var(--danger);
  }
  .saved {
    margin: 0 4px;
  }
  .manage {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .small {
    margin: 0 4px;
    font-size: 13px;
  }
  .section {
    margin: 20px 4px 0;
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .entry-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .entry-title {
    font: 800 20px/1 var(--display);
    text-transform: uppercase;
  }
  .sets {
    margin: 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sets .num-text {
    font-size: 18px;
  }
  .note {
    font-size: 14px;
  }
</style>
