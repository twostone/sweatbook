<script lang="ts">
  import "@fontsource/barlow/400.css";
  import "@fontsource/barlow/500.css";
  import "@fontsource/barlow/600.css";
  import "@fontsource/barlow/700.css";
  import "@fontsource/barlow-condensed/600.css";
  import "@fontsource/barlow-condensed/700.css";
  import "@fontsource/barlow-condensed/800.css";
  import "../app.css";
  import { page } from "$app/state";
  import AddExerciseSheet from "../AddExerciseSheet.svelte";
  import BlockMenuSheet from "../BlockMenuSheet.svelte";
  import LogPlannedSheet from "../LogPlannedSheet.svelte";
  import LogSessionSheet from "../LogSessionSheet.svelte";
  import SessionSheet from "../SessionSheet.svelte";
  import { app, dismissError, init } from "../store.svelte";

  let { children } = $props();

  init();
</script>

<div id="app">
  <div class="frame" class:wide={page.route.id === "/programs/[programId]"}>
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
    {:else}
      {@render children()}
    {/if}
  </div>

  {#if app.sheet.kind === "add-exercise"}
    <AddExerciseSheet sheet={app.sheet} />
  {:else if app.sheet.kind === "session" && app.session}
    <SessionSheet session={app.session} />
  {:else if app.sheet.kind === "log-session"}
    <LogSessionSheet />
  {:else if app.sheet.kind === "log-planned"}
    <LogPlannedSheet plannedId={app.sheet.plannedId} />
  {:else if app.sheet.kind === "block-menu" && app.session}
    <BlockMenuSheet session={app.session} blockId={app.sheet.blockId} />
  {/if}
</div>

<style>
  .frame {
    width: 100%;
    max-width: 480px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  /* The plan grid uses the whole window; ProgramView lets its page grow too. */
  @media (min-width: 900px) {
    .frame.wide {
      max-width: none;
    }
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
