<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import { app, closeSheet, dismissError } from "./store.svelte";

  let { title, children }: { title: string; children: Snippet } = $props();
  let dlg: HTMLDialogElement;

  // Native <dialog>: focus trap, Escape and inert background come for free.
  $effect(() => {
    dlg.showModal();
  });
</script>

<dialog
  bind:this={dlg}
  aria-labelledby="sheet-title"
  onclose={closeSheet}
  onclick={(e) => {
    if (e.target === dlg) dlg.close();
  }}
>
  <div class="sheet">
    <div class="head">
      <h2 id="sheet-title" class="display">{title}</h2>
      <button type="button" class="icon-btn" aria-label="Schließen" onclick={() => dlg.close()}><Icon name="close" /></button>
    </div>
    {#if app.error}
      <div class="error" role="alert">
        <span>{app.error}</span>
        <button type="button" class="link-btn" onclick={dismissError}>OK</button>
      </div>
    {/if}
    {@render children()}
  </div>
</dialog>

<style>
  dialog {
    margin: auto auto 0;
    padding: 0;
    border: 0;
    width: 100%;
    max-width: 480px;
    max-height: 90dvh;
    background: var(--surface);
    color: var(--ink);
    border-radius: 22px 22px 0 0;
  }
  dialog::backdrop {
    background: var(--scrim);
  }
  .sheet {
    padding: 12px 16px max(16px, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    font-size: 28px;
  }
  .error {
    margin: 0;
  }
</style>
