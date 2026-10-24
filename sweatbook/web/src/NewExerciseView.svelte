<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { ApiError } from "./api";
  import { app, guard } from "./store.svelte";
  import type { Metrics } from "./types";

  // Makes a new catalog exercise. Opened from the "add exercise" sheet, it returns there (history back) with the new
  // exercise shown first. Aliases and the note come with the full catalog page.
  let { prefill }: { prefill: string } = $props();

  let name = $state(untrack(() => prefill));
  let metrics = $state<Metrics>("weight_reps");
  let busy = $state(false);
  let takenBy = $state<string | null>(null);

  const OPTIONS: { value: Metrics; label: string }[] = [
    { value: "weight_reps", label: "kg + Wdh." },
    { value: "duration", label: "Zeit" },
    { value: "weight_duration", label: "kg + Zeit" },
  ];

  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    busy = true;
    takenBy = null;
    await guard(async () => {
      try {
        const created = await api.createExercise({ name: name.trim(), metrics });
        app.created = { id: created.id, name: created.name };
        history.back();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && typeof err.detail.taken_by === "string") takenBy = err.detail.taken_by;
        throw err;
      }
    });
    busy = false;
  }
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zurück zur Auswahl" onclick={() => history.back()}><Icon name="back" /></button>
    <span class="label">Übungskatalog</span>
  </header>
  <form class="form" onsubmit={save}>
    <main>
      <h1 class="display">Übung anlegen</h1>
      <p class="muted intro">Danach geht es zurück zur Auswahl.</p>
      <div class="card fields">
        <label class="label" for="exercise-name">Name</label>
        <input id="exercise-name" class="field" maxlength="80" required bind:value={name} />
        {#if takenBy}<p class="warn">Gibt es schon: „{takenBy}“.</p>{/if}
        <fieldset>
          <legend class="label">Satzfelder</legend>
          <div class="options">
            {#each OPTIONS as o (o.value)}
              <button type="button" class="opt" aria-pressed={metrics === o.value} onclick={() => (metrics = o.value)}>{o.label}</button>
            {/each}
          </div>
          <p class="muted small">Lässt sich nur ändern, solange es keine Sätze gibt.</p>
        </fieldset>
      </div>
    </main>
    <footer>
      <button type="submit" class="btn big primary grow" disabled={busy || !name.trim()}>Anlegen</button>
    </footer>
  </form>
</div>

<style>
  .form {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .form main {
    flex: 1;
    overflow-y: auto;
    padding: 0 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .form footer {
    padding: 12px 12px max(12px, env(safe-area-inset-bottom));
    display: flex;
  }
  h1 {
    font-size: 36px;
    padding: 0 4px;
  }
  .intro {
    margin: 0 4px 8px;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  fieldset {
    margin: 12px 0 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 8px;
  }
  .options {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .opt {
    min-height: 48px;
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-field);
    background: transparent;
    font-weight: 600;
  }
  .opt[aria-pressed="true"] {
    background: var(--strong);
    border-color: var(--strong);
    color: var(--on-strong);
  }
  .small {
    font-size: 13px;
    margin: 8px 0 0;
  }
  .warn {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }
  .grow {
    flex: 1;
  }
</style>
