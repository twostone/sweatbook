<script lang="ts">
  import CopyBox from "./CopyBox.svelte";
  import * as api from "./api";
  import { authorizationHeader, mcpCommand, mcpJsonConfig, MCP_URL_PLACEHOLDER, scopeLabel, TOKEN_PLACEHOLDER } from "./logic/access";
  import { guard } from "./store.svelte";
  import type { ApiToken, TokenScope } from "./types";

  // Access tokens: each lets an MCP-capable agent act as you. The plain token is shown once, right after creating it.
  let tokens = $state<ApiToken[]>([]);
  let name = $state("");
  let scope = $state<TokenScope>("write");
  let fresh = $state<{ token: string; name: string } | null>(null);
  let busy = $state(false);

  const token = $derived(fresh?.token ?? TOKEN_PLACEHOLDER);

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
      name = "";
      tokens = await api.listTokens();
    });
    busy = false;
  }

  async function revoke(t: ApiToken) {
    await guard(async () => {
      await api.revokeToken(t.id);
      tokens = tokens.filter((x) => x.id !== t.id);
    });
  }

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie");
</script>

<section>
  <h2 class="label">Access Token</h2>
  <p class="muted">Mit einem Access Token verbindet sich ein MCP-fähiger Agent mit deinem Training und handelt in deinem Namen. Der MCP-Server muss in den App-Optionen eingeschaltet sein.</p>

  {#if fresh}
    <div class="card" role="status">
      <CopyBox label="Token „{fresh.name}“ – wird nur jetzt angezeigt" value={fresh.token} />
    </div>
  {/if}

  <form class="card" onsubmit={create}>
    <label class="label" for="token-name">Name (z. B. Gerät oder Agent)</label>
    <input id="token-name" class="field" maxlength="60" bind:value={name} autocomplete="off" />
    <fieldset>
      <legend class="label">Berechtigung</legend>
      {#each ["write", "read"] as const as option (option)}
        <label class="opt"><input type="radio" name="scope" value={option} bind:group={scope} />{scopeLabel(option)}</label>
      {/each}
    </fieldset>
    <button type="submit" class="btn primary" disabled={busy || !name.trim()}>Token anlegen</button>
  </form>

  <details class="card">
    <summary>Einrichtung</summary>
    <div class="steps">
    <p class="muted">
      Der Server spricht MCP über Streamable HTTP. Von außen ist er nur erreichbar, wenn du die Adresse freigegeben hast (zum Beispiel über einen Tunnel); ersetze den
      Platzhalter durch diese Adresse.{fresh ? "" : " Die Beispiele enthalten einen Platzhalter für das Token."}
    </p>
    <CopyBox label="Server-Adresse" value={MCP_URL_PLACEHOLDER} />
    <CopyBox label="Header" value={authorizationHeader(token)} />
    <CopyBox label="Beispiel: JSON-Konfiguration (Cursor, VS Code, …)" value={mcpJsonConfig(token)} />
    <CopyBox label="Beispiel: Claude Code" value={mcpCommand(token)} />
    </div>
  </details>

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
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2,
  p {
    margin: 0;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
  /* The content of <details> is not a flex child of the card, so it gets its own column. */
  .steps {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 4px;
  }
  summary {
    min-height: var(--tap);
    display: flex;
    align-items: center;
    font-weight: 700;
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
    min-height: var(--tap);
  }
</style>
