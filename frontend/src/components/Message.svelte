<script>
    import {pb, user} from "../lib/pb"

    export let message;
    export let id;
</script>

{message.user.username}: {message.content}

{#if message.user.id == $user?.id}
    <button on:click={()=>{pb.collection("messages").delete(id)}}>X</button>
{/if}