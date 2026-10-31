<script lang="ts">
  import TokenSection from "./TokenSection.svelte";
  import TopBar from "./TopBar.svelte";
  import { goBack, paths } from "./router.svelte";
  import * as api from "./api";
  import { app, guard } from "./store.svelte";
  import type { Sex } from "./types";

  // Which fixed weights plans show: lines with separate weights use the matching one (not set = men's).
  const SEX_OPTIONS: { value: Sex; label: string }[] = [
    { value: "male", label: "Männer" },
    { value: "female", label: "Frauen" },
  ];
  const chosen = $derived(app.me?.sex ?? "male");

  async function choose(sex: Sex) {
    if (app.me?.sex === sex) return;
    await guard(async () => void (app.me = await api.setSex(sex)));
  }
</script>

<div class="page">
  <TopBar label="Profil" backLabel="Zurück" onback={() => goBack(paths.start())} profile={false} />
  <main>
    <h1 class="display page-title">Profil</h1>
    <div class="card who">
      <span class="label">Name</span>
      <span class="name">{app.me?.display_name ?? "Home-Assistant-Nutzer"}</span>
      <span class="muted">Der Name kommt von Home Assistant.</span>
    </div>
    <section class="card sex">
      <h2 class="label">Gewichte im Plan</h2>
      <div class="pair" role="group" aria-label="Gewichte im Plan">
        {#each SEX_OPTIONS as o (o.value)}
          <button type="button" class="btn" class:strong={chosen === o.value} aria-pressed={chosen === o.value} onclick={() => choose(o.value)}>{o.label}</button>
        {/each}
      </div>
      <span class="muted">Gilt für Planzeilen mit getrennten Gewichten.</span>
    </section>
    <TokenSection />
  </main>
</div>

<style>
  .who {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px;
  }
  .sex {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
  }
  .sex h2 {
    margin: 0;
  }
  .pair {
    display: flex;
    gap: 8px;
  }
  .pair .btn {
    flex: 1;
  }
  .name {
    font: 800 22px/1.1 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
</style>
