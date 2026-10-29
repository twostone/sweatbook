<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import { fromLocalInput, toLocalInput } from "./logic/dates";
  import { app, startPlanned } from "./store.svelte";

  // Enter a planned session afterwards: when it was. The sets follow on its pages as usual.
  let { plannedId }: { plannedId: string } = $props();
  let startedAt = $state(toLocalInput(new Date().toISOString()));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const started = fromLocalInput(startedAt);
    if (!started) {
      app.error = "Bitte Datum und Uhrzeit angeben.";
      return;
    }
    await startPlanned(plannedId, started);
  }
</script>

<Sheet title="Nachtragen">
  <form class="form" onsubmit={save}>
    <label class="label" for="planned-start">Beginn</label>
    <input id="planned-start" class="field" type="datetime-local" required bind:value={startedAt} />
    <button type="submit" class="btn big primary">Anlegen</button>
  </form>
</Sheet>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .form .btn {
    margin-top: 8px;
  }
</style>
