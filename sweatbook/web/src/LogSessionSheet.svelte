<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import { fromLocalInput, toLocalInput } from "./logic/dates";
  import { app, logPastSession } from "./store.svelte";

  // Enter a training afterwards: when it was and optionally its name. The sets follow on its pages as usual.
  let startedAt = $state(toLocalInput(new Date().toISOString()));
  let title = $state("");
  const open = $derived(app.sessions.find((s) => s.ended_at === null));

  async function save(e: SubmitEvent) {
    e.preventDefault();
    const started = fromLocalInput(startedAt);
    if (!started) {
      app.error = "Bitte Datum und Uhrzeit angeben.";
      return;
    }
    await logPastSession(started, title);
  }
</script>

<Sheet title="Nachtragen">
  <form class="form" onsubmit={save}>
    <label class="label" for="log-start">Beginn</label>
    <input id="log-start" class="field" type="datetime-local" required bind:value={startedAt} />
    <label class="label" for="log-title">Titel</label>
    <input id="log-title" class="field" placeholder="Training" maxlength="100" bind:value={title} />
    {#if open}
      <p class="warn">Die laufende Session „{open.title ?? "Training"}“ wird dabei beendet.</p>
    {/if}
    <button type="submit" class="btn big primary">Anlegen</button>
  </form>
</Sheet>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .form .label:not(:first-child) {
    margin-top: 6px;
  }
  .form .btn {
    margin-top: 8px;
  }
  .warn {
    margin: 4px 0 0;
    color: var(--danger);
    font-weight: 600;
  }
</style>
