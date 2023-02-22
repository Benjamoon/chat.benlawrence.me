<script>
    import {user, pb} from "../lib/pb"


    const changeUsername = async ()=>{
        const newName = await window.prompt("New username", $user.username)

        await pb.collection("users").update($user.id, {
            username: newName
        })
    }

</script>

<button on:click={changeUsername}>Change username ({$user.username})</button>
<button on:click={()=>{pb.authStore.clear()}}>Logout</button>