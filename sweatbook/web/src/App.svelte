<script lang="ts">
  import AddExerciseSheet from "./AddExerciseSheet.svelte";
  import BlockMenuSheet from "./BlockMenuSheet.svelte";
  import BlockView from "./BlockView.svelte";
  import CatalogView from "./CatalogView.svelte";
  import ExerciseView from "./ExerciseView.svelte";
  import HistoryView from "./HistoryView.svelte";
  import LogSessionSheet from "./LogSessionSheet.svelte";
  import ImportView from "./ImportView.svelte";
  import NewExerciseView from "./NewExerciseView.svelte";
  import ProgramsView from "./ProgramsView.svelte";
  import SessionSheet from "./SessionSheet.svelte";
  import SessionView from "./SessionView.svelte";
  import StartView from "./StartView.svelte";
  import { router } from "./router.svelte";
  import { app, dismissError, init, loadSession } from "./store.svelte";

  init();

  const route = $derived(router.route);
  const sessionId = $derived(route.name === "session" || route.name === "block" ? route.sessionId : null);

  // A session page loads its session when it is not the one already shown.
  $effect(() => {
    if (sessionId && app.session?.id !== sessionId) loadSession(sessionId);
  });
</script>

<div class="frame">
  {#if app.error && app.sheet.kind === "none"}
    <div class="error" role="alert">
      <span>{app.error}</span>
      <button type="button" class="link-btn" onclick={dismissError}>OK</button>
    </div>
  {/if}
  {#if app.stale}
    <p class="notice">Offline: gespeicherter Stand. Neue Eingaben bleiben auf dem Handy, bis die Verbindung wieder da ist.</p>
  {/if}

  {#if !app.ready}
    <p class="empty">Lade …</p>
  {:else if !app.me}
    <p class="empty">Kein Nutzer: Die App läuft nur über Home Assistant.</p>
  {:else if route.name === "start"}
    <StartView />
  {:else if route.name === "new-exercise"}
    <NewExerciseView prefill={route.prefill} fromSheet={route.fromSheet} />
  {:else if route.name === "history"}
    <HistoryView />
  {:else if route.name === "catalog"}
    <CatalogView />
  {:else if route.name === "programs"}
    <ProgramsView />
  {:else if route.name === "program-import"}
    <ImportView />
  {:else if route.name === "exercise"}
    {#key route.exerciseId}
      <ExerciseView exerciseId={route.exerciseId} />
    {/key}
  {:else if app.session?.id === sessionId}
    {#if route.name === "block"}
      {#key route.blockId}
        <BlockView session={app.session} blockId={route.blockId} />
      {/key}
    {:else}
      <SessionView session={app.session} />
    {/if}
  {:else}
    <p class="empty">Lade …</p>
  {/if}
</div>

{#if app.sheet.kind === "add-exercise"}
  <AddExerciseSheet sheet={app.sheet} />
{:else if app.sheet.kind === "session" && app.session}
  <SessionSheet session={app.session} />
{:else if app.sheet.kind === "log-session"}
  <LogSessionSheet />
{:else if app.sheet.kind === "block-menu" && app.session}
  <BlockMenuSheet session={app.session} blockId={app.sheet.blockId} />
{/if}

<style>
  .frame {
    width: 100%;
    max-width: 480px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .frame > :global(.page) {
    flex: 1;
    min-height: 0;
  }
  .error,
  .notice {
    margin-top: 8px;
  }
</style>
