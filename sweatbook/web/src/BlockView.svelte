<script lang="ts">
  import ExerciseSets from "./ExerciseSets.svelte";
  import Icon from "./Icon.svelte";
  import { draftInput, dropDraft, fieldName, freshDraft, keepDraft, type DraftRow } from "./drafts";
  import { blockLabel } from "./logic/format";
  import { nextBlock, nextInRound } from "./logic/flow";
  import { goUp, paths, replace } from "./router.svelte";
  import { app, changeSession, finishSession, openSheet } from "./store.svelte";
  import * as api from "./api";
  import type { SessionTree, SetInput } from "./types";

  // One block of the session: a single exercise, or a superset with its exercises as cards (A1, A2, …).
  let { session, blockId }: { session: SessionTree; blockId: string } = $props();

  const index = $derived(session.blocks.findIndex((b) => b.id === blockId));
  const block = $derived(session.blocks[index]);
  const next = $derived(nextBlock(session.blocks, blockId));
  const previous = $derived(index > 0 ? session.blocks[index - 1] : undefined);
  const superset = $derived(block?.type === "superset");
  const due = $derived(block ? nextInRound(block.exercises) : 0);

  // Drafts of all exercises live here, so "+ Runde" can send them together.
  let drafts = $state<Record<string, DraftRow>>({});
  let busy = $state(false);

  const tag = (i: number) => `A${i + 1}`;

  async function addRound() {
    if (!block || busy) return;
    const sets: (SetInput & { block_exercise_id: string })[] = [];
    for (const [i, be] of block.exercises.entries()) {
      const input = draftInput(drafts[be.id]!, be.exercise.metrics);
      if (!input.ok) {
        app.error = `${tag(i)}: ${fieldName(input.field)} fehlt oder stimmt nicht.`;
        return;
      }
      sets.push({ ...input.set, block_exercise_id: be.id });
    }
    busy = true;
    for (const be of block.exercises) keepDraft(be, $state.snapshot(drafts[be.id]!)); // survive a failed send
    if (await changeSession(() => api.addRound(block.id, sets))) {
      for (const be of app.session!.blocks[index]!.exercises) {
        dropDraft(be);
        drafts[be.id] = freshDraft(be);
      }
    }
    busy = false;
  }

  const addAfter = () => openSheet({ kind: "add-exercise", target: { sessionId: session.id, blockId: null, openAfter: true }, query: "" });
</script>

{#if block}
  <div class="page">
    <header class="topbar">
      <button type="button" class="icon-btn" aria-label="Zur Übersicht" onclick={() => goUp(paths.session(session.id))}><Icon name="back" /></button>
      <span class="label grow">Block {index + 1} von {session.blocks.length}</span>
      <button
        type="button"
        class="icon-btn"
        aria-label="Optionen für {blockLabel(block)}"
        onclick={() => openSheet({ kind: "block-menu", sessionId: session.id, blockId: block.id })}><Icon name="more" /></button
      >
    </header>

    <main>
      {#if superset}
        <h1 class="display page-title">Supersatz</h1>
        {#each block.exercises as be, i (be.id)}
          <section class="card exercise" aria-labelledby="ex-{be.id}">
            <div class="ex-head">
              <span class="tag">{tag(i)}</span>
              <h2 id="ex-{be.id}" class="display">{be.exercise.name}</h2>
            </div>
            <ExerciseSets {be} tag={tag(i)} bind:draft={drafts[be.id]} highlight={i === due} compact />
          </section>
        {/each}
        <button type="button" class="btn strong round" disabled={busy} onclick={addRound}>
          <Icon name="plus" size={18} />Runde ({block.exercises.map((_, i) => tag(i)).join(" + ")})
        </button>
      {:else}
        {@const be = block.exercises[0]!}
        <h1 class="display page-title big">{be.exercise.name}</h1>
        <ExerciseSets {be} bind:draft={drafts[be.id]} />
      {/if}
    </main>

    <footer>
      <button
        type="button"
        class="btn big square"
        aria-label={previous ? `Zurück zu ${blockLabel(previous)}` : "Zur Übersicht"}
        onclick={() => (previous ? replace(paths.block(session.id, previous.id)) : goUp(paths.session(session.id)))}
        ><Icon name="arrow-left" /></button
      >
      {#if next}
        <button type="button" class="btn big primary next" onclick={() => replace(paths.block(session.id, next.id))}>
          <span class="next-text"><small>Weiter</small><span>{blockLabel(next)}</span></span>
          <Icon name="arrow-right" />
        </button>
      {:else}
        <button type="button" class="btn big grow two-line" onclick={addAfter}>Übung hinzufügen</button>
        <button type="button" class="btn big primary grow two-line" onclick={() => finishSession(session)}>
          {session.ended_at === null ? "Session beenden" : "Fertig"}
        </button>
      {/if}
    </footer>
  </div>
{:else}
  <div class="page">
    <header class="topbar">
      <button type="button" class="icon-btn" aria-label="Zur Übersicht" onclick={() => goUp(paths.session(session.id))}><Icon name="back" /></button>
    </header>
    <p class="empty">Diesen Block gibt es nicht mehr.</p>
  </div>
{/if}

<style>
  .grow {
    flex: 1;
  }
  .page-title.big {
    font-size: 46px;
  }
  .exercise {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
  .ex-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ex-head h2 {
    font-size: 24px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .tag {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: 50%;
    background: var(--strong);
    color: var(--on-strong);
    font: 800 15px/32px var(--display);
    text-align: center;
  }
  .round {
    min-height: 56px;
  }
  /* The two end buttons share the row with "back": their labels may wrap. */
  .two-line {
    white-space: normal;
    font-size: 19px;
    line-height: 1;
  }
  .square {
    width: 60px;
    padding: 0;
    flex: none;
  }
</style>
