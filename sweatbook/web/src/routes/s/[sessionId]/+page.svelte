<script lang="ts">
  import SessionView from "../../../SessionView.svelte";
  import { app } from "../../../store.svelte";
</script>

<SessionView session={app.session!} />
