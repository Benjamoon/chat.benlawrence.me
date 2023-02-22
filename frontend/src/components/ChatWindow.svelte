<script>
    import { onMount } from "svelte";
    import { pb, user } from "../lib/pb.js";
    import Message from "./Message.svelte";
    import MessageBox from "./MessageBox.svelte";
    import AccountHeader from "./AccountHeader.svelte";

    let messages = {};


    //Because with realtime data we cant expand the users field, we need to get that ourselves... Might as well cache it!
    let cachedUserIDs = {};
    const recordToMessage = async (record) => {

        //Get the username
        if (cachedUserIDs[record.user]) { //Is cached
            record.user = cachedUserIDs[record.user]
        }else if (record.expand?.user) { //Is old message, should have expand value..
            cachedUserIDs[record.user] = record.expand.user
            record.user = cachedUserIDs[record.user]
        }else { //Didnt have an expand... Probably realtime data
            const user = await pb.collection("users").getOne(record.user)
            cachedUserIDs[record.user] = user
            record.user = cachedUserIDs[record.user]
        }


        return {
            content: record.content,
            user: record.user
        };
    };

    onMount(async () => {
        //grab previous messages (max of x)
        const oldMessages = await pb
            .collection("messages")
            .getFullList(50, {
                sort: "+created",
                expand: "user",
            });

        

        oldMessages.forEach(async (message) => {
            messages[message.id] = await recordToMessage(message);
        });

        await pb.collection("messages").subscribe("*", async (e) => {
            switch (e.action) {
                case "create":
                    messages[e.record.id] = await recordToMessage(e.record);
                    break;
                case "delete":
                    messages[e.record.id] = {
                        user: {
                            username: "<redacted>"
                        },
                        content: "<message deleted>"
                    }
                    messages = messages;
                    break;
            }
        });
    });
</script>

<div>
    {#if $user}
        <AccountHeader />
    {/if}
    <br>
    {#each Object.entries(messages) as [id, message]}
        <Message {id} {message}/>
        <br />
    {/each}
    <br />
    <MessageBox />
</div>
