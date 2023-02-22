<script>
    import { onMount } from "svelte";
    import { pb } from "../lib/pb";



    onMount(async ()=>{
        let oauthInfo = localStorage.getItem("oauthTempInfo")
        oauthInfo = JSON.parse(oauthInfo)

        const queryString = window.location.search;
        const urlParams = new URLSearchParams(queryString);

        if (oauthInfo.state !== urlParams.get('state')) {
            throw "State parameters don't match.";
        }

        console.log(oauthInfo)

        await pb.collection('users').authWithOAuth2(
            oauthInfo.name,
            urlParams.get("code"),
            oauthInfo.codeVerifier,
            'http://localhost.benlawrence.me/oauthcallback'
        );

        window.location.href = "/"

    })

</script>

Working...