<script lang="ts">
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { findPlanned, formatPlanLine, TEST_KIND_NAMES, weekDates } from "./logic/plan";
  import { goUp, navigate, paths } from "./router.svelte";
  import { guard, openSheet, startPlanned } from "./store.svelte";
  import type { ProgramTree, SessionSummary } from "./types";

  // One planned session: the lines with target and computed weight, then train it, enter it afterwards or skip it.
  let { programId, plannedId }: { programId: string; plannedId: string } = $props();

  let program = $state<ProgramTree | null>(null);
  let running = $state<SessionSummary | null>(null); // the open session, which "Training starten" ends
  let busy = $state(false);

  $effect(() => {
    guard(async () => {
      [program, running] = await Promise.all([
        api.getProgram(programId),
        api.listSessions(6).then((list) => list.find((s) => s.ended_at === null) ?? null),
      ]);
    });
  });

  const found = $derived(program ? findPlanned(program.weeks, plannedId) : null);

  async function skip(skipped: boolean) {
    busy = true;
    await guard(async () => {
      program = await api.skipPlannedSession(plannedId, skipped);
    });
    busy = false;
  }

  async function start() {
    busy = true;
    await startPlanned(plannedId);
    busy = false;
  }
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zum Plan" onclick={() => goUp(paths.program(programId))}><Icon name="back" /></button>
    <span class="label">{program?.name ?? "Plan"}</span>
  </header>
  {#if program && found}
    {@const { week, session } = found}
    <main>
      <div class="head">
        <span class="label">
          Woche {week.number} · {weekDates(program.start_date, week.number)}{week.deload ? " · Deload" : ""}
        </span>
        <h1 class="display page-title">Einheit {session.label}</h1>
        {#if week.phase}<span class="muted">{week.phase}</span>{/if}
        {#if session.state !== "open"}
          <span class="state {session.state}">{session.state === "done" ? "Erledigt" : `Übersprungen${session.skip_note ? ` · ${session.skip_note}` : ""}`}</span>
        {/if}
      </div>

      {#each session.items as item (item.id)}
        {#if item.exercise}
          <div class="card line">
            <span class="name">{item.exercise.name}{item.label ? ` · ${item.label}` : ""}</span>
            <span class="num-text">{formatPlanLine(item)}</span>
            {#if item.rest}<span class="muted">Pause {item.rest}</span>{/if}
            {#if item.note}<span class="muted">„{item.note}“</span>{/if}
            {#if item.test_kind}<span class="label test">Test · {TEST_KIND_NAMES[item.test_kind]}</span>{/if}
          </div>
        {:else}
          <p class="note muted">{item.note}</p>
        {/if}
      {:else}
        <p class="muted">Diese Einheit hat noch keine Planzeilen.</p>
      {/each}

      {#if session.state === "skipped"}
        <button type="button" class="link-btn" disabled={busy} onclick={() => skip(false)}>Überspringen rückgängig</button>
      {:else if session.state === "open"}
        <div class="actions">
          <button type="button" class="link-btn" onclick={() => openSheet({ kind: "log-planned", plannedId })}>Nachtragen</button>
          <button type="button" class="link-btn" disabled={busy} onclick={() => skip(true)}>Überspringen</button>
        </div>
      {/if}
    </main>
    <footer>
      {#if session.session_id}
        <button type="button" class="btn big primary grow" onclick={() => navigate(paths.session(session.session_id!))}>
          {session.state === "done" ? "Zur Session" : "Training fortsetzen"}<Icon name="arrow-right" />
        </button>
      {:else}
        <div class="start">
          {#if running && session.state === "open"}
            <span class="muted hint">Die laufende Session „{running.title ?? "Training"}“ wird beendet.</span>
          {/if}
          <button type="button" class="btn big primary" disabled={busy} onclick={start}><Icon name="plus" />Training starten</button>
        </div>
      {/if}
    </footer>
  {:else}
    <main><p class="muted">Lade …</p></main>
  {/if}
</div>

<style>
  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0 4px 4px;
  }
  .state {
    font-weight: 700;
  }
  .state.skipped {
    color: var(--muted);
  }
  .line {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 14px;
  }
  .name {
    font: 800 20px/1.1 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .test {
    color: var(--accent-ink);
  }
  .note {
    margin: 0;
    padding: 0 4px;
    font-style: italic;
  }
  .actions {
    display: flex;
    gap: 16px;
    justify-content: center;
  }
  .start {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hint {
    font-size: 14px;
    text-align: center;
  }
  .grow {
    flex: 1;
  }
</style>
