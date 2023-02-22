<script>
    import { path, navigate } from "./lib/path.js";
    import ChatWindow from "./components/ChatWindow.svelte";
    import AuthCallback from "./components/AuthCallback.svelte";
    import Logout from "./components/Logout.svelte";
</script>

{#if $path.startsWith("/logout")}
    <Logout />
{:else if $path.startsWith("/oauthcallback")}
    <AuthCallback />
{:else}
    <ChatWindow />
{/if}
