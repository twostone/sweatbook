<script lang="ts">
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import * as api from "./api";
  import { fromLocalInput, toLocalInput } from "./logic/dates";
  import { goUp, paths } from "./router.svelte";
  import { app, changeSession, closeSheet, closeSheetThen, guard } from "./store.svelte";
  import type { PlannedAfterDelete, SessionPlan, SessionTree } from "./types";

  // Title, start time and note of a session; deleting it.
  let { session }: { session: SessionTree } = $props();

  // The form starts from the session as it is when the sheet opens.
  const initial = untrack(() => session);
  let title = $state(initial.title ?? "");
  let startedAt = $state(toLocalInput(initial.started_at));
  let note = $state(initial.note ?? "");
  let confirmDelete = $state(false);
  // What deleting does to the plan depends on the sets, which the shown tree does not follow: ask the server first.
  // Without an answer (no network) there is no question and the server decides.
  let deletion = $state<SessionPlan["deletion"]>(null);
  let planned = $state<PlannedAfterDelete>("open");
  async function askDelete() {
    try {
      deletion = session.plan ? ((await api.getSession(session.id)).plan?.deletion ?? null) : null;
    } catch {
      deletion = null;
    }
    planned = deletion?.default ?? "open";
    confirmDelete = true;
  }

  async function saveSession(e: SubmitEvent) {
    e.preventDefault();
    const started = fromLocalInput(startedAt);
    if (!started) {
      app.error = "Bitte Datum und Uhrzeit angeben.";
      return;
    }
    // "" clears the title and note on the server.
    if (await changeSession(() => api.updateSession(session.id, { title: title.trim(), started_at: started, note: note.trim() }))) closeSheet();
  }

  async function remove() {
    if (
      await guard(async () => {
        await api.deleteSession(session.id, deletion ? planned : undefined);
      })
    ) {
      closeSheetThen(() => goUp(paths.start()));
    }
  }
</script>

<Sheet title="Session">
  <form class="form" onsubmit={saveSession}>
    <label class="label" for="session-title">Titel</label>
    <input id="session-title" class="field" placeholder="Training" maxlength="100" bind:value={title} />
    <label class="label" for="session-start">Beginn</label>
    <input id="session-start" class="field" type="datetime-local" bind:value={startedAt} />
    <label class="label" for="session-note">Notiz</label>
    <textarea id="session-note" class="field" maxlength="1000" bind:value={note}></textarea>
    <button type="submit" class="btn big primary">Speichern</button>
  </form>
  <div class="more">
    {#if confirmDelete}
      {#if deletion}
        <fieldset class="planned">
          <legend class="label">Einheit im Plan danach</legend>
          <label class="choice"><input type="radio" bind:group={planned} value="open" />Wieder offen (nachholen)</label>
          <label class="choice"><input type="radio" bind:group={planned} value="skipped" />Übersprungen</label>
          {#if deletion.copies > 0}
            <p class="muted">Gilt auch für {deletion.copies === 1 ? "die Kopie" : `${deletion.copies} Kopien`} des Plans, die dieses Training übernommen {deletion.copies === 1 ? "hat" : "haben"}.</p>
          {/if}
        </fieldset>
      {/if}
      <button type="button" class="btn danger" onclick={remove}>Wirklich löschen</button>
      <button type="button" class="btn" onclick={() => (confirmDelete = false)}>Abbrechen</button>
    {:else}
      <button type="button" class="btn danger" onclick={askDelete}>Session löschen</button>
    {/if}
  </div>
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
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .planned {
    flex-basis: 100%;
    border: 0;
    margin: 0;
    padding: 0;
  }
  .planned p {
    margin: 0;
  }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
  }
  .choice input {
    width: 22px;
    height: 22px;
  }
</style>
