import { writable } from "svelte/store"

export const path = writable(window.location.pathname)

window.addEventListener('navigate', (event) => {
    path.set(window.location.pathname)
});

export const navigate = (path)=>{
    window.location.pathname = path
}