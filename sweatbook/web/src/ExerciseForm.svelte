<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { ApiError } from "./api";
  import { addAlias, similarExercises } from "./logic/catalog";
  import { guard } from "./store.svelte";
  import { VALUE_FIELDS, type Exercise, type ExerciseInput, type Field } from "./types";

  // The fields of a catalog exercise, for "Übung anlegen" and the detail page. Warns about similar names while typing;
  // an exact clash is refused by the server (409 with taken_by) and shown at the name.
  let {
    initial,
    exceptId,
    submitLabel,
    onsave,
    onpick,
    pickArchived = true,
  }: {
    initial: ExerciseInput;
    exceptId?: string; // the exercise being edited, left out of the warning
    submitLabel: string;
    onsave: (input: ExerciseInput) => Promise<void>;
    onpick?: (exercise: Exercise) => void; // tapping a similar exercise
    pickArchived?: boolean; // archived ones can be picked too (not when picking for a block: they are refused there)
  } = $props();

  const start = untrack(() => initial);
  let name = $state(start.name);
  let fields = $state<Field[]>([...start.fields]);
  let aliases = $state<string[]>(start.aliases ?? []);
  let aliasText = $state("");
  let note = $state(start.note ?? "");
  let catalog = $state<Exercise[]>([]);
  let takenBy = $state<string | null>(null);
  let busy = $state(false);

  const MAX_SIMILAR = 5; // a hint, not a second catalog

  // In the order a set row shows them.
  const OPTIONS: { value: Field; label: string }[] = [
    { value: "weight", label: "Gewicht" },
    { value: "reps", label: "Wdh." },
    { value: "distance", label: "Strecke" },
    { value: "duration", label: "Zeit" },
  ];
  const ORDER = OPTIONS.map((o) => o.value);
  const toggle = (field: Field) =>
    (fields = fields.includes(field) ? fields.filter((f) => f !== field) : ORDER.filter((f) => f === field || fields.includes(f)));
  // Like the server: kg alone says nothing about a set.
  const hasValueField = $derived(fields.some((f) => VALUE_FIELDS.includes(f)));
  let fieldInUse = $state<string | null>(null);

  $effect(() => {
    guard(async () => {
      catalog = await api.listExercises();
    });
  });

  const similar = $derived(similarExercises(catalog, name, exceptId));

  function takeAlias() {
    aliases = addAlias(aliases, aliasText, name);
    aliasText = "";
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (aliasText.trim()) takeAlias(); // typed but not yet added: meant to be added
    busy = true;
    takenBy = null;
    fieldInUse = null;
    await guard(async () => {
      try {
        await onsave({ name: name.trim(), fields: $state.snapshot(fields), aliases: $state.snapshot(aliases), note: note.trim() });
      } catch (err) {
        // A taken name and a field that still holds values are shown in place; anything else goes to the error bar.
        if (err instanceof ApiError && err.status === 409 && typeof err.detail.taken_by === "string") takenBy = err.detail.taken_by;
        else if (err instanceof ApiError && err.status === 409 && typeof err.detail.field === "string") {
          // The field stays on the server, so it goes back into the selection too.
          const field = err.detail.field as Field;
          fieldInUse = OPTIONS.find((o) => o.value === field)?.label ?? field;
          if (!fields.includes(field)) toggle(field);
        } else throw err;
      }
    });
    busy = false;
  }
</script>

<form class="form" onsubmit={submit}>
  <div class="card fields">
    <label class="label" for="exercise-name">Name</label>
    <input id="exercise-name" class="field" maxlength="80" required autocomplete="off" bind:value={name} oninput={() => (takenBy = null)} />
    {#if takenBy}
      <p class="warn" role="alert">„{takenBy}“ gibt es schon im Katalog.</p>
    {:else if similar.length}
      <div class="similar" role="status">
        <span class="similar-title">Ähnliche Übungen im Katalog</span>
        {#each similar.slice(0, MAX_SIMILAR) as e (e.id)}
          {#if onpick && (pickArchived || !e.archived)}
            <button type="button" class="link-btn similar-item" onclick={() => onpick(e)}>{e.name}{e.archived ? " (archiviert)" : ""}</button>
          {:else}
            <span class="similar-item">{e.name}{e.archived ? " (archiviert)" : ""}</span>
          {/if}
        {/each}
      </div>
    {/if}

    <fieldset>
      <legend class="label">Satzfelder</legend>
      <div class="options">
        {#each OPTIONS as o (o.value)}
          <button type="button" class="opt" aria-pressed={fields.includes(o.value)} onclick={() => toggle(o.value)}>{o.label}</button>
        {/each}
      </div>
      {#if fieldInUse}
        <p class="warn" role="alert">„{fieldInUse}“ hat schon Werte in Sätzen und bleibt.</p>
      {:else if !hasValueField}
        <p class="warn">Mindestens Wdh., Strecke oder Zeit wählen.</p>
      {:else}
        <p class="muted small">Gewicht leer heißt Körpergewicht. Felder mit Werten in Sätzen bleiben.</p>
      {/if}
    </fieldset>

    <label class="label" for="exercise-alias">Aliase</label>
    {#if aliases.length}
      <ul class="chips">
        {#each aliases as alias (alias)}
          <li class="chip">
            {alias}
            <button type="button" class="icon-btn chip-x" aria-label="Alias {alias} entfernen" onclick={() => (aliases = aliases.filter((a) => a !== alias))}>
              <Icon name="close" size={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="alias-add">
      <input
        id="exercise-alias"
        class="field"
        placeholder="Weiterer Name für die Suche"
        maxlength="80"
        autocomplete="off"
        enterkeyhint="done"
        bind:value={aliasText}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            takeAlias();
          }
        }}
      />
      <button type="button" class="btn" disabled={!aliasText.trim()} onclick={takeAlias}><Icon name="plus" size={18} /><span class="sr-only">Alias hinzufügen</span></button>
    </div>

    <label class="label" for="exercise-note">Ausführung</label>
    <textarea id="exercise-note" class="field" maxlength="1000" placeholder="z. B. Griff, Sitzstufe" bind:value={note}></textarea>
  </div>
  <button type="submit" class="btn big primary" disabled={busy || !name.trim() || !hasValueField}>{submitLabel}</button>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fields > .label:not(:first-child),
  fieldset {
    margin-top: 10px;
  }
  fieldset {
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    margin-bottom: 8px;
  }
  .options {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
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
  .opt:disabled {
    cursor: default;
    opacity: 0.6;
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
  .similar {
    background: var(--accent-soft);
    border-radius: var(--radius-field);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .similar-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--muted);
  }
  .similar-item {
    font-size: 15px;
    padding: 0;
  }
  span.similar-item {
    padding: 4px 0;
  }
  .chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-left: 12px;
    border-radius: 999px;
    background: var(--field);
    font-weight: 500;
  }
  .chip-x {
    color: var(--muted);
  }
  .alias-add {
    display: flex;
    gap: 8px;
  }
  .alias-add .btn {
    width: 48px;
    padding: 0;
    flex: none;
  }
</style>
