<script lang="ts">
  import { untrack } from "svelte";
  import * as api from "./api";
  import { PROGRAM_NAME_MAX, copyName, copyStartDate } from "./logic/plan";
  import { guard } from "./store.svelte";
  import type { OutlineEntry, ProgramSummary, ProgramTree } from "./types";

  // Copies a program into a private one of the user's own, to change it without touching the original. With an entry
  // point it is a fork: what lies before is taken over as done or skipped. The parent decides where to go with the copy.
  let {
    source,
    entries,
    oncopy,
    oncancel,
  }: {
    source: Pick<ProgramSummary, "id" | "name" | "joined" | "start_date">;
    entries: OutlineEntry[]; // the planned sessions in training order
    oncopy: (copy: ProgramTree) => void;
    oncancel: () => void;
  } = $props();

  let name = $state(untrack(() => copyName(source.name)));
  let entryId = $state(""); // "" = from the beginning
  const entryWeek = (id: string) => entries.find((e) => e.id === id)?.week ?? null;
  let startDate = $state(untrack(() => copyStartDate(source, null)));
  // Archiving is one's own setting on a joined program; a program not joined has nothing to archive.
  let archiveSource = $state(false);
  let busy = $state(false);

  // Continuing in the copy mostly means leaving the original: propose that, and the start that fits. Both stay editable.
  function pickEntry() {
    startDate = copyStartDate(source, entryWeek(entryId));
    archiveSource = entryId !== "";
  }

  async function duplicate() {
    busy = true;
    let copy: ProgramTree | null = null;
    await guard(async () => {
      copy = await api.duplicateProgram(source.id, {
        name: name.trim(),
        start_date: startDate,
        archive_source: source.joined && archiveSource,
        start_planned_session_id: entryId || undefined,
      });
    });
    busy = false;
    if (copy) oncopy(copy);
  }
</script>

<form class="duplicate" onsubmit={(e) => { e.preventDefault(); duplicate(); }}>
  <h2 class="label">Duplizieren</h2>
  <label>Name der Kopie<input class="field" bind:value={name} maxlength={PROGRAM_NAME_MAX} required /></label>
  {#if entries.length > 1}
    <label>
      Weiter bei
      <select class="field" bind:value={entryId} onchange={pickEntry}>
        <option value="">Von Anfang an</option>
        {#each entries.slice(1) as e (e.id)}
          <option value={e.id}>Woche {e.week} · {e.label}</option>
        {/each}
      </select>
    </label>
  {/if}
  <label>Start (Montag von Woche 1)<input class="field" type="date" bind:value={startDate} required /></label>
  {#if source.joined}
    <label class="check"><input type="checkbox" bind:checked={archiveSource} disabled={busy} />Original archivieren</label>
  {/if}
  <p class="muted">
    {#if entryId}
      Die Kopie gehört nur dir. Was davor liegt, gilt als erledigt, wenn du es {source.joined ? "hier" : "im Original"} trainiert hast, sonst als übersprungen.
    {:else}
      Die Kopie gehört nur dir und beginnt ohne Fortschritt. Das Original bleibt, wie es ist.
    {/if}
  </p>
  <div class="pair">
    <button type="button" class="btn" disabled={busy} onclick={oncancel}>Abbrechen</button>
    <button type="submit" class="btn strong" disabled={busy || !name.trim() || !startDate}>Duplizieren</button>
  </div>
</form>

<style>
  .duplicate {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-weight: 600;
    font-size: 14px;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
    font-size: 16px;
  }
  label.check input {
    width: 22px;
    height: 22px;
  }
  p,
  h2 {
    margin: 0;
  }
  .pair {
    display: flex;
    gap: 8px;
  }
  .pair .btn {
    flex: 1;
  }
</style>
