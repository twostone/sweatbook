<script lang="ts">
  import Icon from "./Icon.svelte";

  // A value that is shown in full, can be selected with one tap and copied with the button.
  let { label, value }: { label: string; value: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      copied = false; // no clipboard access (e.g. inside the ingress frame): the text stays selectable
    }
  }
</script>

<div class="box">
  <span class="label">{label}</span>
  <code>{value}</code>
  <button type="button" class="btn" onclick={copy}><Icon name={copied ? "check" : "copy"} />{copied ? "Kopiert" : "Kopieren"}</button>
</div>

<style>
  .box {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;
  }
  code {
    align-self: stretch;
    padding: 10px;
    border-radius: 8px;
    background: var(--surface-2, rgba(128, 128, 128, 0.15));
    font-size: 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: all;
  }
</style>
