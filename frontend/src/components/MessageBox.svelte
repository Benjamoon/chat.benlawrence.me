<script>
    import { onMount } from "svelte";
    import {pb, user} from "../lib/pb.js"

    let content = ""

    onMount(()=>{
        //Check content storage incase we just logged in...
        content = localStorage.getItem("messageContent")
        localStorage.removeItem("messageContent")
    })

    const send = async ()=>{
        if (!$user) {
            //Do login with google
            const methods = await pb.collection('users').listAuthMethods();

            const id = 0 //The auth provider to use

            console.log(methods.authProviders[id])

            localStorage.setItem("oauthTempInfo", JSON.stringify(methods.authProviders[id]))
            localStorage.setItem("messageContent", content)
            window.location.href = methods.authProviders[id].authUrl + "https://chat.benlawrence.me/oauthcallback"

            return
        }

        //We are logged in!
        pb.collection("messages").create({
            user: $user.id,
            content: content
        })

        content = ""


    }

</script>

<input bind:value={content} placeholder="Message Here"/>
<button on:click={send}>
    {!$user?"Login":"Send"}
</button>
