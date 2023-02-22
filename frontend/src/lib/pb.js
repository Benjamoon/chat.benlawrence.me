import PocketBase from 'pocketbase';
import { writable } from 'svelte/store';

export const pb = new PocketBase('https://chat.benlawrence.me/pb/'); 

export const user = writable(pb.authStore.model);

pb.authStore.onChange((auth) => {
    user.set(pb.authStore.model);
});