<script lang="ts">
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { currentWeek, formatTest, stateText, TEST_KIND_NAMES, weekDates } from "./logic/plan";
  import { goUp, navigate, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { ProgramTree } from "./types";

  // A program: the weeks by phase with the state of each planned session, the current week open, and the test values.
  let { programId }: { programId: string } = $props();
  let program = $state<ProgramTree | null>(null);

  $effect(() => {
    guard(async () => {
      program = await api.getProgram(programId);
    });
  });

  const current = $derived(program ? currentWeek(program.weeks) : null);
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zu den Plänen" onclick={() => goUp(paths.programs())}><Icon name="back" /></button>
    <span class="label">Pläne</span>
  </header>
  {#if program}
    <main>
      <h1 class="display page-title">{program.name}</h1>
      <p class="muted summary">
        {program.done} von {program.total} Einheiten{program.next ? "" : " · abgeschlossen"}
      </p>
      {#each program.weeks as week, i (week.id)}
        {#if week.phase && week.phase !== program.weeks[i - 1]?.phase}
          <h2 class="label phase">{week.phase}</h2>
        {/if}
        <details class="card week" open={week.id === current?.id}>
          <summary>
            <span class="num-text">Woche {week.number}</span>
            <span class="muted">{weekDates(program.start_date, week.number)}</span>
            {#if week.deload}<span class="label deload">Deload</span>{/if}
          </summary>
          <div class="sessions">
            {#each week.sessions as s (s.id)}
              <a
                class="row {s.state}"
                href={paths.plannedSession(program.id, s.id)}
                onclick={(e) => {
                  e.preventDefault();
                  navigate(paths.plannedSession(program!.id, s.id));
                }}
              >
                <span class="name">{s.label}</span>
                <span class="muted grow">{stateText(s)}</span>
                {#if program.next?.planned_session_id === s.id}<span class="label next">Nächste</span>{/if}
                <Icon name="chevron" size={18} />
              </a>
            {/each}
          </div>
        </details>
      {/each}

      {#if program.tests.length}
        <h2 class="label phase">Testwerte</h2>
        <div class="card tests">
          {#each program.tests as t (t.id)}
            <div class="test">
              <span class="grow">{t.exercise_name} · {TEST_KIND_NAMES[t.kind]}</span>
              <span class="num-text">{formatTest(t)}</span>
              <span class="muted">{t.tested_on.split("-").reverse().join(".")}</span>
            </div>
          {/each}
        </div>
      {/if}
    </main>
  {:else}
    <main><p class="muted">Lade …</p></main>
  {/if}
</div>

<style>
  .summary {
    margin: 0;
    padding: 0 4px;
  }
  .phase {
    margin: 12px 4px 0;
  }
  .week {
    padding: 0 12px;
  }
  summary {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-height: 52px;
    align-items: center;
    cursor: pointer;
  }
  .deload {
    color: var(--accent-ink);
  }
  .sessions {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--line);
  }
  .row {
    min-height: 52px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--line);
  }
  .row:last-child {
    border-bottom: 0;
  }
  .row :global(svg) {
    color: var(--muted);
    flex: none;
  }
  .row .name {
    font: 800 22px/1 var(--display);
    width: 1.5em;
  }
  .row.done .name,
  .row.skipped .name {
    color: var(--muted);
  }
  .next {
    color: var(--accent-ink);
  }
  .grow {
    flex: 1;
  }
  .tests {
    padding: 4px 12px;
  }
  .test {
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  .test:last-child {
    border-bottom: 0;
  }
</style>
