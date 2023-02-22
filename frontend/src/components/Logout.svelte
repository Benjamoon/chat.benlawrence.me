<script>
    import { onMount } from "svelte";
    import {pb} from "../lib/pb"


    onMount(()=>{
        pb.authStore.clear()
        window.location.href = "/"
    })
</script>