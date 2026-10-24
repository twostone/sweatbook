<script lang="ts">
  import Icon from "./Icon.svelte";
  import { formatSessionDate } from "./logic/format";
  import { navigate, paths } from "./router.svelte";
  import { app, refreshSessions, startSession } from "./store.svelte";

  // Start: carry on with the open session or start a new one, and the latest sessions.
  $effect(() => {
    refreshSessions();
  });

  const open = $derived(app.sessions.find((s) => s.ended_at === null));
  const recent = $derived(app.sessions.filter((s) => s !== open).slice(0, 10));
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
      <h2 class="label section">Zuletzt</h2>
      {#each recent as s (s.id)}
        <a
          class="card past"
          href={paths.session(s.id)}
          onclick={(e) => {
            e.preventDefault();
            navigate(paths.session(s.id));
          }}
        >
          <span class="body">
            <span class="label">{formatSessionDate(s.started_at)}</span>
            <span class="name small">{s.title ?? "Training"}</span>
          </span>
          <span class="muted count">{s.set_count} Sätze</span>
          <Icon name="chevron" size={20} />
        </a>
      {/each}
    {:else if !open}
      <p class="empty">Noch keine Sessions.</p>
    {/if}
  </main>

  <footer>
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
  .past {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 10px 10px 10px 14px;
    color: var(--ink);
  }
  .past :global(svg) {
    color: var(--muted);
    flex: none;
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
  .name.small {
    font-size: 20px;
  }
  .go {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--ink);
  }
  .section {
    margin: 12px 4px 0;
  }
  .count {
    font-size: 14px;
  }
</style>
