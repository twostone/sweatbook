<script lang="ts">
  import Icon from "./Icon.svelte";
  import SessionRow from "./SessionRow.svelte";
  import { formatSessionDate } from "./logic/format";
  import { navigate, paths } from "./router.svelte";
  import { app, openSheet, refreshSessions, startSession } from "./store.svelte";

  // Start: carry on with the open session, start a new one or enter a past one, the latest sessions, and the way to
  // the history and the catalog.
  $effect(() => {
    refreshSessions();
  });

  const open = $derived(app.sessions.find((s) => s.ended_at === null));
  const recent = $derived(app.sessions.filter((s) => s !== open));
  let busy = $state(false);

  async function start() {
    busy = true;
    await startSession();
    busy = false;
  }
</script>

<div class="page">
  <header class="head">
    <h1 class="display">Sweatbook</h1>
    {#if app.me?.display_name}<p class="muted">Hallo {app.me.display_name}</p>{/if}
  </header>

  <main>
    {#if open}
      <a
        class="card live"
        href={paths.session(open.id)}
        onclick={(e) => {
          e.preventDefault();
          navigate(paths.session(open.id));
        }}
      >
        <span class="body">
          <span class="kicker">Läuft · {formatSessionDate(open.started_at)}</span>
          <span class="name">{open.title ?? "Training"}</span>
          <span class="muted">{open.block_count} Übungen · {open.set_count} Sätze</span>
        </span>
        <span class="label go">Weiter <Icon name="arrow-right" size={18} /></span>
      </a>
    {/if}

    {#if recent.length}
      <div class="section">
        <h2 class="label">Zuletzt</h2>
        <button type="button" class="link-btn" onclick={() => navigate(paths.history())}>Alle Sessions</button>
      </div>
      {#each recent as s (s.id)}
        <SessionRow session={s} />
      {/each}
    {:else if !open}
      <p class="empty">Noch keine Sessions.</p>
    {/if}
    <button type="button" class="link-btn log" onclick={() => openSheet({ kind: "log-session" })}>Training nachtragen</button>
  </main>

  <footer>
    <button type="button" class="btn big" onclick={() => navigate(paths.catalog())}><Icon name="list" />Katalog</button>
    <button type="button" class="btn big grow" class:primary={!open} disabled={busy} onclick={start}>
      <Icon name="plus" />Neue Session
    </button>
  </footer>
</div>

<style>
  .head {
    padding: 24px 16px 12px;
  }
  h1 {
    font-size: 44px;
  }
  .head p {
    margin: 6px 0 0;
  }
  .grow {
    flex: 1;
  }
  .live {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--accent-soft);
    outline: 2px solid var(--accent-ink);
    outline-offset: -2px;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .kicker {
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .name {
    font: 800 26px/1 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .go {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--ink);
  }
  .section {
    margin: 12px 4px 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section h2 {
    margin: 0;
  }
  .log {
    align-self: center;
    color: var(--muted);
  }
</style>
