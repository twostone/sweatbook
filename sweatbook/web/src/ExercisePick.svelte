<script lang="ts">
  import * as api from "./api";
  import { guard } from "./store.svelte";
  import type { Exercise, ExerciseRef } from "./types";

  // A search over the catalog that hands back one exercise. Archived ones are left out.
  let { onpick, accept = () => true, label = "Übung suchen" }: { onpick: (e: ExerciseRef) => void; accept?: (e: Exercise) => boolean; label?: string } = $props();

  let query = $state("");
  let results = $state<Exercise[]>([]);
  let searchNo = 0; // an older answer must not replace a newer one

  $effect(() => {
    const q = query.trim();
    const no = ++searchNo;
    guard(async () => {
      const found = await api.listExercises(q);
      if (no === searchNo) results = found.filter((e) => !e.archived && accept(e));
    });
  });
</script>

<div class="pick">
  <input class="field" type="search" placeholder={label} aria-label={label} bind:value={query} />
  <ul>
    {#each results.slice(0, 8) as e (e.id)}
      <li>
        <button type="button" onclick={() => onpick({ id: e.id, name: e.name, fields: e.fields })}>{e.name}</button>
      </li>
    {:else}
      <li class="muted none">Keine Übung gefunden.</li>
    {/each}
  </ul>
</div>

<style>
  .pick {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li button {
    width: 100%;
    min-height: var(--tap);
    border: 0;
    border-bottom: 1px solid var(--line);
    background: transparent;
    text-align: left;
    padding: 0 4px;
    font-weight: 600;
  }
  .none {
    padding: 10px 4px;
  }
</style>
