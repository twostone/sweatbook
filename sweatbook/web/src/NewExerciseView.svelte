<script lang="ts">
  import ExerciseForm from "./ExerciseForm.svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { navigate, paths } from "./router.svelte";
  import { app } from "./store.svelte";
  import type { Exercise, ExerciseInput } from "./types";

  // Makes a new catalog exercise. From the "add exercise" sheet it returns there (history back) with the exercise
  // picked; from the catalog it goes back to the list.
  let { prefill, fromSheet }: { prefill: string; fromSheet: boolean } = $props();

  function backWith(exercise: Exercise) {
    if (fromSheet) app.created = { id: exercise.id, name: exercise.name };
    history.back();
  }

  async function save(input: ExerciseInput) {
    backWith(await api.createExercise(input));
  }

  // A similar one is what was meant: pick it in the sheet, or open it from the catalog.
  const pick = (e: Exercise) => (fromSheet ? backWith(e) : navigate(paths.exercise(e.id)));
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zurück" onclick={() => history.back()}><Icon name="back" /></button>
    <span class="label">Übungskatalog</span>
  </header>
  <main>
    <h1 class="display">Übung anlegen</h1>
    {#if fromSheet}<p class="muted intro">Danach geht es zurück zur Auswahl.</p>{/if}
    <ExerciseForm initial={{ name: prefill, metrics: "weight_reps", aliases: [], note: "" }} submitLabel="Anlegen" onsave={save} onpick={pick} />
  </main>
</div>

<style>
  h1 {
    font-size: 36px;
    padding: 0 4px 4px;
  }
  .intro {
    margin: 0 4px 8px;
  }
</style>
