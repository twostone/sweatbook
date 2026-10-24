<script lang="ts">
  import ExerciseForm from "./ExerciseForm.svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { goUp, paths, replace } from "./router.svelte";
  import { app } from "./store.svelte";
  import type { Exercise, ExerciseInput } from "./types";

  // Makes a new catalog exercise. From the "add exercise" sheet it returns there (its history entry lies right below)
  // with the exercise picked; from the catalog it goes up to the list.
  let { prefill, fromSheet }: { prefill: string; fromSheet: boolean } = $props();

  function leave() {
    if (fromSheet) history.back();
    else goUp(paths.catalog());
  }

  function backWith(exercise: Exercise) {
    if (fromSheet) app.created = { id: exercise.id, name: exercise.name };
    leave();
  }

  async function save(input: ExerciseInput) {
    backWith(await api.createExercise(input));
  }

  // A similar one is what was meant: pick it in the sheet, or open it from the catalog instead of this form.
  const pick = (e: Exercise) => (fromSheet ? backWith(e) : replace(paths.exercise(e.id)));
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zurück" onclick={leave}><Icon name="back" /></button>
    <span class="label">Übungskatalog</span>
  </header>
  <main>
    <h1 class="display page-title">Übung anlegen</h1>
    {#if fromSheet}<p class="muted intro">Danach geht es zurück zur Auswahl.</p>{/if}
    <ExerciseForm initial={{ name: prefill, metrics: "weight_reps", aliases: [], note: "" }} submitLabel="Anlegen" onsave={save} onpick={pick} pickArchived={!fromSheet} />
  </main>
</div>

<style>
  .intro {
    margin: 0 4px 8px;
  }
</style>
