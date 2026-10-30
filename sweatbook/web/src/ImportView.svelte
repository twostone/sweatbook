<script lang="ts">
  import TopBar from "./TopBar.svelte";
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { countImport, importErrorText, parseImportFile } from "./logic/import-file";
  import { goUp, navigate, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { ImportResult } from "./types";

  // Import a plan file: the server checks it first (dry run) and reports what it would create; only then "Importieren".
  let file = $state<unknown>(null);
  let preview = $state<ImportResult | null>(null);
  let problem = $state("");
  let busy = $state(false);

  // A 400 is about the file, shown here with its place; everything else goes to the error bar.
  async function send(dryRun: boolean): Promise<ImportResult | null> {
    let result: ImportResult | null = null;
    problem = "";
    await guard(async () => {
      try {
        result = await api.importProgram(file, dryRun);
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 400) problem = importErrorText(e.detail);
        else throw e;
      }
    });
    return result;
  }

  async function choose(e: Event) {
    const chosen = (e.currentTarget as HTMLInputElement).files?.[0];
    preview = null;
    problem = "";
    file = null;
    if (!chosen) return;
    file = parseImportFile(await chosen.text());
    if (file === null) {
      problem = "Das ist keine gültige JSON-Datei.";
      return;
    }
    busy = true;
    preview = await send(true);
    busy = false;
  }

  async function run() {
    busy = true;
    if (await send(false)) navigate(paths.programs());
    busy = false;
  }

  const counts = $derived(preview ? countImport(preview.program) : null);
</script>

<div class="page">
  <TopBar label="Pläne" backLabel="Zurück zu den Plänen" onback={() => goUp(paths.programs())} />
  <main>
    <h1 class="display page-title">Plan importieren</h1>
    <label class="label" for="plan-file">Plandatei (JSON)</label>
    <input id="plan-file" class="field" type="file" accept=".json,application/json" onchange={choose} />
    {#if problem}
      <p class="problem" role="alert">{problem}</p>
    {/if}
    {#if preview && counts}
      <div class="card sum">
        <span class="name">{preview.program.name}</span>
        <span class="num-text">{counts.weeks} Wochen · {counts.sessions} Einheiten · {counts.lines} Planzeilen</span>
        <span class="muted">Testwerte: {counts.tests} · Start {preview.program.start_date}</span>
        {#if preview.program.done}
          <span class="muted">Vor der App erledigt: {preview.program.done}</span>
        {/if}
        {#if preview.new_exercises.length}
          <span class="label">Neue Übungen im Katalog</span>
          <span>{preview.new_exercises.join(", ")}</span>
        {:else}
          <span class="muted">Alle Übungen gibt es schon im Katalog.</span>
        {/if}
      </div>
    {/if}
  </main>
  <footer>
    <button type="button" class="btn big primary grow" disabled={!preview || busy} onclick={run}><Icon name="check" />Importieren</button>
  </footer>
</div>

<style>
  .sum {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px;
  }
  .name {
    font: 800 22px/1 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .problem {
    margin: 0;
    color: var(--danger);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .grow {
    flex: 1;
  }
</style>
