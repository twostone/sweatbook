<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import * as api from "./api";
  import { paths } from "./router.svelte";
  import { changeSession, closeSheet, closeSheetAndNavigate, openSheet } from "./store.svelte";
  import type { SessionTree } from "./types";

  // The "…" menu of a block: make it a superset, take an exercise out, remove the block.
  let { session, blockId }: { session: SessionTree; blockId: string } = $props();

  const block = $derived(session.blocks.find((b) => b.id === blockId));
  let confirmRemove = $state(false);
  const setCount = $derived(block?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? 0);

  const addToBlock = () => openSheet({ kind: "add-exercise", target: { sessionId: session.id, blockId, openAfter: false }, query: "" });

  // Taking out the last exercise removes the block (server rule), so the page goes back to the overview then.
  async function removeExercise(blockExerciseId: string) {
    const last = block?.exercises.length === 1;
    if (!(await changeSession(() => api.removeBlockExercise(blockExerciseId)))) return;
    if (last) closeSheetAndNavigate(paths.session(session.id));
    else closeSheet();
  }

  async function removeBlock() {
    if (await changeSession(() => api.deleteBlock(blockId))) closeSheetAndNavigate(paths.session(session.id));
  }
</script>

<Sheet title="Optionen">
  {#if block}
    <div class="actions">
      <button type="button" class="btn" onclick={addToBlock}>{block.type === "superset" ? "Übung zum Supersatz" : "Zu Supersatz machen"}</button>
      {#if block.type === "superset"}
        {#each block.exercises as be, i (be.id)}
          <button type="button" class="btn" onclick={() => removeExercise(be.id)}>A{i + 1} {be.exercise.name} entfernen</button>
        {/each}
      {/if}
      {#if confirmRemove}
        <p class="warn">{setCount ? `Der Block hat ${setCount} ${setCount === 1 ? "Satz" : "Sätze"}, sie werden mit gelöscht.` : "Block entfernen?"}</p>
        <button type="button" class="btn danger" onclick={removeBlock}>Wirklich entfernen</button>
      {:else}
        <button type="button" class="btn danger" onclick={() => (confirmRemove = true)}>Aus der Session entfernen</button>
      {/if}
    </div>
  {/if}
</Sheet>

<style>
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .actions .btn {
    justify-content: flex-start;
    min-height: 52px;
  }
  .warn {
    margin: 4px 0 0;
    color: var(--danger);
    font-weight: 600;
  }
</style>
