<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import LoggedSet from "./LoggedSet.svelte";
  import SetRow from "./SetRow.svelte";
  import { draftInput, dropDraft, freshDraft, headings, initialDraft, keepDraft, type DraftRow } from "./drafts";
  import { formatShortDate, summarize } from "./logic/format";
  import { parseQuickEntry } from "./logic/quick-entry";
  import type { RowField } from "./logic/set-row";
  import { addSets } from "./store.svelte";
  import type { SessionExercise } from "./types";

  // The sets of one exercise in a block: logged sets, the highlighted "next set" row and "+ Satz". In a superset the
  // block owns the drafts (bound here) so "+ Runde" can send all of them at once.
  let {
    be,
    tag = null,
    draft = $bindable(),
    highlight = true,
    compact = false,
  }: { be: SessionExercise; tag?: string | null; draft?: DraftRow; highlight?: boolean; compact?: boolean } = $props();

  // Keyed by the block exercise (each block page is keyed), so the draft is set up once.
  if (draft === undefined) draft = initialDraft(untrack(() => be));
  const metrics = $derived(be.exercise.metrics);
  const who = $derived(tag ?? be.exercise.name);
  let invalid = $state<RowField | null>(null);
  let quick = $state("");
  let quickInvalid = $state(false);
  let busy = $state(false);
  let unsent = $state(false); // "+ Satz" failed: the row says so until it goes through

  async function addSet() {
    const input = draftInput(draft!, metrics);
    invalid = input.ok ? null : input.field;
    if (!input.ok || busy) return;
    busy = true;
    keepDraft(be, $state.snapshot(draft!));
    unsent = !(await addSets(be.id, [input.set]));
    if (!unsent) {
      dropDraft(be);
      draft = freshDraft(be);
    }
    busy = false;
  }

  async function addQuick(e: SubmitEvent) {
    e.preventDefault();
    const sets = parseQuickEntry(quick, metrics);
    quickInvalid = sets === null;
    if (!sets || busy) return;
    busy = true;
    if (await addSets(be.id, sets)) {
      quick = "";
      dropDraft(be);
      draft = freshDraft(be);
    }
    busy = false;
  }

  const quickExample = $derived(metrics === "weight_reps" ? "3×5@100" : metrics === "duration" ? "3×45" : "3×30@10");
</script>

{#if be.last_time}
  <p class="last" class:tile={!compact}>
    <span class="label">Letztes Mal · {formatShortDate(be.last_time.started_at)}</span>
    <span class="num-text">{summarize(be.last_time.sets, metrics)}</span>
  </p>
{/if}

<div class="sets">
  <div class="heads" class:two={headings(metrics).length === 2} aria-hidden="true">
    <span></span>
    {#each headings(metrics) as h (h)}<span>{h}</span>{/each}
    <span>Max</span><span></span>
  </div>
  {#each be.sets as set, i (set.id)}
    <LoggedSet {set} blockExerciseId={be.id} {metrics} index={i + 1} label="{tag ? `${tag} ` : ''}Satz {i + 1}" />
  {/each}
  {#if draft}
    <SetRow
      {metrics}
      index={String(be.sets.length + 1)}
      label="{who} nächster Satz"
      bind:text={() => draft!, (t) => (draft = { ...draft!, ...t })}
      bind:isMax={() => draft!.is_max, (v) => (draft = { ...draft!, is_max: v })}
      bind:note={() => draft!.note, (v) => (draft = { ...draft!, note: v })}
      draft
      due={highlight}
      {invalid}
      unsaved={unsent}
      onretry={addSet}
      onchange={() => keepDraft(be, $state.snapshot(draft!))}
      oninput={() => keepDraft(be, $state.snapshot(draft!))}
    />
  {/if}
  {#if be.sets.length === 0 && !compact}
    <p class="hint muted">Werte prüfen, dann „+ Satz“.{metrics === "duration" ? "" : " Kein Gewicht = Körpergewicht."}</p>
  {/if}
</div>

<div class="actions" class:compact>
  <button type="button" class="btn" class:strong={!compact} disabled={busy} onclick={addSet}>
    <Icon name="plus" size={18} />Satz
  </button>
  {#if !compact}
    <form class="quick" onsubmit={addQuick}>
      <label class="sr-only" for="quick-{be.id}">Schnelleingabe {be.exercise.name}</label>
      <input
        id="quick-{be.id}"
        class="quick-input"
        class:invalid={quickInvalid}
        placeholder="Schnell: {quickExample}"
        autocomplete="off"
        enterkeyhint="done"
        bind:value={quick}
        oninput={() => (quickInvalid = false)}
      />
    </form>
  {/if}
</div>
{#if quickInvalid}
  <p class="quick-help" role="alert">So geht’s: Sätze × {metrics === "weight_reps" ? "Wdh." : "Zeit"}{metrics === "duration" ? "" : " @ kg"}, z. B. {quickExample}</p>
{/if}

<style>
  .last {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
    font-size: 15px;
  }
  .last .num-text {
    font-size: 18px;
  }
  .last.tile {
    background: var(--surface);
    border-radius: var(--radius-field);
    padding: 10px 12px;
  }
  .last.tile .num-text {
    font-size: 20px;
  }
  .sets {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .heads {
    display: grid;
    grid-template-columns: var(--set-cols-1);
    gap: 6px;
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    text-align: center;
  }
  .heads.two {
    grid-template-columns: var(--set-cols-2);
  }
  .hint {
    margin: 0 0 0 30px;
    font-size: 14px;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .actions .btn {
    min-height: 52px;
  }
  .actions.compact .btn {
    min-height: var(--tap);
    font-size: 16px;
  }
  .quick {
    flex: 1;
    min-width: 0;
  }
  .quick-input {
    width: 100%;
    height: 52px;
    border: 1.5px dashed var(--line-strong);
    border-radius: var(--radius-field);
    background: transparent;
    padding: 0 12px;
    font-weight: 600;
  }
  .quick-input::placeholder {
    color: var(--muted);
  }
  .quick-input.invalid {
    border: 2px solid var(--danger);
  }
  .quick-help {
    margin: 0;
    font-size: 14px;
    color: var(--danger);
    font-weight: 600;
  }
</style>
