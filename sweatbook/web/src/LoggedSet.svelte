<script lang="ts">
  import { untrack } from "svelte";
  import SetRow from "./SetRow.svelte";
  import { rowFromValues, valuesFromRow, type RowField, type RowText } from "./logic/set-row";
  import { clearRow, deleteSet, loadRow, saveRow, updateSet } from "./store.svelte";
  import type { Metrics, SetLog } from "./types";

  // A logged set, editable in place. A change is saved at once; if that fails the typed text stays (also in
  // localStorage) and the row offers to send it again.
  let { set, blockExerciseId, metrics, index, label }: { set: SetLog; blockExerciseId: string; metrics: Metrics; index: number; label: string } =
    $props();

  type Edit = RowText & { is_max: boolean; note: string };
  // The row is keyed by the set id, so its text starts from the set (or an unsent edit) once and then follows typing.
  const initial = untrack(() => set);
  const key = `edit:${initial.id}`;
  const stored = loadRow<Edit>(key);
  let text = $state<RowText>(stored ?? rowFromValues(initial));
  let isMax = $state(stored?.is_max ?? initial.is_max);
  let note = $state(stored?.note ?? initial.note ?? "");
  let invalid = $state<RowField | null>(null);
  let unsaved = $state(stored !== null);

  async function save() {
    const parsed = valuesFromRow(text, metrics);
    invalid = parsed.ok ? null : parsed.field;
    if (!parsed.ok) return;
    const edit = { ...$state.snapshot(text), is_max: isMax, note };
    saveRow(key, edit);
    const ok = await updateSet(blockExerciseId, set.id, { ...parsed.values, is_max: isMax, note: note.trim() || null });
    unsaved = !ok;
    if (ok) clearRow(key);
  }

  async function remove() {
    if (await deleteSet(blockExerciseId, set.id)) clearRow(key);
  }
</script>

<SetRow {metrics} index={String(index)} {label} bind:text bind:isMax bind:note {invalid} {unsaved} onchange={save} oninput={() => saveRow(key, { ...$state.snapshot(text), is_max: isMax, note })} ondelete={remove} />
