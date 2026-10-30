<script lang="ts">
  import Icon from "./Icon.svelte";
  import { navigate, paths } from "./router.svelte";
</script>

<!-- The way to the profile (and the access tokens in it), at the right end of every header. -->
<button type="button" class="icon-btn" aria-label="Profil" onclick={() => navigate(paths.profile())}><Icon name="user" /></button>
