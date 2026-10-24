<script lang="ts">
  // Placeholder until the phase 1 screens land: shows that the app runs and who Home Assistant says is logged in.
  type Me = { id: string; display_name: string | null };
  let me = $state<Me | null>(null);
  let failed = $state(false);

  $effect(() => {
    fetch("api/me")
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : Promise.reject(new Error(String(r.status)))))
      .then((m) => (me = m))
      .catch(() => (failed = true));
  });
</script>

<main>
  <h1>Sweatbook</h1>
  {#if me}
    <p>Angemeldet als {me.display_name ?? "unbekannt"}. Die Oberfläche folgt.</p>
  {:else if failed}
    <p>Kein Nutzer: Die App läuft nur über Home Assistant.</p>
  {:else}
    <p>Lade …</p>
  {/if}
</main>

<style>
  main {
    padding: 24px 16px;
  }
  h1 {
    margin: 0 0 8px;
    font-size: 40px;
    font-weight: 800;
    text-transform: uppercase;
  }
  p {
    margin: 0;
    color: var(--muted);
  }
</style>
