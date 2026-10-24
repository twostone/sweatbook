<script lang="ts">
  import Icon from "./Icon.svelte";
  import { rowFields, type RowField, type RowText } from "./logic/set-row";
  import { durationInput } from "./logic/numbers";
  import { fieldName } from "./drafts";
  import type { Field } from "./types";

  // One set as a row of big fields. Used for logged sets and for the "next set" row (draft); the owner decides what a
  // change means (save the set, or keep the draft).
  let {
    fields: exerciseFields,
    index,
    label,
    text = $bindable(),
    isMax = $bindable(),
    note = $bindable(),
    draft = false,
    due = false,
    invalid = null,
    unsaved = false,
    onchange,
    oninput,
    onretry,
    ondelete,
  }: {
    fields: readonly Field[]; // the exercise's fields
    index: string; // shown number, "1", "2", … or "+" for the draft row
    label: string; // for screen readers, e.g. "A1 Satz 2"
    text: RowText;
    isMax: boolean;
    note: string;
    draft?: boolean; // the "next set" row, not yet logged
    due?: boolean; // the draft row to fill next (highlighted)
    invalid?: RowField | null;
    unsaved?: boolean;
    onchange: () => void; // a value is complete (field left, MAX tapped)
    oninput?: () => void; // every keystroke, for keeping drafts
    onretry?: () => void; // "Erneut senden" when not saved; default: onchange
    ondelete?: () => void;
  } = $props();

  let noteOpen = $state(false);
  const fields = $derived(rowFields(exerciseFields));
  const placeholder: Record<RowField, string> = { kg: "KG", reps: "–", dist: "m", time: "0:00" };
</script>

<div class="row" class:draft class:due class:two={fields.length === 2} class:three={fields.length === 3}>
  <span class="idx" aria-hidden="true">{index}</span>
  {#each fields as field (field)}
    <input
      class="num"
      class:invalid={invalid === field}
      aria-label="{label} {fieldName(field)}{field === 'kg' ? ' (leer = Körpergewicht)' : ''}"
      aria-invalid={invalid === field}
      inputmode={field === "kg" ? "decimal" : "numeric"}
      autocomplete="off"
      placeholder={placeholder[field]}
      value={text[field]}
      onfocus={(e) => e.currentTarget.select()}
      oninput={(e) => {
        const value = e.currentTarget.value;
        text[field] = field === "time" ? durationInput(value) : value;
        if (field === "time") e.currentTarget.value = text.time;
        oninput?.();
      }}
      onchange={onchange}
    />
  {/each}
  <button
    type="button"
    class="max"
    aria-pressed={isMax}
    aria-label="{label} als Max-Satz"
    onclick={() => {
      isMax = !isMax;
      onchange();
    }}>MAX</button
  >
  <button type="button" class="icon-btn note-btn" class:has-note={note} aria-expanded={noteOpen} aria-label="Notiz zu {label}" onclick={() => (noteOpen = !noteOpen)}>
    <Icon name="note" size={20} />
  </button>
</div>
{#if unsaved}
  <p class="unsaved">Nicht gespeichert. <button type="button" class="link-btn" onclick={onretry ?? onchange}>Erneut senden</button></p>
{/if}
{#if noteOpen}
  <div class="note-edit">
    <input class="field" aria-label="Notiz zu {label}" placeholder="Notiz, z. B. Assistenz" bind:value={note} {oninput} {onchange} />
    {#if ondelete}
      <button type="button" class="btn danger" onclick={ondelete}>Satz löschen</button>
    {/if}
  </div>
{:else if note}
  <p class="note-text">„{note}“</p>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: var(--set-cols-1);
    gap: 6px;
    align-items: center;
  }
  .row.two {
    grid-template-columns: var(--set-cols-2);
  }
  /* Three fields (kg, distance, time) share the width of two: smaller digits so "12:30" still fits. */
  .row.three {
    grid-template-columns: var(--set-cols-3);
  }
  .three .num {
    font-size: 22px;
  }
  .idx {
    font: 800 22px var(--display);
    color: var(--muted);
    text-align: center;
  }
  .num {
    width: 100%;
    min-width: 0;
    height: var(--field-h);
    border: 1.5px solid var(--line);
    border-radius: var(--radius-field);
    background: var(--field);
    font: 800 30px/1 var(--display);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .num::placeholder {
    color: var(--muted);
    opacity: 0.6;
  }
  .draft .num {
    border-style: dashed;
    background: var(--surface);
  }
  .due .num {
    border: 2px solid var(--accent-ink);
  }
  .due .idx {
    color: var(--accent-ink);
  }
  .num.invalid {
    border: 2px solid var(--danger);
  }
  .max {
    height: var(--field-h);
    border: 1.5px solid var(--line-strong);
    border-radius: var(--radius-field);
    background: transparent;
    color: var(--muted);
    font: 800 15px var(--display);
    letter-spacing: 0.06em;
  }
  .max[aria-pressed="true"] {
    background: var(--accent);
    border-color: var(--accent-ink);
    color: var(--on-accent);
  }
  .note-btn {
    color: var(--muted);
    border-radius: var(--radius-field);
  }
  .note-btn.has-note {
    color: var(--accent-ink);
  }
  .note-text,
  .unsaved {
    margin: -2px 0 0 30px;
    font-size: 14px;
    color: var(--muted);
  }
  .note-text {
    font-style: italic;
  }
  .unsaved {
    color: var(--danger);
    font-weight: 600;
  }
  .note-edit {
    margin-left: 30px;
    display: flex;
    gap: 6px;
  }
</style>
