<script lang="ts">
  import { untrack } from "svelte";
  import ExercisePick from "./ExercisePick.svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { emptyForm, formFromItem, hasField, itemBody, moved, type ItemForm, type PlanTarget } from "./logic/plan-edit";
  import { formatKg } from "./logic/format";
  import { weekDates } from "./logic/plan";
  import { goUp, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { PlanItem, PlannedSession, PlanPhase, PlanWeek, ProgramTree } from "./types";

  // Edits what the target names: the program, a phase, a week, a planned session or one line. Every change answers with the whole
  // program, which goes up through onprogram. The parent keys this component by target, so the form starts fresh.
  let {
    program,
    target,
    onprogram,
    onselect,
  }: { program: ProgramTree; target: PlanTarget; onprogram: (p: ProgramTree) => void; onselect: (t: PlanTarget | null) => void } = $props();

  const start = untrack(() => ({ program, target }));

  function find(p: ProgramTree, t: PlanTarget): { week: PlanWeek | null; session: PlannedSession | null; item: PlanItem | null } {
    const none = { week: null, session: null, item: null };
    for (const week of p.weeks) {
      if (t.kind === "week" && week.id === t.id) return { ...none, week };
      for (const session of week.sessions) {
        if (t.kind === "session" && session.id === t.id) return { week, session, item: null };
        if (t.kind === "new-item" && session.id === t.sessionId) return { week, session, item: null };
        const item = session.items.find((i) => i.id === (t.kind === "item" ? t.id : ""));
        if (item) return { week, session, item };
      }
    }
    return none;
  }

  const found = $derived(find(program, target));
  const phaseOf = (p: ProgramTree, t: PlanTarget): PlanPhase | null => (t.kind === "phase" ? (p.phases.find((x) => x.id === t.id) ?? null) : null);
  const foundPhase = $derived(phaseOf(program, target));
  // A target that was deleted (or never existed after a reload) closes the editor.
  $effect(() => {
    const gone = target.kind === "phase" ? !foundPhase : target.kind === "week" ? !found.week : target.kind === "session" || target.kind === "new-item" ? !found.session : target.kind === "item" ? !found.item : false;
    if (gone) onselect(null);
  });

  let busy = $state(false);
  let confirming = $state(false); // the delete button asks once more
  async function run(change: () => Promise<ProgramTree>, after?: () => void) {
    busy = true;
    const ok = await guard(async () => onprogram(await change()));
    busy = false;
    confirming = false;
    if (ok) after?.();
  }

  // Program
  let name = $state(start.program.name);
  let startDate = $state(start.program.start_date);
  // Phase
  let phaseName = $state(phaseOf(start.program, start.target)?.name ?? "");
  let phaseNote = $state(phaseOf(start.program, start.target)?.note ?? "");
  // New phase
  let newPhaseName = $state("");
  const phaseNameTaken = $derived(program.phases.some((p) => p.name.toLocaleLowerCase("de") === newPhaseName.trim().toLocaleLowerCase("de")));
  // A phase exists with its first week: the new one is empty and at the end of the program.
  async function createPhase() {
    let created: ProgramTree | null = null;
    await run(
      async () => (created = await api.addWeek(program.id, { phase: newPhaseName.trim() })),
      () => {
        const id = created?.weeks.at(-1)?.phase_id;
        if (id) onselect({ kind: "phase", id });
      },
    );
  }
  // Week
  let phase = $state(find(start.program, start.target).week?.phase ?? "");
  let deload = $state(find(start.program, start.target).week?.deload ?? false);
  // Session
  let label = $state(find(start.program, start.target).session?.label ?? "");
  let newLabel = $state("");
  // Line
  const initial = find(start.program, start.target).item;
  let form = $state<ItemForm | null>(initial ? formFromItem(initial) : start.target.kind === "new-item" && start.target.note ? emptyForm(null) : null);
  let invalid = $state("");
  let pickingRef = $state(false);

  const FIELD_ERRORS: Record<string, string> = {
    note: "Eine Hinweiszeile braucht einen Text.",
    sets: "Sätze: Zahl oder Spanne, z. B. 4 oder 3–5.",
    reps: "Wiederholungen: Zahl oder Spanne, z. B. 5 oder 3–5.",
    distance: "Strecke: Meter als Zahl oder Spanne.",
    duration: "Zeit: Sekunden als Zahl oder Spanne.",
    load: "Last: Zahl, bei Prozent mit Bezugsübung (1–500).",
  };

  async function saveItem() {
    if (!form) return;
    const body = itemBody(form);
    if ("invalid" in body) {
      invalid = FIELD_ERRORS[body.invalid] ?? "Eingabe ungültig.";
      return;
    }
    invalid = "";
    if (target.kind === "new-item") await run(() => api.addPlanItem(target.sessionId, body), () => onselect({ kind: "session", id: target.sessionId }));
    else if (target.kind === "item") await run(() => api.updatePlanItem(target.id, body));
  }

  const siblings = $derived(found.session?.items.map((i) => i.id) ?? []);
  function move(step: -1 | 1) {
    if (found.session && found.item) {
      const order = moved(siblings, found.item.id, step);
      if (order !== siblings) run(() => api.setItemOrder(found.session!.id, order));
    }
  }

  const nextLabel = $derived(String.fromCharCode("A".charCodeAt(0) + (found.week?.sessions.length ?? 0)));
</script>

<div class="editor">
  {#if target.kind === "program"}
    <h2 class="label">Programm</h2>
    <label>Name<input class="field" bind:value={name} maxlength="100" disabled={!program.owned} /></label>
    <label>Start (Montag von Woche 1)<input class="field" type="date" bind:value={startDate} /></label>
    <button
      type="button"
      class="btn strong"
      disabled={busy || !name.trim() || !startDate}
      onclick={() => run(() => api.updateProgram(program.id, { ...(program.owned ? { name: name.trim() } : {}), start_date: startDate }))}
    >Speichern</button>
    <button type="button" class="btn" disabled={busy} onclick={() => run(() => api.addWeek(program.id, {}))}><Icon name="plus" />Woche anhängen</button>
    <button type="button" class="btn" disabled={busy} onclick={() => run(() => api.updateProgram(program.id, { archived: !program.archived }))}>
      {program.archived ? "Wiederherstellen" : "Archivieren"}
    </button>
    {#if program.owned}
      <label class="check">
        <input type="checkbox" checked={program.shared} disabled={busy} onchange={() => run(() => api.updateProgram(program.id, { shared: !program.shared }))} />
        Mit allen teilen
      </label>
      <p class="muted">Alle Nutzer können den Plan übernehmen und bearbeiten. Fortschritt, Start und Testwerte bleiben bei jedem eigen.</p>
      {@render danger("Programm löschen", async () => {
        busy = true;
        const ok = await guard(() => api.deleteProgram(program.id));
        busy = false;
        if (ok) goUp(paths.programs());
      })}
    {:else}
      <p class="muted">Geteilt von {program.owner_name ?? "einem anderen Nutzer"}.</p>
      {@render danger("Plan verlassen", async () => {
        busy = true;
        const ok = await guard(() => api.leaveProgram(program.id));
        busy = false;
        if (ok) goUp(paths.programs());
      })}
    {/if}
  {:else if target.kind === "new-phase"}
    <h2 class="label">Neuer Abschnitt</h2>
    <label>Name<input class="field" bind:value={newPhaseName} maxlength="100" placeholder="z. B. Aufbau" /></label>
    {#if phaseNameTaken}<p class="muted">Diesen Namen gibt es schon.</p>{/if}
    <p class="muted">Legt den Abschnitt mit einer leeren Woche am Ende des Programms an.</p>
    <button type="button" class="btn strong" disabled={busy || !newPhaseName.trim() || phaseNameTaken} onclick={createPhase}>Anlegen</button>
  {:else if target.kind === "phase" && foundPhase}
    {@const ph = foundPhase}
    <h2 class="label">Abschnitt</h2>
    <label>Name<input class="field" bind:value={phaseName} maxlength="100" /></label>
    <label>Notiz<textarea class="field" rows="3" bind:value={phaseNote} maxlength="1000" placeholder="z. B. Ziel des Abschnitts"></textarea></label>
    <button type="button" class="btn strong" disabled={busy || !phaseName.trim()} onclick={() => run(() => api.updatePhase(ph.id, { name: phaseName.trim(), note: phaseNote.trim() || null }))}>Speichern</button>
    <p class="muted">Gilt für alle Wochen des Abschnitts.</p>
    {@render danger("Abschnitt auflösen", () => run(() => api.deletePhase(ph.id)))}
  {:else if target.kind === "week" && found.week}
    {@const week = found.week}
    <h2 class="label">Woche {week.number} · {weekDates(program.start_date, week.number)}</h2>
    <label>Abschnitt<input class="field" list="phase-names" bind:value={phase} maxlength="100" placeholder="z. B. Aufbau" /></label>
    <datalist id="phase-names">{#each program.phases as ph (ph.id)}<option value={ph.name}></option>{/each}</datalist>
    <label class="check"><input type="checkbox" bind:checked={deload} />Deload-Woche</label>
    <button type="button" class="btn strong" disabled={busy} onclick={() => run(() => api.updateWeek(week.id, { phase: phase.trim() || null, deload }))}>Speichern</button>
    <label>Neue Einheit<input class="field" bind:value={newLabel} maxlength="20" placeholder={nextLabel} /></label>
    <button type="button" class="btn" disabled={busy} onclick={() => run(() => api.addPlannedSession(week.id, newLabel.trim() || nextLabel), () => (newLabel = ""))}><Icon name="plus" />Einheit hinzufügen</button>
    <button type="button" class="btn" disabled={busy} onclick={() => run(() => api.addWeek(program.id, { copy_of: week.id }))}>Woche kopieren</button>
    {@render danger("Woche löschen", () => run(() => api.deleteWeek(week.id)))}
  {:else if target.kind === "session" && found.session && found.week}
    {@const session = found.session}
    <h2 class="label">Woche {found.week.number} · Einheit {session.label}</h2>
    <label>Name<input class="field" bind:value={label} maxlength="20" /></label>
    <button type="button" class="btn strong" disabled={busy || !label.trim()} onclick={() => run(() => api.renamePlannedSession(session.id, label.trim()))}>Speichern</button>
    <div class="pair">
      <button type="button" class="btn" disabled={busy} onclick={() => onselect({ kind: "new-item", sessionId: session.id, note: false })}><Icon name="plus" />Übung</button>
      <button type="button" class="btn" disabled={busy} onclick={() => onselect({ kind: "new-item", sessionId: session.id, note: true })}><Icon name="plus" />Hinweis</button>
    </div>
    {#if session.state !== "done"}
      <button type="button" class="btn" disabled={busy} onclick={() => run(() => api.skipPlannedSession(session.id, session.state !== "skipped"))}>
        {session.state === "skipped" ? "Überspringen rückgängig" : "Überspringen"}
      </button>
    {/if}
    {@render danger("Einheit löschen", () => run(() => api.deletePlannedSession(session.id)))}
  {:else if target.kind === "new-item" && !form}
    <h2 class="label">Neue Zeile · Einheit {found.session?.label}</h2>
    <ExercisePick onpick={(e) => (form = emptyForm(e))} />
  {:else if form && (target.kind === "item" || target.kind === "new-item")}
    <h2 class="label">{target.kind === "new-item" ? "Neue Zeile" : "Planzeile"}{found.session ? ` · Einheit ${found.session.label}` : ""}</h2>
      <p class="exercise">{form.exercise?.name ?? "Hinweis"}</p>
      {#if form.exercise}
        <label>Variante<input class="field" bind:value={form.label} maxlength="80" placeholder="z. B. Pause" /></label>
        <div class="pair">
          <label>Sätze<input class="field" inputmode="numeric" bind:value={form.sets} placeholder="4" /></label>
          {#if hasField(form, "reps")}
            <label>Wdh.<input class="field" inputmode="numeric" bind:value={form.reps} disabled={form.toMax} placeholder="3–5" /></label>
          {/if}
        </div>
        {#if hasField(form, "reps")}
          <label class="check"><input type="checkbox" bind:checked={form.toMax} />Bis max.</label>
        {/if}
        {#if hasField(form, "distance")}
          <label>Strecke (m)<input class="field" inputmode="numeric" bind:value={form.distance} /></label>
        {/if}
        {#if hasField(form, "duration")}
          <label>Zeit (s)<input class="field" inputmode="numeric" bind:value={form.duration} placeholder="20–30" /></label>
        {/if}
        {#if hasField(form, "weight")}
          <fieldset>
            <legend class="label">Last</legend>
            <div class="pair">
              <label class="check"><input type="radio" bind:group={form.loadKind} value="none" />Keine</label>
              <label class="check"><input type="radio" bind:group={form.loadKind} value="kg" />kg</label>
              <label class="check"><input type="radio" bind:group={form.loadKind} value="pct" />%</label>
            </div>
            {#if form.loadKind === "kg"}
              <label>Männer (kg)<input class="field" inputmode="decimal" bind:value={form.loadKg} placeholder="72,5" /></label>
              <label>Frauen (kg), optional<input class="field" inputmode="decimal" bind:value={form.loadKgFemale} placeholder="50" /></label>
            {:else if form.loadKind === "pct"}
              <input class="field" inputmode="decimal" aria-label="Prozent" bind:value={form.loadPct} placeholder="85" />
              {#if form.loadRef && !pickingRef}
                <div class="ref">
                  <span class="grow">von {form.loadRef.name}</span>
                  <button type="button" class="link-btn" onclick={() => (pickingRef = true)}>Ändern</button>
                </div>
              {:else}
                <ExercisePick label="Bezugsübung (1RM)" accept={(e) => e.fields.includes("weight")} onpick={(e) => { if (form) form.loadRef = e; pickingRef = false; }} />
              {/if}
              {#if found.item?.weight_kg != null}<p class="muted">Aktuell {formatKg(found.item.weight_kg)} kg</p>{/if}
            {/if}
          </fieldset>
        {/if}
        <label>Test
          <select class="field" bind:value={form.testKind}>
            <option value="">Kein Test</option>
            {#if hasField(form, "weight")}<option value="one_rm">1RM</option>{/if}
            <option value="best">Bestleistung</option>
          </select>
        </label>
        <label>Pause<input class="field" bind:value={form.rest} maxlength="200" placeholder="2 min" /></label>
      {/if}
      <label>Notiz<textarea class="field" bind:value={form.note} maxlength="1000"></textarea></label>
      {#if invalid}<p class="problem" role="alert">{invalid}</p>{/if}
      <button type="button" class="btn strong" disabled={busy} onclick={saveItem}>Speichern</button>
      {#if target.kind === "item"}
        <div class="pair">
          <button type="button" class="btn" disabled={busy || siblings[0] === found.item?.id} onclick={() => move(-1)}><Icon name="up" />Hoch</button>
          <button type="button" class="btn" disabled={busy || siblings.at(-1) === found.item?.id} onclick={() => move(1)}><Icon name="down" />Runter</button>
        </div>
        {@render danger("Zeile löschen", () => run(() => api.deletePlanItem(target.id)))}
      {/if}
  {/if}
</div>

{#snippet danger(text: string, action: () => void)}
  {#if confirming}
    <button type="button" class="btn danger" disabled={busy} onclick={action}>Wirklich: {text}</button>
  {:else}
    <button type="button" class="btn danger" disabled={busy} onclick={() => (confirming = true)}>{text}</button>
  {/if}
{/snippet}

<style>
  .editor {
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
    flex: 1;
    min-width: 0;
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
  .pair {
    display: flex;
    gap: 8px;
  }
  .pair > .btn {
    flex: 1;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .exercise {
    margin: 0;
    font: 800 24px/1.05 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .ref {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }
  p.muted {
    margin: 0;
  }
</style>
