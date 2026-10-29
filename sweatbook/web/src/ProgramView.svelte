<script lang="ts">
  import Icon from "./Icon.svelte";
  import PlanEditor from "./PlanEditor.svelte";
  import * as api from "./api";
  import type { PlanTarget } from "./logic/plan-edit";
  import { currentWeek, formatPlanLine, formatTest, groupWeeksByPhase, stateText, TEST_KIND_NAMES, weekDates } from "./logic/plan";
  import { goUp, navigate, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { ProgramTree } from "./types";

  // A program: the weeks by phase with the state of each planned session, the current week open, and the test values.
  // From WIDE_QUERY on it is week columns, clustered by phase and wrapping, with an editor beside it; below, the weeks are a list and lines are
  // edited from the planned session page.
  let { programId }: { programId: string } = $props();
  let program = $state<ProgramTree | null>(null);

  $effect(() => {
    guard(async () => {
      program = await api.getProgram(programId);
    });
  });

  const current = $derived(program ? currentWeek(program.weeks) : null);
  const clusters = $derived(program ? groupWeeksByPhase(program.weeks, program.phases) : []);

  const WIDE_QUERY = "(min-width: 900px)";
  const media = window.matchMedia(WIDE_QUERY);
  let wide = $state(media.matches);
  $effect(() => {
    const update = () => (wide = media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });

  let selected = $state<PlanTarget | null>(null);
  const isSelected = (t: PlanTarget) => selected?.kind === t.kind && "id" in selected && "id" in t && selected.id === t.id;
</script>

{#snippet testsCard(p: ProgramTree)}
  {#if p.tests.length}
    <h2 class="label phase">Testwerte</h2>
    <div class="card tests">
      {#each p.tests as t (t.id)}
        <div class="test">
          <span class="grow">{t.exercise_name} · {TEST_KIND_NAMES[t.kind]}</span>
          <span class="num-text">{formatTest(t)}</span>
          <span class="muted">{t.tested_on.split("-").reverse().join(".")}</span>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="page" class:wide>
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zu den Plänen" onclick={() => goUp(paths.programs())}><Icon name="back" /></button>
    <span class="label grow">Pläne</span>
    {#if wide && program}
      <button type="button" class="btn" onclick={() => (selected = { kind: "program" })}><Icon name="pencil" />Programm</button>
    {/if}
  </header>
  {#if program && wide}
    <div class="split">
      <main class="plan">
        <h1 class="display page-title">{program.name}</h1>
        <p class="muted summary">{program.done} von {program.total} Einheiten{program.next ? "" : " · abgeschlossen"}</p>
        {#each clusters as cluster, c (c)}
          {#if cluster.phase}
            {@const ph = cluster.phase}
            <button type="button" class="phase-head" class:selected={isSelected({ kind: "phase", id: ph.id })} onclick={() => (selected = { kind: "phase", id: ph.id })}>
              <span class="label">{ph.name}</span>
              {#if ph.note}<span class="muted">{ph.note}</span>{/if}
            </button>
          {/if}
          <div class="weeks">
          {#each cluster.weeks as week (week.id)}
            <section class="col" class:current={week.id === current?.id} aria-label={`Woche ${week.number}`}>
              <button type="button" class="col-head" class:selected={isSelected({ kind: "week", id: week.id })} onclick={() => (selected = { kind: "week", id: week.id })}>
                <span class="num-text">Woche {week.number}</span>
                <span class="muted">{weekDates(program.start_date, week.number)}</span>
                {#if week.deload}<span class="label deload">Deload</span>{/if}
              </button>
              {#each week.sessions as s (s.id)}
                <div class="card unit {s.state}">
                  <div class="unit-head">
                    <button type="button" class="unit-name" class:selected={isSelected({ kind: "session", id: s.id })} onclick={() => (selected = { kind: "session", id: s.id })}>
                      <span class="name">{s.label}</span>
                      <span class="muted">{stateText(s)}</span>
                      {#if program.next?.planned_session_id === s.id}<span class="label next">Nächste</span>{/if}
                    </button>
                    <button type="button" class="icon-btn" aria-label={`Einheit ${s.label} öffnen`} onclick={() => navigate(paths.plannedSession(program!.id, s.id))}><Icon name="chevron" size={18} /></button>
                  </div>
                  {#each s.items as item (item.id)}
                    <button type="button" class="line" class:selected={isSelected({ kind: "item", id: item.id })} onclick={() => (selected = { kind: "item", id: item.id })}>
                      {#if item.exercise}
                        <span class="line-name">{item.exercise.name}{item.label ? ` · ${item.label}` : ""}</span>
                        <span class="num-text">{formatPlanLine(item)}</span>
                      {:else}
                        <span class="muted note-line">{item.note}</span>
                      {/if}
                    </button>
                  {/each}
                  <button type="button" class="add" onclick={() => (selected = { kind: "new-item", sessionId: s.id, note: false })}><Icon name="plus" size={18} />Zeile</button>
                </div>
              {/each}
            </section>
          {/each}
          {#if c === clusters.length - 1}
            <button type="button" class="col add-week" onclick={() => guard(async () => { program = await api.addWeek(program!.id, {}); })}>
              <Icon name="plus" />Woche
            </button>
          {/if}
          </div>
        {/each}
        {@render testsCard(program)}
      </main>
      {#if selected}
        <aside aria-label="Bearbeiten">
          <div class="aside-head">
            <button type="button" class="icon-btn" aria-label="Schließen" onclick={() => (selected = null)}><Icon name="close" /></button>
          </div>
          {#key JSON.stringify(selected)}
            <PlanEditor {program} target={selected} onprogram={(p) => (program = p)} onselect={(t) => (selected = t)} />
          {/key}
        </aside>
      {/if}
    </div>
  {:else if program}
    <main>
      <h1 class="display page-title">{program.name}</h1>
      <p class="muted summary">
        {program.done} von {program.total} Einheiten{program.next ? "" : " · abgeschlossen"}
      </p>
      {#each program.weeks as week, i (week.id)}
        {#if week.phase && week.phase_id !== program.weeks[i - 1]?.phase_id}
          <h2 class="label phase">{week.phase}</h2>
          {@const note = program.phases.find((p) => p.id === week.phase_id)?.note}
          {#if note}<p class="muted phase-note">{note}</p>{/if}
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

      {@render testsCard(program)}
    </main>
  {:else}
    <main><p class="muted">Lade …</p></main>
  {/if}
</div>

<style>
  .page.wide {
    max-width: none;
  }
  .split {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
    padding: 0 16px 16px 12px;
  }
  .plan {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 0;
  }
  .weeks {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    align-items: flex-start;
    padding: 8px 4px 12px;
  }
  .col {
    flex: none;
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .col.current .col-head {
    border-color: var(--accent-ink);
  }
  .col-head {
    min-height: var(--tap);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    padding: 8px 12px;
    text-align: left;
    background: var(--surface);
    border: 1.5px solid transparent;
    border-radius: var(--radius);
  }
  .unit {
    padding: 4px 0;
    display: flex;
    flex-direction: column;
  }
  .unit.skipped,
  .unit.done {
    opacity: 0.75;
  }
  .unit-head {
    display: flex;
    align-items: center;
  }
  .unit-name {
    flex: 1;
    min-height: var(--tap);
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    text-align: left;
  }
  .unit-name .name {
    font: 800 22px/1 var(--display);
  }
  .line {
    min-height: var(--tap);
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 12px;
    text-align: left;
    border: 0;
    border-top: 1px solid var(--line);
    background: transparent;
  }
  .line-name {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .note-line {
    font-style: italic;
  }
  .selected {
    background: var(--accent-soft);
  }
  .add {
    min-height: var(--tap);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border: 0;
    border-top: 1px solid var(--line);
    background: transparent;
    color: var(--muted);
    font-weight: 700;
  }
  .add-week {
    min-height: 120px;
    justify-content: center;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    border: 1.5px dashed var(--line-strong);
    border-radius: var(--radius);
    background: transparent;
    font-weight: 700;
  }
  aside {
    flex: none;
    width: 360px;
    overflow-y: auto;
    background: var(--surface);
    border-radius: var(--radius);
    padding: 4px 16px 16px;
  }
  .aside-head {
    display: flex;
    justify-content: flex-end;
  }
  .summary {
    margin: 0;
    padding: 0 4px;
  }
  .phase {
    margin: 12px 4px 0;
  }
  .phase-note {
    margin: 2px 4px 0;
  }
  .phase-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    min-height: var(--tap);
    margin-top: 8px;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    text-align: left;
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
