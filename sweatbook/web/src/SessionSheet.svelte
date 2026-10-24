<script lang="ts">
  import { untrack } from "svelte";
  import Sheet from "./Sheet.svelte";
  import * as api from "./api";
  import { fromLocalInput, toLocalInput } from "./logic/dates";
  import { paths } from "./router.svelte";
  import { app, changeSession, closeSheet, closeSheetAndNavigate, guard } from "./store.svelte";
  import type { SessionTree } from "./types";

  // Title, start time and note of a session; also reopening and deleting it.
  let { session }: { session: SessionTree } = $props();

  // The form starts from the session as it is when the sheet opens.
  const initial = untrack(() => session);
  let title = $state(initial.title ?? "");
  let startedAt = $state(toLocalInput(initial.started_at));
  let note = $state(initial.note ?? "");
  let confirmDelete = $state(false);

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

  async function reopen() {
    if (await changeSession(() => api.updateSession(session.id, { ended_at: null }))) closeSheet();
  }

  async function remove() {
    if (
      await guard(async () => {
        await api.deleteSession(session.id);
      })
    ) {
      app.session = null;
      closeSheetAndNavigate(paths.start());
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
    {#if session.ended_at !== null}
      <button type="button" class="btn" onclick={reopen}>Wieder öffnen</button>
    {/if}
    {#if confirmDelete}
      <button type="button" class="btn danger" onclick={remove}>Wirklich löschen</button>
      <button type="button" class="btn" onclick={() => (confirmDelete = false)}>Abbrechen</button>
    {:else}
      <button type="button" class="btn danger" onclick={() => (confirmDelete = true)}>Session löschen</button>
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
</style>
