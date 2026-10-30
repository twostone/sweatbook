<script lang="ts">
  import TokenSection from "./TokenSection.svelte";
  import TopBar from "./TopBar.svelte";
  import { goBack, paths } from "./router.svelte";
  import { app } from "./store.svelte";
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
  .name {
    font: 800 22px/1.1 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
</style>
