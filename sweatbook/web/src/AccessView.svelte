<script lang="ts">
  import Icon from "./Icon.svelte";
  import * as api from "./api";
  import { mcpCommand, scopeLabel } from "./logic/access";
  import { goUp, paths } from "./router.svelte";
  import { guard } from "./store.svelte";
  import type { ApiToken, TokenScope } from "./types";

  // Access tokens for Claude (MCP): each acts as you. The plain token is shown once, right after creating it.
  let tokens = $state<ApiToken[]>([]);
  let name = $state("");
  let scope = $state<TokenScope>("write");
  let fresh = $state<{ token: string; name: string } | null>(null);
  let copied = $state(false);
  let busy = $state(false);

  const command = $derived(fresh ? mcpCommand(fresh.token) : "");

  async function load() {
    await guard(async () => void (tokens = await api.listTokens()));
  }
  void load();

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    busy = true;
    await guard(async () => {
      const created = await api.createToken(name, scope);
      fresh = { token: created.token, name: created.info.name };
      copied = false;
      name = "";
      tokens = await api.listTokens();
    });
    busy = false;
  }

  async function revoke(token: ApiToken) {
    await guard(async () => {
      await api.revokeToken(token.id);
      tokens = tokens.filter((t) => t.id !== token.id);
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      copied = true;
    } catch {
      copied = false; // no clipboard access (e.g. in the iframe): the command is selectable
    }
  }

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie");
</script>

<div class="page">
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Zurück" onclick={() => goUp(paths.start())}><Icon name="back" /></button>
    <span class="label">Zugriff</span>
  </header>
  <main>
    <h1 class="display page-title">Zugriff für Claude</h1>
    <p class="muted">
      Mit einem Zugriffstoken verbindet sich Claude über MCP mit deinem Training und handelt in deinem Namen. Der MCP-Server muss in den
      App-Optionen eingeschaltet sein.
    </p>

    {#if fresh}
      <div class="card fresh" role="status">
        <span class="label">Token „{fresh.name}“ – wird nur jetzt angezeigt</span>
        <code class="cmd">{command}</code>
        <span class="muted">Die Adresse in der spitzen Klammer ersetzt du durch die, unter der die App von außen erreichbar ist.</span>
        <button type="button" class="btn" onclick={copy}><Icon name="check" />{copied ? "Kopiert" : "Befehl kopieren"}</button>
      </div>
    {/if}

    <form class="card new" onsubmit={create}>
      <label class="label" for="token-name">Name (z. B. Gerät)</label>
      <input id="token-name" class="field" maxlength="60" bind:value={name} autocomplete="off" />
      <fieldset>
        <legend class="label">Berechtigung</legend>
        {#each ["write", "read"] as const as option (option)}
          <label class="opt"><input type="radio" name="scope" value={option} bind:group={scope} />{scopeLabel(option)}</label>
        {/each}
      </fieldset>
      <button type="submit" class="btn primary" disabled={busy || !name.trim()}>Token anlegen</button>
    </form>

    <h2 class="label">Aktive Token</h2>
    {#each tokens as t (t.id)}
      <div class="card row">
        <div class="info">
          <span class="tname">{t.name}</span>
          <span class="muted">{scopeLabel(t.scope)} · zuletzt benutzt: {when(t.last_used_at)}</span>
        </div>
        <button type="button" class="btn" onclick={() => revoke(t)}>Widerrufen</button>
      </div>
    {:else}
      <p class="empty">Noch kein Token.</p>
    {/each}
  </main>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
  }
  .row {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .tname {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .cmd {
    display: block;
    padding: 10px;
    border-radius: 8px;
    background: var(--surface-2, rgba(128, 128, 128, 0.15));
    font-size: 13px;
    overflow-wrap: anywhere;
    user-select: all;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }
</style>
