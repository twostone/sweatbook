<script lang="ts">
  import * as api from "./api";
  import { fieldName } from "./drafts";
  import { parseDistance, parseDuration, parseKg, parseReps, durationInput } from "./logic/numbers";
  import { formatTest, TEST_KIND_NAMES } from "./logic/plan";
  import { rowFields } from "./logic/set-row";
  import { guard } from "./store.svelte";
  import type { Exercise, ExerciseTest, TestKind } from "./types";

  // Test values of an exercise: 1RM (drives the %-weights of a plan) and best performances, with date. A training set on a
  // test line adds one by itself; here they are entered by hand or removed.
  let { exercise }: { exercise: Exercise } = $props();

  let tests = $state<ExerciseTest[]>([]);
  let adding = $state(false);
  let kind = $state<TestKind>("one_rm");
  let date = $state(new Date().toISOString().slice(0, 10));
  let text = $state({ kg: "", reps: "", dist: "", time: "" });
  let invalid = $state(false);

  $effect(() => {
    guard(async () => {
      tests = await api.listTests(exercise.id);
    });
  });

  const fields = $derived(rowFields(exercise.fields));

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const kg = parseKg(text.kg);
    const reps = fields.includes("reps") ? parseReps(text.reps) : null;
    const distance_m = fields.includes("dist") ? parseDistance(text.dist) : null;
    const duration_s = fields.includes("time") ? parseDuration(text.time) : null;
    if ([kg, reps, distance_m, duration_s].includes(undefined) || !date || (kind === "one_rm" && kg === null)) {
      invalid = true;
      return;
    }
    invalid = false;
    const created = await guard(async () => {
      await api.createTest(exercise.id, { kind, tested_on: date, weight_kg: kg!, reps: reps!, distance_m: distance_m!, duration_s: duration_s! });
      tests = await api.listTests(exercise.id);
    });
    if (created) {
      adding = false;
      text = { kg: "", reps: "", dist: "", time: "" };
    }
  }

  const remove = (id: string) =>
    guard(async () => {
      await api.deleteTest(id);
      tests = tests.filter((t) => t.id !== id);
    });
</script>

<h2 class="label section">Testwerte</h2>
<div class="card list">
  {#each tests as t (t.id)}
    <div class="test">
      <span class="grow">{TEST_KIND_NAMES[t.kind]} · {t.tested_on.split("-").reverse().join(".")}</span>
      <span class="num-text">{formatTest(t)}</span>
      <button type="button" class="link-btn" aria-label="Testwert vom {t.tested_on} löschen" onclick={() => remove(t.id)}>Löschen</button>
    </div>
  {:else}
    <p class="muted none">Noch keine Testwerte.</p>
  {/each}
</div>
{#if adding}
  <form class="card form" onsubmit={add}>
    <label class="label" for="test-kind">Art</label>
    <select id="test-kind" class="field" bind:value={kind}>
      <option value="one_rm">{TEST_KIND_NAMES.one_rm}</option>
      <option value="best">{TEST_KIND_NAMES.best}</option>
    </select>
    <label class="label" for="test-date">Datum</label>
    <input id="test-date" class="field" type="date" required bind:value={date} />
    {#each fields as f (f)}
      <label class="label" for="test-{f}">{fieldName(f)}</label>
      {#if f === "time"}
        <input id="test-{f}" class="field" inputmode="numeric" autocomplete="off" placeholder="0:00" value={text.time}
          oninput={(e) => (e.currentTarget.value = text.time = durationInput(e.currentTarget.value))} />
      {:else}
        <input id="test-{f}" class="field" inputmode={f === "kg" ? "decimal" : "numeric"} autocomplete="off" bind:value={text[f]} />
      {/if}
    {/each}
    {#if invalid}<p class="problem" role="alert">Bitte Werte prüfen (ein 1RM braucht ein Gewicht).</p>{/if}
    <div class="buttons">
      <button type="button" class="btn" onclick={() => (adding = false)}>Abbrechen</button>
      <button type="submit" class="btn primary">Eintragen</button>
    </div>
  </form>
{:else}
  <button type="button" class="btn" onclick={() => (adding = true)}>Testwert eintragen</button>
{/if}

<style>
  .list {
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
  .none {
    margin: 12px 0;
  }
  .grow {
    flex: 1;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .buttons .btn {
    flex: 1;
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
  }
</style>
