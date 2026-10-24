<script lang="ts">
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { changeSession } from "./store.svelte";
  import type { SessionExercise } from "./types";

  // The note of one exercise in this session, e.g. the plan ("5 × max, 2 min Pause"). Saved when the field is left.
  let { be, label }: { be: SessionExercise; label: string } = $props();

  let editing = $state(false);
  let text = $state("");
  let field = $state<HTMLTextAreaElement>();

  async function edit() {
    text = be.note ?? "";
    editing = true;
    await tick();
    field?.focus();
  }

  // A failed save keeps the field open with the text, so nothing typed is lost.
  async function save() {
    const note = text.trim();
    if (note === (be.note ?? "")) editing = false;
    else if (await changeSession(() => api.updateBlockExercise(be.id, { note }))) editing = false;
  }
</script>

{#if editing}
  <textarea
    bind:this={field}
    class="field"
    aria-label="Notiz zu {label}"
    maxlength="1000"
    placeholder="Plan, z. B. 5 × max, 2 min Pause"
    bind:value={text}
    onblur={save}
  ></textarea>
{:else if be.note}
  <button type="button" class="note-text" aria-label="Notiz zu {label} bearbeiten: {be.note}" onclick={edit}>„{be.note}“</button>
{:else}
  <button type="button" class="link-btn add" aria-label="Notiz zu {label}" onclick={edit}><Icon name="note" size={18} />Notiz</button>
{/if}

<style>
  .note-text {
    min-height: var(--tap);
    padding: 6px 0;
    border: 0;
    background: none;
    color: var(--muted);
    font: italic 500 15px/1.3 var(--font);
    text-align: left;
    white-space: pre-line;
    overflow-wrap: anywhere;
    cursor: pointer;
  }
  .add {
    align-self: flex-start;
    display: inline-flex;
    color: var(--muted);
    text-decoration: none;
    align-items: center;
    gap: 6px;
  }
</style>
