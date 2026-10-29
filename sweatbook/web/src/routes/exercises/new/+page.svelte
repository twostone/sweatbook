<script lang="ts">
  import { page } from "$app/state";
  import NewExerciseView from "../../../NewExerciseView.svelte";
  import { hashQuery } from "../../../logic/routes";

  const query = hashQuery(page.url.hash);
</script>

<NewExerciseView prefill={query.get("name") ?? ""} fromSheet={query.get("from") === "sheet"} />
