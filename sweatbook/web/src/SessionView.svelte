<script lang="ts">
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { blockLabel, formatSessionDate, summarize } from "./logic/format";
  import { blockStatus, doneCount, overviewTarget } from "./logic/flow";
  import { goUp, navigate, paths } from "./router.svelte";
  import { changeSession, finishSession, openSheet } from "./store.svelte";
  import type { SessionBlock, SessionExercise, SessionTree } from "./types";

  // The overview of one session, live or done: a card per block, "Weiter" to the block being worked on.
  let { session }: { session: SessionTree } = $props();

  let reordering = $state(false);
  const target = $derived(overviewTarget(session.blocks));
  const done = $derived(doneCount(session.blocks));

  const addExercise = () => openSheet({ kind: "add-exercise", target: { sessionId: session.id, blockId: null, openAfter: false }, query: "" });

  function move(index: number, by: -1 | 1) {
    const ids = session.blocks.map((b) => b.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    changeSession(() => api.setBlockOrder(session.id, ids));
  }

  function line(be: SessionExercise): string {
    if (be.sets.length) return summarize(be.sets, be.exercise.metrics);
    if (be.last_time) return `Letztes Mal ${summarize(be.last_time.sets, be.exercise.metrics)}`;
    return "Noch keine Sätze";
  }

  const statusText = { done: "erledigt", current: "läuft", open: "offen" } as const;
  const cardLabel = (block: SessionBlock, i: number) =>
    `${block.type === "superset" ? "Supersatz " : ""}${blockLabel(block)}, ${statusText[blockStatus(session.blocks, i)]}`;
</script>

<div class="page">
  <header class="head">
    <button type="button" class="icon-btn" aria-label="Zum Start" onclick={() => goUp(paths.start())}><Icon name="back" /></button>
    <div class="titles">
      <button type="button" class="date label" onclick={() => openSheet({ kind: "session", sessionId: session.id })}>
        {formatSessionDate(session.started_at)}
        <Icon name="pencil" size={13} />
        <span class="sr-only">Session bearbeiten</span>
      </button>
      <h1 class="display">{session.title ?? "Training"}</h1>
    </div>
    {#if session.ended_at === null}
      <button type="button" class="btn pill" onclick={() => finishSession(session)}>Fertig</button>
    {/if}
  </header>

  {#if session.blocks.length}
    <div class="progress">
      <div class="label progress-text">
        <span>Fortschritt</span><span><span class="accent">{done}</span> von {session.blocks.length} Blöcken</span>
      </div>
      <div class="bar" style:grid-template-columns="repeat({session.blocks.length}, minmax(0, 1fr))" aria-hidden="true">
        {#each session.blocks as _, i (i)}
          <span class={blockStatus(session.blocks, i)}></span>
        {/each}
      </div>
    </div>
  {/if}

  <main>
    {#each session.blocks as block, i (block.id)}
      {@const status = blockStatus(session.blocks, i)}
      <div class="card-row">
        <a class="card block {status}" href={paths.block(session.id, block.id)}
          aria-label={cardLabel(block, i)}
          onclick={(e) => {
            e.preventDefault();
            navigate(paths.block(session.id, block.id));
          }}
        >
          <span class="ring {status}" aria-hidden="true">
            {#if status === "done"}<Icon name="check" size={18} />{:else if status === "current"}<span class="dot"></span>{/if}
          </span>
          <span class="body">
            {#if block.type === "superset"}
              <span class="kicker">Supersatz{status === "current" ? " · läuft" : ""}</span>
              {#each block.exercises as be, j (be.id)}
                <span class="name small">A{j + 1} {be.exercise.name}</span>
                <span class="meta">{line(be)}</span>
                {#if be.note}<span class="meta note">„{be.note}“</span>{/if}
              {/each}
            {:else}
              <span class="name">{block.exercises[0]?.exercise.name}</span>
              <span class="meta">{block.exercises[0] ? line(block.exercises[0]) : ""}</span>
              {#if block.exercises[0]?.note}<span class="meta note">„{block.exercises[0].note}“</span>{/if}
            {/if}
          </span>
          {#if !reordering}<span class="chev"><Icon name="chevron" size={20} /></span>{/if}
        </a>
        {#if reordering}
          <div class="moves">
            <button type="button" class="icon-btn" aria-label="{blockLabel(block)} nach oben" disabled={i === 0} onclick={() => move(i, -1)}><Icon name="up" /></button>
            <button type="button" class="icon-btn" aria-label="{blockLabel(block)} nach unten" disabled={i === session.blocks.length - 1} onclick={() => move(i, 1)}
              ><Icon name="down" /></button
            >
          </div>
        {/if}
      </div>
    {:else}
      <p class="empty">Noch keine Übung in dieser Session.</p>
    {/each}
    {#if session.blocks.length > 1}
      <button type="button" class="link-btn reorder" onclick={() => (reordering = !reordering)}>
        {reordering ? "Reihenfolge fertig" : "Reihenfolge ändern"}
      </button>
    {/if}
  </main>

  <footer>
    {#if !target}
      <button type="button" class="btn big primary grow" onclick={addExercise}><Icon name="plus" />Übung hinzufügen</button>
    {:else}
      <button type="button" class="btn big square" aria-label="Übung hinzufügen" onclick={addExercise}><Icon name="plus" /></button>
      <button type="button" class="btn big primary next" onclick={() => navigate(paths.block(session.id, target.id))}>
        <span class="next-text"><small>Weiter</small><span>{blockLabel(target)}</span></span>
        <Icon name="arrow-right" />
      </button>
    {/if}
  </footer>
</div>

<style>
  .head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 14px 14px 10px 4px;
  }
  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .date {
    align-self: flex-start;
    min-height: var(--tap);
    margin: -8px 0 -8px;
    border: 0;
    background: transparent;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  h1 {
    font-size: 34px;
    overflow-wrap: anywhere;
  }
  .pill {
    min-height: var(--tap);
    border-radius: calc(var(--tap) / 2);
    font-family: var(--font);
    font-size: 14px;
    font-weight: 700;
  }
  .progress {
    padding: 4px 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .progress-text {
    display: flex;
    justify-content: space-between;
  }
  .accent {
    color: var(--accent-ink);
  }
  .bar {
    display: grid;
    gap: 4px;
  }
  .bar span {
    height: 6px;
    border-radius: 3px;
    background: var(--line);
  }
  .bar .done {
    background: var(--accent-ink);
  }
  .bar .current {
    background: var(--accent-ink);
    opacity: 0.45;
  }
  .card-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .block {
    flex: 1;
    min-width: 0;
    min-height: 76px;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 10px 14px 14px;
  }
  .block.current {
    background: var(--accent-soft);
    outline: 2px solid var(--accent-ink);
    outline-offset: -2px;
  }
  .ring {
    width: 34px;
    height: 34px;
    flex: none;
    border-radius: 50%;
    border: 2px solid var(--line-strong);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ring.done {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  .ring.current {
    border-color: var(--accent-ink);
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent-ink);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .kicker {
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .name {
    font: 800 22px/1 var(--display);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    overflow-wrap: anywhere;
  }
  .name.small {
    font-size: 20px;
  }
  .meta {
    font-weight: 500;
    font-size: 15px;
    color: var(--muted);
  }
  .note {
    font-style: italic;
    overflow-wrap: anywhere;
  }
  .chev {
    color: var(--muted);
    display: flex;
  }
  .moves {
    display: flex;
    flex-direction: column;
  }
  .reorder {
    align-self: center;
    color: var(--muted);
  }
  .square {
    width: 60px;
    padding: 0;
    flex: none;
  }
  .grow {
    flex: 1;
  }
</style>
