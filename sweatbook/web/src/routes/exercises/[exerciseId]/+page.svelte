<script lang="ts">
  import { page } from "$app/state";
  import ExerciseView from "../../../ExerciseView.svelte";
</script>

{#key page.params.exerciseId}
  <ExerciseView exerciseId={page.params.exerciseId!} />
{/key}
