var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function subscribe(store, ...callbacks) {
        if (store == null) {
            return noop;
        }
        const unsub = store.subscribe(...callbacks);
        return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
    }
    function component_subscribe(component, store, callback) {
        component.$$.on_destroy.push(subscribe(store, callback));
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        if (node.parentNode) {
            node.parentNode.removeChild(node);
        }
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.wholeText !== data)
            text.data = data;
    }
    function set_input_value(input, value) {
        input.value = value == null ? '' : value;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    /**
     * The `onMount` function schedules a callback to run as soon as the component has been mounted to the DOM.
     * It must be called during the component's initialisation (but doesn't need to live *inside* the component;
     * it can be called from an external module).
     *
     * `onMount` does not run inside a [server-side component](/docs#run-time-server-side-component-api).
     *
     * https://svelte.dev/docs#run-time-svelte-onmount
     */
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    // flush() calls callbacks in this order:
    // 1. All beforeUpdate callbacks, in order: parents before children
    // 2. All bind:this callbacks, in reverse order: children before parents.
    // 3. All afterUpdate callbacks, in order: parents before children. EXCEPT
    //    for afterUpdates called during the initial onMount, which are called in
    //    reverse order: children before parents.
    // Since callbacks might update component values, which could trigger another
    // call to flush(), the following steps guard against this:
    // 1. During beforeUpdate, any updated components will be added to the
    //    dirty_components array and will cause a reentrant call to flush(). Because
    //    the flush index is kept outside the function, the reentrant call will pick
    //    up where the earlier call left off and go through all dirty components. The
    //    current_component value is saved and restored so that the reentrant call will
    //    not interfere with the "parent" flush() call.
    // 2. bind:this callbacks cannot trigger new flush() calls.
    // 3. During afterUpdate, any updated components will NOT have their afterUpdate
    //    callback called a second time; the seen_callbacks set, outside the flush()
    //    function, guarantees this behavior.
    const seen_callbacks = new Set();
    let flushidx = 0; // Do *not* move this inside the flush() function
    function flush() {
        // Do not reenter flush while dirty components are updated, as this can
        // result in an infinite loop. Instead, let the inner flush handle it.
        // Reentrancy is ok afterwards for bindings etc.
        if (flushidx !== 0) {
            return;
        }
        const saved_component = current_component;
        do {
            // first, call beforeUpdate functions
            // and update components
            try {
                while (flushidx < dirty_components.length) {
                    const component = dirty_components[flushidx];
                    flushidx++;
                    set_current_component(component);
                    update(component.$$);
                }
            }
            catch (e) {
                // reset dirty state to not end up in a deadlocked state and then rethrow
                dirty_components.length = 0;
                flushidx = 0;
                throw e;
            }
            set_current_component(null);
            dirty_components.length = 0;
            flushidx = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        seen_callbacks.clear();
        set_current_component(saved_component);
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
        else if (callback) {
            callback();
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = component.$$.on_mount.map(run).filter(is_function);
                // if the component was destroyed immediately
                // it will update the `$$.on_destroy` reference to `null`.
                // the destructured on_destroy may still reference to the old array
                if (component.$$.on_destroy) {
                    component.$$.on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: [],
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            if (!is_function(callback)) {
                return noop;
            }
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    const subscriber_queue = [];
    /**
     * Create a `Writable` store that allows both updating and reading by subscription.
     * @param {*=}value initial value
     * @param {StartStopNotifier=}start start and stop notifications for subscriptions
     */
    function writable(value, start = noop) {
        let stop;
        const subscribers = new Set();
        function set(new_value) {
            if (safe_not_equal(value, new_value)) {
                value = new_value;
                if (stop) { // store is ready
                    const run_queue = !subscriber_queue.length;
                    for (const subscriber of subscribers) {
                        subscriber[1]();
                        subscriber_queue.push(subscriber, value);
                    }
                    if (run_queue) {
                        for (let i = 0; i < subscriber_queue.length; i += 2) {
                            subscriber_queue[i][0](subscriber_queue[i + 1]);
                        }
                        subscriber_queue.length = 0;
                    }
                }
            }
        }
        function update(fn) {
            set(fn(value));
        }
        function subscribe(run, invalidate = noop) {
            const subscriber = [run, invalidate];
            subscribers.add(subscriber);
            if (subscribers.size === 1) {
                stop = start(set) || noop;
            }
            run(value);
            return () => {
                subscribers.delete(subscriber);
                if (subscribers.size === 0) {
                    stop();
                    stop = null;
                }
            };
        }
        return { set, update, subscribe };
    }

    const path = writable(window.location.pathname);

    window.addEventListener('navigate', (event) => {
        path.set(window.location.pathname);
    });

    var extendStatics=function(e,t){return extendStatics=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n]);},extendStatics(e,t)};function __extends(e,t){if("function"!=typeof t&&null!==t)throw new TypeError("Class extends value "+String(t)+" is not a constructor or null");function __(){this.constructor=e;}extendStatics(e,t),e.prototype=null===t?Object.create(t):(__.prototype=t.prototype,new __);}var __assign=function(){return __assign=Object.assign||function __assign(e){for(var t,n=1,i=arguments.length;n<i;n++)for(var o in t=arguments[n])Object.prototype.hasOwnProperty.call(t,o)&&(e[o]=t[o]);return e},__assign.apply(this,arguments)};function __awaiter(e,t,n,i){return new(n||(n=Promise))((function(o,r){function fulfilled(e){try{step(i.next(e));}catch(e){r(e);}}function rejected(e){try{step(i.throw(e));}catch(e){r(e);}}function step(e){e.done?o(e.value):function adopt(e){return e instanceof n?e:new n((function(t){t(e);}))}(e.value).then(fulfilled,rejected);}step((i=i.apply(e,t||[])).next());}))}function __generator(e,t){var n,i,o,r,s={label:0,sent:function(){if(1&o[0])throw o[1];return o[1]},trys:[],ops:[]};return r={next:verb(0),throw:verb(1),return:verb(2)},"function"==typeof Symbol&&(r[Symbol.iterator]=function(){return this}),r;function verb(r){return function(a){return function step(r){if(n)throw new TypeError("Generator is already executing.");for(;s;)try{if(n=1,i&&(o=2&r[0]?i.return:r[0]?i.throw||((o=i.return)&&o.call(i),0):i.next)&&!(o=o.call(i,r[1])).done)return o;switch(i=0,o&&(r=[2&r[0],o.value]),r[0]){case 0:case 1:o=r;break;case 4:return s.label++,{value:r[1],done:!1};case 5:s.label++,i=r[1],r=[0];continue;case 7:r=s.ops.pop(),s.trys.pop();continue;default:if(!(o=s.trys,(o=o.length>0&&o[o.length-1])||6!==r[0]&&2!==r[0])){s=0;continue}if(3===r[0]&&(!o||r[1]>o[0]&&r[1]<o[3])){s.label=r[1];break}if(6===r[0]&&s.label<o[1]){s.label=o[1],o=r;break}if(o&&s.label<o[2]){s.label=o[2],s.ops.push(r);break}o[2]&&s.ops.pop(),s.trys.pop();continue}r=t.call(e,s);}catch(e){r=[6,e],i=0;}finally{n=o=0;}if(5&r[0])throw r[1];return {value:r[0]?r[1]:void 0,done:!0}}([r,a])}}}var e,t=function(e){function ClientResponseError(t){var n,i,o,r,s=this;return (s=e.call(this,"ClientResponseError")||this).url="",s.status=0,s.response={},s.isAbort=!1,s.originalError=null,Object.setPrototypeOf(s,ClientResponseError.prototype),t instanceof ClientResponseError||(s.originalError=t),null!==t&&"object"==typeof t&&(s.url="string"==typeof t.url?t.url:"",s.status="number"==typeof t.status?t.status:0,s.response=null!==t.data&&"object"==typeof t.data?t.data:{},s.isAbort=!!t.isAbort),"undefined"!=typeof DOMException&&t instanceof DOMException&&(s.isAbort=!0),s.name="ClientResponseError "+s.status,s.message=null===(n=s.response)||void 0===n?void 0:n.message,s.message||(s.isAbort?s.message="The request was autocancelled. You can find more info in https://github.com/pocketbase/js-sdk#auto-cancellation.":(null===(r=null===(o=null===(i=s.originalError)||void 0===i?void 0:i.cause)||void 0===o?void 0:o.message)||void 0===r?void 0:r.includes("ECONNREFUSED ::1"))?s.message="Failed to connect to the PocketBase server. Try changing the SDK URL from localhost to 127.0.0.1 (https://github.com/pocketbase/js-sdk/issues/21).":s.message="Something went wrong while processing your request."),s}return __extends(ClientResponseError,e),Object.defineProperty(ClientResponseError.prototype,"data",{get:function(){return this.response},enumerable:!1,configurable:!0}),ClientResponseError.prototype.toJSON=function(){return __assign({},this)},ClientResponseError}(Error),n=/^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;function cookieSerialize(e,t,i){var o=Object.assign({},i||{}),r=o.encode||defaultEncode;if(!n.test(e))throw new TypeError("argument name is invalid");var s=r(t);if(s&&!n.test(s))throw new TypeError("argument val is invalid");var a=e+"="+s;if(null!=o.maxAge){var c=o.maxAge-0;if(isNaN(c)||!isFinite(c))throw new TypeError("option maxAge is invalid");a+="; Max-Age="+Math.floor(c);}if(o.domain){if(!n.test(o.domain))throw new TypeError("option domain is invalid");a+="; Domain="+o.domain;}if(o.path){if(!n.test(o.path))throw new TypeError("option path is invalid");a+="; Path="+o.path;}if(o.expires){if(!function isDate(e){return "[object Date]"===Object.prototype.toString.call(e)||e instanceof Date}(o.expires)||isNaN(o.expires.valueOf()))throw new TypeError("option expires is invalid");a+="; Expires="+o.expires.toUTCString();}if(o.httpOnly&&(a+="; HttpOnly"),o.secure&&(a+="; Secure"),o.priority)switch("string"==typeof o.priority?o.priority.toLowerCase():o.priority){case"low":a+="; Priority=Low";break;case"medium":a+="; Priority=Medium";break;case"high":a+="; Priority=High";break;default:throw new TypeError("option priority is invalid")}if(o.sameSite)switch("string"==typeof o.sameSite?o.sameSite.toLowerCase():o.sameSite){case!0:a+="; SameSite=Strict";break;case"lax":a+="; SameSite=Lax";break;case"strict":a+="; SameSite=Strict";break;case"none":a+="; SameSite=None";break;default:throw new TypeError("option sameSite is invalid")}return a}function defaultDecode(e){return -1!==e.indexOf("%")?decodeURIComponent(e):e}function defaultEncode(e){return encodeURIComponent(e)}function getTokenPayload(t){if(t)try{var n=decodeURIComponent(e(t.split(".")[1]).split("").map((function(e){return "%"+("00"+e.charCodeAt(0).toString(16)).slice(-2)})).join(""));return JSON.parse(n)||{}}catch(e){}return {}}e="function"==typeof atob?atob:function(e){var t=String(e).replace(/=+$/,"");if(t.length%4==1)throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");for(var n,i,o=0,r=0,s="";i=t.charAt(r++);~i&&(n=o%4?64*n+i:i,o++%4)?s+=String.fromCharCode(255&n>>(-2*o&6)):0)i="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".indexOf(i);return s};var i=function(){function BaseModel(e){void 0===e&&(e={}),this.load(e||{});}return BaseModel.prototype.load=function(e){for(var t=0,n=Object.entries(e);t<n.length;t++){var i=n[t],o=i[0],r=i[1];this[o]=r;}this.id=void 0!==e.id?e.id:"",this.created=void 0!==e.created?e.created:"",this.updated=void 0!==e.updated?e.updated:"";},Object.defineProperty(BaseModel.prototype,"isNew",{get:function(){return !this.id},enumerable:!1,configurable:!0}),BaseModel.prototype.clone=function(){var e="function"==typeof structuredClone?structuredClone(this):JSON.parse(JSON.stringify(this));return new this.constructor(e)},BaseModel.prototype.export=function(){return Object.assign({},this)},BaseModel}(),o=function(e){function Record(){return null!==e&&e.apply(this,arguments)||this}return __extends(Record,e),Record.prototype.load=function(t){e.prototype.load.call(this,t),this.collectionId="string"==typeof t.collectionId?t.collectionId:"",this.collectionName="string"==typeof t.collectionName?t.collectionName:"",this.loadExpand(t.expand);},Record.prototype.loadExpand=function(e){for(var t in e=e||{},this.expand={},e)Array.isArray(e[t])?this.expand[t]=e[t].map((function(e){return new Record(e||{})})):this.expand[t]=new Record(e[t]||{});},Record}(i),r=function(e){function Admin(){return null!==e&&e.apply(this,arguments)||this}return __extends(Admin,e),Admin.prototype.load=function(t){e.prototype.load.call(this,t),this.avatar="number"==typeof t.avatar?t.avatar:0,this.email="string"==typeof t.email?t.email:"";},Admin}(i),s=function(){function BaseAuthStore(){this.baseToken="",this.baseModel=null,this._onChangeCallbacks=[];}return Object.defineProperty(BaseAuthStore.prototype,"token",{get:function(){return this.baseToken},enumerable:!1,configurable:!0}),Object.defineProperty(BaseAuthStore.prototype,"model",{get:function(){return this.baseModel},enumerable:!1,configurable:!0}),Object.defineProperty(BaseAuthStore.prototype,"isValid",{get:function(){return !function isTokenExpired(e,t){void 0===t&&(t=0);var n=getTokenPayload(e);return !(Object.keys(n).length>0&&(!n.exp||n.exp-t>Date.now()/1e3))}(this.token)},enumerable:!1,configurable:!0}),BaseAuthStore.prototype.save=function(e,t){this.baseToken=e||"",this.baseModel=null!==t&&"object"==typeof t?void 0!==t.collectionId?new o(t):new r(t):null,this.triggerChange();},BaseAuthStore.prototype.clear=function(){this.baseToken="",this.baseModel=null,this.triggerChange();},BaseAuthStore.prototype.loadFromCookie=function(e,t){void 0===t&&(t="pb_auth");var n=function cookieParse(e,t){var n={};if("string"!=typeof e)return n;for(var i=Object.assign({},t||{}).decode||defaultDecode,o=0;o<e.length;){var r=e.indexOf("=",o);if(-1===r)break;var s=e.indexOf(";",o);if(-1===s)s=e.length;else if(s<r){o=e.lastIndexOf(";",r-1)+1;continue}var a=e.slice(o,r).trim();if(void 0===n[a]){var c=e.slice(r+1,s).trim();34===c.charCodeAt(0)&&(c=c.slice(1,-1));try{n[a]=i(c);}catch(e){n[a]=c;}}o=s+1;}return n}(e||"")[t]||"",i={};try{(null===typeof(i=JSON.parse(n))||"object"!=typeof i||Array.isArray(i))&&(i={});}catch(e){}this.save(i.token||"",i.model||null);},BaseAuthStore.prototype.exportToCookie=function(e,t){var n,i,r;void 0===t&&(t="pb_auth");var s={secure:!0,sameSite:!0,httpOnly:!0,path:"/"},a=getTokenPayload(this.token);(null==a?void 0:a.exp)?s.expires=new Date(1e3*a.exp):s.expires=new Date("1970-01-01"),e=Object.assign({},s,e);var c={token:this.token,model:(null===(n=this.model)||void 0===n?void 0:n.export())||null},u=cookieSerialize(t,JSON.stringify(c),e),l="undefined"!=typeof Blob?new Blob([u]).size:u.length;return c.model&&l>4096&&(c.model={id:null===(i=null==c?void 0:c.model)||void 0===i?void 0:i.id,email:null===(r=null==c?void 0:c.model)||void 0===r?void 0:r.email},this.model instanceof o&&(c.model.username=this.model.username,c.model.verified=this.model.verified,c.model.collectionId=this.model.collectionId),u=cookieSerialize(t,JSON.stringify(c),e)),u},BaseAuthStore.prototype.onChange=function(e,t){var n=this;return void 0===t&&(t=!1),this._onChangeCallbacks.push(e),t&&e(this.token,this.model),function(){for(var t=n._onChangeCallbacks.length-1;t>=0;t--)if(n._onChangeCallbacks[t]==e)return delete n._onChangeCallbacks[t],void n._onChangeCallbacks.splice(t,1)}},BaseAuthStore.prototype.triggerChange=function(){for(var e=0,t=this._onChangeCallbacks;e<t.length;e++){var n=t[e];n&&n(this.token,this.model);}},BaseAuthStore}(),a=function(e){function LocalAuthStore(t){void 0===t&&(t="pocketbase_auth");var n=e.call(this)||this;return n.storageFallback={},n.storageKey=t,n}return __extends(LocalAuthStore,e),Object.defineProperty(LocalAuthStore.prototype,"token",{get:function(){return (this._storageGet(this.storageKey)||{}).token||""},enumerable:!1,configurable:!0}),Object.defineProperty(LocalAuthStore.prototype,"model",{get:function(){var e,t=this._storageGet(this.storageKey)||{};return null===t||"object"!=typeof t||null===t.model||"object"!=typeof t.model?null:void 0===(null===(e=t.model)||void 0===e?void 0:e.collectionId)?new r(t.model):new o(t.model)},enumerable:!1,configurable:!0}),LocalAuthStore.prototype.save=function(t,n){this._storageSet(this.storageKey,{token:t,model:n}),e.prototype.save.call(this,t,n);},LocalAuthStore.prototype.clear=function(){this._storageRemove(this.storageKey),e.prototype.clear.call(this);},LocalAuthStore.prototype._storageGet=function(e){if("undefined"!=typeof window&&(null===window||void 0===window?void 0:window.localStorage)){var t=window.localStorage.getItem(e)||"";try{return JSON.parse(t)}catch(e){return t}}return this.storageFallback[e]},LocalAuthStore.prototype._storageSet=function(e,t){if("undefined"!=typeof window&&(null===window||void 0===window?void 0:window.localStorage)){var n=t;"string"!=typeof t&&(n=JSON.stringify(t)),window.localStorage.setItem(e,n);}else this.storageFallback[e]=t;},LocalAuthStore.prototype._storageRemove=function(e){var t;"undefined"!=typeof window&&(null===window||void 0===window?void 0:window.localStorage)&&(null===(t=window.localStorage)||void 0===t||t.removeItem(e)),delete this.storageFallback[e];},LocalAuthStore}(s),c=function c(e){this.client=e;},u=function(e){function SettingsService(){return null!==e&&e.apply(this,arguments)||this}return __extends(SettingsService,e),SettingsService.prototype.getAll=function(e){return void 0===e&&(e={}),this.client.send("/api/settings",{method:"GET",params:e}).then((function(e){return e||{}}))},SettingsService.prototype.update=function(e,t){return void 0===e&&(e={}),void 0===t&&(t={}),this.client.send("/api/settings",{method:"PATCH",params:t,body:e}).then((function(e){return e||{}}))},SettingsService.prototype.testS3=function(e){return void 0===e&&(e={}),this.client.send("/api/settings/test/s3",{method:"POST",params:e}).then((function(){return !0}))},SettingsService.prototype.testEmail=function(e,t,n){void 0===n&&(n={});var i={email:e,template:t};return this.client.send("/api/settings/test/email",{method:"POST",params:n,body:i}).then((function(){return !0}))},SettingsService}(c),l=function l(e,t,n,i,o){this.page=e>0?e:1,this.perPage=t>=0?t:0,this.totalItems=n>=0?n:0,this.totalPages=i>=0?i:0,this.items=o||[];},d=function(e){function CrudService(){return null!==e&&e.apply(this,arguments)||this}return __extends(CrudService,e),CrudService.prototype.getFullList=function(e,t){if("number"==typeof e)return this._getFullList(this.baseCrudPath,e,t);var n=Object.assign({},e,t);return this._getFullList(this.baseCrudPath,n.batch||200,n)},CrudService.prototype.getList=function(e,t,n){return void 0===e&&(e=1),void 0===t&&(t=30),void 0===n&&(n={}),this._getList(this.baseCrudPath,e,t,n)},CrudService.prototype.getFirstListItem=function(e,t){return void 0===t&&(t={}),this._getFirstListItem(this.baseCrudPath,e,t)},CrudService.prototype.getOne=function(e,t){return void 0===t&&(t={}),this._getOne(this.baseCrudPath,e,t)},CrudService.prototype.create=function(e,t){return void 0===e&&(e={}),void 0===t&&(t={}),this._create(this.baseCrudPath,e,t)},CrudService.prototype.update=function(e,t,n){return void 0===t&&(t={}),void 0===n&&(n={}),this._update(this.baseCrudPath,e,t,n)},CrudService.prototype.delete=function(e,t){return void 0===t&&(t={}),this._delete(this.baseCrudPath,e,t)},CrudService}(function(e){function BaseCrudService(){return null!==e&&e.apply(this,arguments)||this}return __extends(BaseCrudService,e),BaseCrudService.prototype._getFullList=function(e,t,n){var i=this;void 0===t&&(t=200),void 0===n&&(n={});var o=[],request=function(r){return __awaiter(i,void 0,void 0,(function(){return __generator(this,(function(i){return [2,this._getList(e,r,t||200,n).then((function(e){var t=e,n=t.items,i=t.totalItems;return o=o.concat(n),n.length&&i>o.length?request(r+1):o}))]}))}))};return request(1)},BaseCrudService.prototype._getList=function(e,t,n,i){var o=this;return void 0===t&&(t=1),void 0===n&&(n=30),void 0===i&&(i={}),i=Object.assign({page:t,perPage:n},i),this.client.send(e,{method:"GET",params:i}).then((function(e){var t=[];if(null==e?void 0:e.items){e.items=e.items||[];for(var n=0,i=e.items;n<i.length;n++){var r=i[n];t.push(o.decode(r));}}return new l((null==e?void 0:e.page)||1,(null==e?void 0:e.perPage)||0,(null==e?void 0:e.totalItems)||0,(null==e?void 0:e.totalPages)||0,t)}))},BaseCrudService.prototype._getOne=function(e,t,n){var i=this;return void 0===n&&(n={}),this.client.send(e+"/"+encodeURIComponent(t),{method:"GET",params:n}).then((function(e){return i.decode(e)}))},BaseCrudService.prototype._getFirstListItem=function(e,n,i){return void 0===i&&(i={}),i=Object.assign({filter:n,$cancelKey:"one_by_filter_"+e+"_"+n},i),this._getList(e,1,1,i).then((function(e){var n;if(!(null===(n=null==e?void 0:e.items)||void 0===n?void 0:n.length))throw new t({status:404,data:{code:404,message:"The requested resource wasn't found.",data:{}}});return e.items[0]}))},BaseCrudService.prototype._create=function(e,t,n){var i=this;return void 0===t&&(t={}),void 0===n&&(n={}),this.client.send(e,{method:"POST",params:n,body:t}).then((function(e){return i.decode(e)}))},BaseCrudService.prototype._update=function(e,t,n,i){var o=this;return void 0===n&&(n={}),void 0===i&&(i={}),this.client.send(e+"/"+encodeURIComponent(t),{method:"PATCH",params:i,body:n}).then((function(e){return o.decode(e)}))},BaseCrudService.prototype._delete=function(e,t,n){return void 0===n&&(n={}),this.client.send(e+"/"+encodeURIComponent(t),{method:"DELETE",params:n}).then((function(){return !0}))},BaseCrudService}(c)),h=function(e){function AdminService(){return null!==e&&e.apply(this,arguments)||this}return __extends(AdminService,e),AdminService.prototype.decode=function(e){return new r(e)},Object.defineProperty(AdminService.prototype,"baseCrudPath",{get:function(){return "/api/admins"},enumerable:!1,configurable:!0}),AdminService.prototype.update=function(t,n,i){var o=this;return void 0===n&&(n={}),void 0===i&&(i={}),e.prototype.update.call(this,t,n,i).then((function(e){var t,n;return o.client.authStore.model&&void 0===(null===(t=o.client.authStore.model)||void 0===t?void 0:t.collectionId)&&(null===(n=o.client.authStore.model)||void 0===n?void 0:n.id)===(null==e?void 0:e.id)&&o.client.authStore.save(o.client.authStore.token,e),e}))},AdminService.prototype.delete=function(t,n){var i=this;return void 0===n&&(n={}),e.prototype.delete.call(this,t,n).then((function(e){var n,o;return e&&i.client.authStore.model&&void 0===(null===(n=i.client.authStore.model)||void 0===n?void 0:n.collectionId)&&(null===(o=i.client.authStore.model)||void 0===o?void 0:o.id)===t&&i.client.authStore.clear(),e}))},AdminService.prototype.authResponse=function(e){var t=this.decode((null==e?void 0:e.admin)||{});return (null==e?void 0:e.token)&&(null==e?void 0:e.admin)&&this.client.authStore.save(e.token,t),Object.assign({},e,{token:(null==e?void 0:e.token)||"",admin:t})},AdminService.prototype.authWithPassword=function(e,t,n,i){return void 0===n&&(n={}),void 0===i&&(i={}),n=Object.assign({identity:e,password:t},n),this.client.send(this.baseCrudPath+"/auth-with-password",{method:"POST",params:i,body:n}).then(this.authResponse.bind(this))},AdminService.prototype.authRefresh=function(e,t){return void 0===e&&(e={}),void 0===t&&(t={}),this.client.send(this.baseCrudPath+"/auth-refresh",{method:"POST",params:t,body:e}).then(this.authResponse.bind(this))},AdminService.prototype.requestPasswordReset=function(e,t,n){return void 0===t&&(t={}),void 0===n&&(n={}),t=Object.assign({email:e},t),this.client.send(this.baseCrudPath+"/request-password-reset",{method:"POST",params:n,body:t}).then((function(){return !0}))},AdminService.prototype.confirmPasswordReset=function(e,t,n,i,o){return void 0===i&&(i={}),void 0===o&&(o={}),i=Object.assign({token:e,password:t,passwordConfirm:n},i),this.client.send(this.baseCrudPath+"/confirm-password-reset",{method:"POST",params:o,body:i}).then((function(){return !0}))},AdminService}(d),p=function(e){function ExternalAuth(){return null!==e&&e.apply(this,arguments)||this}return __extends(ExternalAuth,e),ExternalAuth.prototype.load=function(t){e.prototype.load.call(this,t),this.recordId="string"==typeof t.recordId?t.recordId:"",this.collectionId="string"==typeof t.collectionId?t.collectionId:"",this.provider="string"==typeof t.provider?t.provider:"",this.providerId="string"==typeof t.providerId?t.providerId:"";},ExternalAuth}(i),v=function(e){function RecordService(t,n){var i=e.call(this,t)||this;return i.collectionIdOrName=n,i}return __extends(RecordService,e),RecordService.prototype.decode=function(e){return new o(e)},Object.defineProperty(RecordService.prototype,"baseCrudPath",{get:function(){return this.baseCollectionPath+"/records"},enumerable:!1,configurable:!0}),Object.defineProperty(RecordService.prototype,"baseCollectionPath",{get:function(){return "/api/collections/"+encodeURIComponent(this.collectionIdOrName)},enumerable:!1,configurable:!0}),RecordService.prototype.subscribeOne=function(e,t){return __awaiter(this,void 0,void 0,(function(){return __generator(this,(function(n){return console.warn("PocketBase: subscribeOne(recordId, callback) is deprecated. Please replace it with subscribe(recordId, callback)."),[2,this.client.realtime.subscribe(this.collectionIdOrName+"/"+e,t)]}))}))},RecordService.prototype.subscribe=function(e,t){return __awaiter(this,void 0,void 0,(function(){var n;return __generator(this,(function(i){if("function"==typeof e)return console.warn("PocketBase: subscribe(callback) is deprecated. Please replace it with subscribe('*', callback)."),[2,this.client.realtime.subscribe(this.collectionIdOrName,e)];if(!t)throw new Error("Missing subscription callback.");if(""===e)throw new Error("Missing topic.");return n=this.collectionIdOrName,"*"!==e&&(n+="/"+e),[2,this.client.realtime.subscribe(n,t)]}))}))},RecordService.prototype.unsubscribe=function(e){return __awaiter(this,void 0,void 0,(function(){return __generator(this,(function(t){return "*"===e?[2,this.client.realtime.unsubscribe(this.collectionIdOrName)]:e?[2,this.client.realtime.unsubscribe(this.collectionIdOrName+"/"+e)]:[2,this.client.realtime.unsubscribeByPrefix(this.collectionIdOrName)]}))}))},RecordService.prototype.getFullList=function(t,n){if("number"==typeof t)return e.prototype.getFullList.call(this,t,n);var i=Object.assign({},t,n);return e.prototype.getFullList.call(this,i)},RecordService.prototype.getList=function(t,n,i){return void 0===t&&(t=1),void 0===n&&(n=30),void 0===i&&(i={}),e.prototype.getList.call(this,t,n,i)},RecordService.prototype.getFirstListItem=function(t,n){return void 0===n&&(n={}),e.prototype.getFirstListItem.call(this,t,n)},RecordService.prototype.getOne=function(t,n){return void 0===n&&(n={}),e.prototype.getOne.call(this,t,n)},RecordService.prototype.create=function(t,n){return void 0===t&&(t={}),void 0===n&&(n={}),e.prototype.create.call(this,t,n)},RecordService.prototype.update=function(t,n,i){var o=this;return void 0===n&&(n={}),void 0===i&&(i={}),e.prototype.update.call(this,t,n,i).then((function(e){var t,n,i;return (null===(t=o.client.authStore.model)||void 0===t?void 0:t.id)!==(null==e?void 0:e.id)||(null===(n=o.client.authStore.model)||void 0===n?void 0:n.collectionId)!==o.collectionIdOrName&&(null===(i=o.client.authStore.model)||void 0===i?void 0:i.collectionName)!==o.collectionIdOrName||o.client.authStore.save(o.client.authStore.token,e),e}))},RecordService.prototype.delete=function(t,n){var i=this;return void 0===n&&(n={}),e.prototype.delete.call(this,t,n).then((function(e){var n,o,r;return !e||(null===(n=i.client.authStore.model)||void 0===n?void 0:n.id)!==t||(null===(o=i.client.authStore.model)||void 0===o?void 0:o.collectionId)!==i.collectionIdOrName&&(null===(r=i.client.authStore.model)||void 0===r?void 0:r.collectionName)!==i.collectionIdOrName||i.client.authStore.clear(),e}))},RecordService.prototype.authResponse=function(e){var t=this.decode((null==e?void 0:e.record)||{});return this.client.authStore.save(null==e?void 0:e.token,t),Object.assign({},e,{token:(null==e?void 0:e.token)||"",record:t})},RecordService.prototype.listAuthMethods=function(e){return void 0===e&&(e={}),this.client.send(this.baseCollectionPath+"/auth-methods",{method:"GET",params:e}).then((function(e){return Object.assign({},e,{usernamePassword:!!(null==e?void 0:e.usernamePassword),emailPassword:!!(null==e?void 0:e.emailPassword),authProviders:Array.isArray(null==e?void 0:e.authProviders)?null==e?void 0:e.authProviders:[]})}))},RecordService.prototype.authWithPassword=function(e,t,n,i){var o=this;return void 0===n&&(n={}),void 0===i&&(i={}),n=Object.assign({identity:e,password:t},n),this.client.send(this.baseCollectionPath+"/auth-with-password",{method:"POST",params:i,body:n}).then((function(e){return o.authResponse(e)}))},RecordService.prototype.authWithOAuth2=function(e,t,n,i,o,r,s){var a=this;return void 0===o&&(o={}),void 0===r&&(r={}),void 0===s&&(s={}),r=Object.assign({provider:e,code:t,codeVerifier:n,redirectUrl:i,createData:o},r),this.client.send(this.baseCollectionPath+"/auth-with-oauth2",{method:"POST",params:s,body:r}).then((function(e){return a.authResponse(e)}))},RecordService.prototype.authRefresh=function(e,t){var n=this;return void 0===e&&(e={}),void 0===t&&(t={}),this.client.send(this.baseCollectionPath+"/auth-refresh",{method:"POST",params:t,body:e}).then((function(e){return n.authResponse(e)}))},RecordService.prototype.requestPasswordReset=function(e,t,n){return void 0===t&&(t={}),void 0===n&&(n={}),t=Object.assign({email:e},t),this.client.send(this.baseCollectionPath+"/request-password-reset",{method:"POST",params:n,body:t}).then((function(){return !0}))},RecordService.prototype.confirmPasswordReset=function(e,t,n,i,o){return void 0===i&&(i={}),void 0===o&&(o={}),i=Object.assign({token:e,password:t,passwordConfirm:n},i),this.client.send(this.baseCollectionPath+"/confirm-password-reset",{method:"POST",params:o,body:i}).then((function(){return !0}))},RecordService.prototype.requestVerification=function(e,t,n){return void 0===t&&(t={}),void 0===n&&(n={}),t=Object.assign({email:e},t),this.client.send(this.baseCollectionPath+"/request-verification",{method:"POST",params:n,body:t}).then((function(){return !0}))},RecordService.prototype.confirmVerification=function(e,t,n){return void 0===t&&(t={}),void 0===n&&(n={}),t=Object.assign({token:e},t),this.client.send(this.baseCollectionPath+"/confirm-verification",{method:"POST",params:n,body:t}).then((function(){return !0}))},RecordService.prototype.requestEmailChange=function(e,t,n){return void 0===t&&(t={}),void 0===n&&(n={}),t=Object.assign({newEmail:e},t),this.client.send(this.baseCollectionPath+"/request-email-change",{method:"POST",params:n,body:t}).then((function(){return !0}))},RecordService.prototype.confirmEmailChange=function(e,t,n,i){return void 0===n&&(n={}),void 0===i&&(i={}),n=Object.assign({token:e,password:t},n),this.client.send(this.baseCollectionPath+"/confirm-email-change",{method:"POST",params:i,body:n}).then((function(){return !0}))},RecordService.prototype.listExternalAuths=function(e,t){return void 0===t&&(t={}),this.client.send(this.baseCrudPath+"/"+encodeURIComponent(e)+"/external-auths",{method:"GET",params:t}).then((function(e){var t=[];if(Array.isArray(e))for(var n=0,i=e;n<i.length;n++){var o=i[n];t.push(new p(o));}return t}))},RecordService.prototype.unlinkExternalAuth=function(e,t,n){return void 0===n&&(n={}),this.client.send(this.baseCrudPath+"/"+encodeURIComponent(e)+"/external-auths/"+encodeURIComponent(t),{method:"DELETE",params:n}).then((function(){return !0}))},RecordService}(d),f=function(){function SchemaField(e){void 0===e&&(e={}),this.load(e||{});}return SchemaField.prototype.load=function(e){this.id=void 0!==e.id?e.id:"",this.name=void 0!==e.name?e.name:"",this.type=void 0!==e.type?e.type:"text",this.system=!!e.system,this.required=!!e.required,this.unique=!!e.unique,this.options="object"==typeof e.options&&null!==e.options?e.options:{};},SchemaField}(),m=function(e){function Collection(){return null!==e&&e.apply(this,arguments)||this}return __extends(Collection,e),Collection.prototype.load=function(t){e.prototype.load.call(this,t),this.system=!!t.system,this.name="string"==typeof t.name?t.name:"",this.type="string"==typeof t.type?t.type:"base",this.options=void 0!==t.options?t.options:{},this.listRule="string"==typeof t.listRule?t.listRule:null,this.viewRule="string"==typeof t.viewRule?t.viewRule:null,this.createRule="string"==typeof t.createRule?t.createRule:null,this.updateRule="string"==typeof t.updateRule?t.updateRule:null,this.deleteRule="string"==typeof t.deleteRule?t.deleteRule:null,t.schema=Array.isArray(t.schema)?t.schema:[],this.schema=[];for(var n=0,i=t.schema;n<i.length;n++){var o=i[n];this.schema.push(new f(o));}},Object.defineProperty(Collection.prototype,"isBase",{get:function(){return "base"===this.type},enumerable:!1,configurable:!0}),Object.defineProperty(Collection.prototype,"isAuth",{get:function(){return "auth"===this.type},enumerable:!1,configurable:!0}),Object.defineProperty(Collection.prototype,"isView",{get:function(){return "view"===this.type},enumerable:!1,configurable:!0}),Collection}(i),b=function(e){function CollectionService(){return null!==e&&e.apply(this,arguments)||this}return __extends(CollectionService,e),CollectionService.prototype.decode=function(e){return new m(e)},Object.defineProperty(CollectionService.prototype,"baseCrudPath",{get:function(){return "/api/collections"},enumerable:!1,configurable:!0}),CollectionService.prototype.import=function(e,t,n){return void 0===t&&(t=!1),void 0===n&&(n={}),__awaiter(this,void 0,void 0,(function(){return __generator(this,(function(i){return [2,this.client.send(this.baseCrudPath+"/import",{method:"PUT",params:n,body:{collections:e,deleteMissing:t}}).then((function(){return !0}))]}))}))},CollectionService}(d),y=function(e){function LogRequest(){return null!==e&&e.apply(this,arguments)||this}return __extends(LogRequest,e),LogRequest.prototype.load=function(t){e.prototype.load.call(this,t),t.remoteIp=t.remoteIp||t.ip,this.url="string"==typeof t.url?t.url:"",this.method="string"==typeof t.method?t.method:"GET",this.status="number"==typeof t.status?t.status:200,this.auth="string"==typeof t.auth?t.auth:"guest",this.remoteIp="string"==typeof t.remoteIp?t.remoteIp:"",this.userIp="string"==typeof t.userIp?t.userIp:"",this.referer="string"==typeof t.referer?t.referer:"",this.userAgent="string"==typeof t.userAgent?t.userAgent:"",this.meta="object"==typeof t.meta&&null!==t.meta?t.meta:{};},LogRequest}(i),g=function(e){function LogService(){return null!==e&&e.apply(this,arguments)||this}return __extends(LogService,e),LogService.prototype.getRequestsList=function(e,t,n){return void 0===e&&(e=1),void 0===t&&(t=30),void 0===n&&(n={}),n=Object.assign({page:e,perPage:t},n),this.client.send("/api/logs/requests",{method:"GET",params:n}).then((function(e){var t=[];if(null==e?void 0:e.items){e.items=(null==e?void 0:e.items)||[];for(var n=0,i=e.items;n<i.length;n++){var o=i[n];t.push(new y(o));}}return new l((null==e?void 0:e.page)||1,(null==e?void 0:e.perPage)||0,(null==e?void 0:e.totalItems)||0,(null==e?void 0:e.totalPages)||0,t)}))},LogService.prototype.getRequest=function(e,t){return void 0===t&&(t={}),this.client.send("/api/logs/requests/"+encodeURIComponent(e),{method:"GET",params:t}).then((function(e){return new y(e)}))},LogService.prototype.getRequestsStats=function(e){return void 0===e&&(e={}),this.client.send("/api/logs/requests/stats",{method:"GET",params:e}).then((function(e){return e}))},LogService}(c),S=function(e){function RealtimeService(){var t=null!==e&&e.apply(this,arguments)||this;return t.clientId="",t.eventSource=null,t.subscriptions={},t.lastSentTopics=[],t.maxConnectTimeout=15e3,t.reconnectAttempts=0,t.maxReconnectAttempts=1/0,t.predefinedReconnectIntervals=[200,300,500,1e3,1200,1500,2e3],t.pendingConnects=[],t}return __extends(RealtimeService,e),Object.defineProperty(RealtimeService.prototype,"isConnected",{get:function(){return !!this.eventSource&&!!this.clientId&&!this.pendingConnects.length},enumerable:!1,configurable:!0}),RealtimeService.prototype.subscribe=function(e,t){var n;return __awaiter(this,void 0,void 0,(function(){var i,o=this;return __generator(this,(function(r){switch(r.label){case 0:if(!e)throw new Error("topic must be set.");return i=function(e){var n,i=e;try{n=JSON.parse(null==i?void 0:i.data);}catch(e){}t(n||{});},this.subscriptions[e]||(this.subscriptions[e]=[]),this.subscriptions[e].push(i),this.isConnected?[3,2]:[4,this.connect()];case 1:return r.sent(),[3,5];case 2:return 1!==this.subscriptions[e].length?[3,4]:[4,this.submitSubscriptions()];case 3:return r.sent(),[3,5];case 4:null===(n=this.eventSource)||void 0===n||n.addEventListener(e,i),r.label=5;case 5:return [2,function(){return __awaiter(o,void 0,void 0,(function(){return __generator(this,(function(t){return [2,this.unsubscribeByTopicAndListener(e,i)]}))}))}]}}))}))},RealtimeService.prototype.unsubscribe=function(e){var t;return __awaiter(this,void 0,void 0,(function(){var n,i,o;return __generator(this,(function(r){switch(r.label){case 0:if(!this.hasSubscriptionListeners(e))return [2];if(e){for(n=0,i=this.subscriptions[e];n<i.length;n++)o=i[n],null===(t=this.eventSource)||void 0===t||t.removeEventListener(e,o);delete this.subscriptions[e];}else this.subscriptions={};return this.hasSubscriptionListeners()?[3,1]:(this.disconnect(),[3,3]);case 1:return this.hasSubscriptionListeners(e)?[3,3]:[4,this.submitSubscriptions()];case 2:r.sent(),r.label=3;case 3:return [2]}}))}))},RealtimeService.prototype.unsubscribeByPrefix=function(e){var t;return __awaiter(this,void 0,void 0,(function(){var n,i,o,r,s;return __generator(this,(function(a){switch(a.label){case 0:for(i in n=!1,this.subscriptions)if(i.startsWith(e)){for(n=!0,o=0,r=this.subscriptions[i];o<r.length;o++)s=r[o],null===(t=this.eventSource)||void 0===t||t.removeEventListener(i,s);delete this.subscriptions[i];}return n?this.hasSubscriptionListeners()?[4,this.submitSubscriptions()]:[3,2]:[2];case 1:return a.sent(),[3,3];case 2:this.disconnect(),a.label=3;case 3:return [2]}}))}))},RealtimeService.prototype.unsubscribeByTopicAndListener=function(e,t){var n;return __awaiter(this,void 0,void 0,(function(){var i,o;return __generator(this,(function(r){switch(r.label){case 0:if(!Array.isArray(this.subscriptions[e])||!this.subscriptions[e].length)return [2];for(i=!1,o=this.subscriptions[e].length-1;o>=0;o--)this.subscriptions[e][o]===t&&(i=!0,delete this.subscriptions[e][o],this.subscriptions[e].splice(o,1),null===(n=this.eventSource)||void 0===n||n.removeEventListener(e,t));return i?(this.subscriptions[e].length||delete this.subscriptions[e],this.hasSubscriptionListeners()?[3,1]:(this.disconnect(),[3,3])):[2];case 1:return this.hasSubscriptionListeners(e)?[3,3]:[4,this.submitSubscriptions()];case 2:r.sent(),r.label=3;case 3:return [2]}}))}))},RealtimeService.prototype.hasSubscriptionListeners=function(e){var t,n;if(this.subscriptions=this.subscriptions||{},e)return !!(null===(t=this.subscriptions[e])||void 0===t?void 0:t.length);for(var i in this.subscriptions)if(null===(n=this.subscriptions[i])||void 0===n?void 0:n.length)return !0;return !1},RealtimeService.prototype.submitSubscriptions=function(){return __awaiter(this,void 0,void 0,(function(){return __generator(this,(function(e){return this.clientId?(this.addAllSubscriptionListeners(),this.lastSentTopics=this.getNonEmptySubscriptionTopics(),[2,this.client.send("/api/realtime",{method:"POST",body:{clientId:this.clientId,subscriptions:this.lastSentTopics},params:{$cancelKey:"realtime_"+this.clientId}}).catch((function(e){if(!(null==e?void 0:e.isAbort))throw e}))]):[2]}))}))},RealtimeService.prototype.getNonEmptySubscriptionTopics=function(){var e=[];for(var t in this.subscriptions)this.subscriptions[t].length&&e.push(t);return e},RealtimeService.prototype.addAllSubscriptionListeners=function(){if(this.eventSource)for(var e in this.removeAllSubscriptionListeners(),this.subscriptions)for(var t=0,n=this.subscriptions[e];t<n.length;t++){var i=n[t];this.eventSource.addEventListener(e,i);}},RealtimeService.prototype.removeAllSubscriptionListeners=function(){if(this.eventSource)for(var e in this.subscriptions)for(var t=0,n=this.subscriptions[e];t<n.length;t++){var i=n[t];this.eventSource.removeEventListener(e,i);}},RealtimeService.prototype.connect=function(){return __awaiter(this,void 0,void 0,(function(){var e=this;return __generator(this,(function(t){return this.reconnectAttempts>0?[2]:[2,new Promise((function(t,n){e.pendingConnects.push({resolve:t,reject:n}),e.pendingConnects.length>1||e.initConnect();}))]}))}))},RealtimeService.prototype.initConnect=function(){var e=this;this.disconnect(!0),clearTimeout(this.connectTimeoutId),this.connectTimeoutId=setTimeout((function(){e.connectErrorHandler(new Error("EventSource connect took too long."));}),this.maxConnectTimeout),this.eventSource=new EventSource(this.client.buildUrl("/api/realtime")),this.eventSource.onerror=function(t){e.connectErrorHandler(new Error("Failed to establish realtime connection."));},this.eventSource.addEventListener("PB_CONNECT",(function(t){var n=t;e.clientId=null==n?void 0:n.lastEventId,e.submitSubscriptions().then((function(){return __awaiter(e,void 0,void 0,(function(){var e;return __generator(this,(function(t){switch(t.label){case 0:e=3,t.label=1;case 1:return this.hasUnsentSubscriptions()&&e>0?(e--,[4,this.submitSubscriptions()]):[3,3];case 2:return t.sent(),[3,1];case 3:return [2]}}))}))})).then((function(){for(var t=0,n=e.pendingConnects;t<n.length;t++){n[t].resolve();}e.pendingConnects=[],e.reconnectAttempts=0,clearTimeout(e.reconnectTimeoutId),clearTimeout(e.connectTimeoutId);})).catch((function(t){e.clientId="",e.connectErrorHandler(t);}));}));},RealtimeService.prototype.hasUnsentSubscriptions=function(){var e=this.getNonEmptySubscriptionTopics();if(e.length!=this.lastSentTopics.length)return !0;for(var t=0,n=e;t<n.length;t++){var i=n[t];if(!this.lastSentTopics.includes(i))return !0}return !1},RealtimeService.prototype.connectErrorHandler=function(e){var n=this;if(clearTimeout(this.connectTimeoutId),clearTimeout(this.reconnectTimeoutId),!this.clientId&&!this.reconnectAttempts||this.reconnectAttempts>this.maxReconnectAttempts){for(var i=0,o=this.pendingConnects;i<o.length;i++){o[i].reject(new t(e));}this.disconnect();}else {this.disconnect(!0);var r=this.predefinedReconnectIntervals[this.reconnectAttempts]||this.predefinedReconnectIntervals[this.predefinedReconnectIntervals.length-1];this.reconnectAttempts++,this.reconnectTimeoutId=setTimeout((function(){n.initConnect();}),r);}},RealtimeService.prototype.disconnect=function(e){var n;if(void 0===e&&(e=!1),clearTimeout(this.connectTimeoutId),clearTimeout(this.reconnectTimeoutId),this.removeAllSubscriptionListeners(),null===(n=this.eventSource)||void 0===n||n.close(),this.eventSource=null,this.clientId="",!e){this.reconnectAttempts=0;for(var i=new t(new Error("Realtime disconnected.")),o=0,r=this.pendingConnects;o<r.length;o++){r[o].reject(i);}this.pendingConnects=[];}},RealtimeService}(c),w=function(e){function HealthService(){return null!==e&&e.apply(this,arguments)||this}return __extends(HealthService,e),HealthService.prototype.check=function(e){return void 0===e&&(e={}),this.client.send("/api/health",{method:"GET",params:e})},HealthService}(c),C=function(){function Client(e,t,n){void 0===e&&(e="/"),void 0===n&&(n="en-US"),this.cancelControllers={},this.recordServices={},this.enableAutoCancellation=!0,this.baseUrl=e,this.lang=n,this.authStore=t||new a,this.admins=new h(this),this.collections=new b(this),this.logs=new g(this),this.settings=new u(this),this.realtime=new S(this),this.health=new w(this);}return Client.prototype.collection=function(e){return this.recordServices[e]||(this.recordServices[e]=new v(this,e)),this.recordServices[e]},Client.prototype.autoCancellation=function(e){return this.enableAutoCancellation=!!e,this},Client.prototype.cancelRequest=function(e){return this.cancelControllers[e]&&(this.cancelControllers[e].abort(),delete this.cancelControllers[e]),this},Client.prototype.cancelAllRequests=function(){for(var e in this.cancelControllers)this.cancelControllers[e].abort();return this.cancelControllers={},this},Client.prototype.send=function(e,n){var i,o,r,s,a,c,u,l;return __awaiter(this,void 0,void 0,(function(){var d,h,p,v,f,m=this;return __generator(this,(function(b){return (d=Object.assign({method:"GET"},n)).body&&"FormData"!==d.body.constructor.name&&("string"!=typeof d.body&&(d.body=JSON.stringify(d.body)),void 0===(null===(i=null==d?void 0:d.headers)||void 0===i?void 0:i["Content-Type"])&&(d.headers=Object.assign({},d.headers,{"Content-Type":"application/json"}))),void 0===(null===(o=null==d?void 0:d.headers)||void 0===o?void 0:o["Accept-Language"])&&(d.headers=Object.assign({},d.headers,{"Accept-Language":this.lang})),(null===(r=this.authStore)||void 0===r?void 0:r.token)&&void 0===(null===(s=null==d?void 0:d.headers)||void 0===s?void 0:s.Authorization)&&(d.headers=Object.assign({},d.headers,{Authorization:this.authStore.token})),this.enableAutoCancellation&&!1!==(null===(a=d.params)||void 0===a?void 0:a.$autoCancel)&&(h=(null===(c=d.params)||void 0===c?void 0:c.$cancelKey)||(d.method||"GET")+e,this.cancelRequest(h),p=new AbortController,this.cancelControllers[h]=p,d.signal=p.signal),null===(u=d.params)||void 0===u||delete u.$autoCancel,null===(l=d.params)||void 0===l||delete l.$cancelKey,v=this.buildUrl(e),void 0!==d.params&&((f=this.serializeQueryParams(d.params))&&(v+=(v.includes("?")?"&":"?")+f),delete d.params),this.beforeSend&&(d=Object.assign({},this.beforeSend(v,d))),[2,fetch(v,d).then((function(e){return __awaiter(m,void 0,void 0,(function(){var n;return __generator(this,(function(i){switch(i.label){case 0:n={},i.label=1;case 1:return i.trys.push([1,3,,4]),[4,e.json()];case 2:return n=i.sent(),[3,4];case 3:return i.sent(),[3,4];case 4:if(this.afterSend&&(n=this.afterSend(e,n)),e.status>=400)throw new t({url:e.url,status:e.status,data:n});return [2,n]}}))}))})).catch((function(e){throw new t(e)}))]}))}))},Client.prototype.getFileUrl=function(e,t,n){void 0===n&&(n={});var i=[];i.push("api"),i.push("files"),i.push(encodeURIComponent(e.collectionId||e.collectionName)),i.push(encodeURIComponent(e.id)),i.push(encodeURIComponent(t));var o=this.buildUrl(i.join("/"));if(Object.keys(n).length){var r=new URLSearchParams(n);o+=(o.includes("?")?"&":"?")+r;}return o},Client.prototype.buildUrl=function(e){var t=this.baseUrl+(this.baseUrl.endsWith("/")?"":"/");return e&&(t+=e.startsWith("/")?e.substring(1):e),t},Client.prototype.serializeQueryParams=function(e){var t=[];for(var n in e)if(null!==e[n]){var i=e[n],o=encodeURIComponent(n);if(Array.isArray(i))for(var r=0,s=i;r<s.length;r++){var a=s[r];t.push(o+"="+encodeURIComponent(a));}else i instanceof Date?t.push(o+"="+encodeURIComponent(i.toISOString())):null!==typeof i&&"object"==typeof i?t.push(o+"="+encodeURIComponent(JSON.stringify(i))):t.push(o+"="+encodeURIComponent(i));}return t.join("&")},Client}();

    const pb = new C('https://chat.benlawrence.me/pb/'); 

    const user = writable(pb.authStore.model);

    pb.authStore.onChange((auth) => {
        user.set(pb.authStore.model);
    });

    /* src\components\Message.svelte generated by Svelte v3.55.1 */

    function create_if_block$2(ctx) {
    	let button;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			button = element("button");
    			button.textContent = "X";
    		},
    		m(target, anchor) {
    			insert(target, button, anchor);

    			if (!mounted) {
    				dispose = listen(button, "click", /*click_handler*/ ctx[3]);
    				mounted = true;
    			}
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(button);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function create_fragment$5(ctx) {
    	let t0_value = /*message*/ ctx[0].user.username + "";
    	let t0;
    	let t1;
    	let t2_value = /*message*/ ctx[0].content + "";
    	let t2;
    	let t3;
    	let if_block_anchor;
    	let if_block = /*message*/ ctx[0].user.id == /*$user*/ ctx[2]?.id && create_if_block$2(ctx);

    	return {
    		c() {
    			t0 = text(t0_value);
    			t1 = text(": ");
    			t2 = text(t2_value);
    			t3 = space();
    			if (if_block) if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			insert(target, t0, anchor);
    			insert(target, t1, anchor);
    			insert(target, t2, anchor);
    			insert(target, t3, anchor);
    			if (if_block) if_block.m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*message*/ 1 && t0_value !== (t0_value = /*message*/ ctx[0].user.username + "")) set_data(t0, t0_value);
    			if (dirty & /*message*/ 1 && t2_value !== (t2_value = /*message*/ ctx[0].content + "")) set_data(t2, t2_value);

    			if (/*message*/ ctx[0].user.id == /*$user*/ ctx[2]?.id) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block$2(ctx);
    					if_block.c();
    					if_block.m(if_block_anchor.parentNode, if_block_anchor);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(t0);
    			if (detaching) detach(t1);
    			if (detaching) detach(t2);
    			if (detaching) detach(t3);
    			if (if_block) if_block.d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance$6($$self, $$props, $$invalidate) {
    	let $user;
    	component_subscribe($$self, user, $$value => $$invalidate(2, $user = $$value));
    	let { message } = $$props;
    	let { id } = $$props;

    	const click_handler = () => {
    		pb.collection("messages").delete(id);
    	};

    	$$self.$$set = $$props => {
    		if ('message' in $$props) $$invalidate(0, message = $$props.message);
    		if ('id' in $$props) $$invalidate(1, id = $$props.id);
    	};

    	return [message, id, $user, click_handler];
    }

    class Message extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$6, create_fragment$5, safe_not_equal, { message: 0, id: 1 });
    	}
    }

    /* src\components\MessageBox.svelte generated by Svelte v3.55.1 */

    function create_fragment$4(ctx) {
    	let input;
    	let t0;
    	let button;
    	let t1_value = (!/*$user*/ ctx[1] ? "Login" : "Send") + "";
    	let t1;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			input = element("input");
    			t0 = space();
    			button = element("button");
    			t1 = text(t1_value);
    			attr(input, "placeholder", "Message Here");
    		},
    		m(target, anchor) {
    			insert(target, input, anchor);
    			set_input_value(input, /*content*/ ctx[0]);
    			insert(target, t0, anchor);
    			insert(target, button, anchor);
    			append(button, t1);

    			if (!mounted) {
    				dispose = [
    					listen(input, "input", /*input_input_handler*/ ctx[3]),
    					listen(button, "click", /*send*/ ctx[2])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*content*/ 1 && input.value !== /*content*/ ctx[0]) {
    				set_input_value(input, /*content*/ ctx[0]);
    			}

    			if (dirty & /*$user*/ 2 && t1_value !== (t1_value = (!/*$user*/ ctx[1] ? "Login" : "Send") + "")) set_data(t1, t1_value);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(input);
    			if (detaching) detach(t0);
    			if (detaching) detach(button);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let $user;
    	component_subscribe($$self, user, $$value => $$invalidate(1, $user = $$value));
    	let content = "";

    	onMount(() => {
    		//Check content storage incase we just logged in...
    		$$invalidate(0, content = localStorage.getItem("messageContent"));

    		localStorage.removeItem("messageContent");
    	});

    	const send = async () => {
    		if (!$user) {
    			//Do login with google
    			const methods = await pb.collection('users').listAuthMethods();

    			const id = 0; //The auth provider to use
    			console.log(methods.authProviders[id]);
    			localStorage.setItem("oauthTempInfo", JSON.stringify(methods.authProviders[id]));
    			localStorage.setItem("messageContent", content);
    			window.location.href = methods.authProviders[id].authUrl + "http://localhost.benlawrence.me/oauthcallback";
    			return;
    		}

    		//We are logged in!
    		pb.collection("messages").create({ user: $user.id, content });

    		$$invalidate(0, content = "");
    	};

    	function input_input_handler() {
    		content = this.value;
    		$$invalidate(0, content);
    	}

    	return [content, $user, send, input_input_handler];
    }

    class MessageBox extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$5, create_fragment$4, safe_not_equal, {});
    	}
    }

    /* src\components\AccountHeader.svelte generated by Svelte v3.55.1 */

    function create_fragment$3(ctx) {
    	let button0;
    	let t0;
    	let t1_value = /*$user*/ ctx[0].username + "";
    	let t1;
    	let t2;
    	let t3;
    	let button1;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			button0 = element("button");
    			t0 = text("Change username (");
    			t1 = text(t1_value);
    			t2 = text(")");
    			t3 = space();
    			button1 = element("button");
    			button1.textContent = "Logout";
    		},
    		m(target, anchor) {
    			insert(target, button0, anchor);
    			append(button0, t0);
    			append(button0, t1);
    			append(button0, t2);
    			insert(target, t3, anchor);
    			insert(target, button1, anchor);

    			if (!mounted) {
    				dispose = [
    					listen(button0, "click", /*changeUsername*/ ctx[1]),
    					listen(button1, "click", /*click_handler*/ ctx[2])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*$user*/ 1 && t1_value !== (t1_value = /*$user*/ ctx[0].username + "")) set_data(t1, t1_value);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(button0);
    			if (detaching) detach(t3);
    			if (detaching) detach(button1);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance$4($$self, $$props, $$invalidate) {
    	let $user;
    	component_subscribe($$self, user, $$value => $$invalidate(0, $user = $$value));

    	const changeUsername = async () => {
    		const newName = await window.prompt("New username", $user.username);
    		await pb.collection("users").update($user.id, { username: newName });
    	};

    	const click_handler = () => {
    		pb.authStore.clear();
    	};

    	return [$user, changeUsername, click_handler];
    }

    class AccountHeader extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$4, create_fragment$3, safe_not_equal, {});
    	}
    }

    /* src\components\ChatWindow.svelte generated by Svelte v3.55.1 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[4] = list[i][0];
    	child_ctx[5] = list[i][1];
    	return child_ctx;
    }

    // (69:4) {#if $user}
    function create_if_block$1(ctx) {
    	let accountheader;
    	let current;
    	accountheader = new AccountHeader({});

    	return {
    		c() {
    			create_component(accountheader.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(accountheader, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(accountheader.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(accountheader.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(accountheader, detaching);
    		}
    	};
    }

    // (73:4) {#each Object.entries(messages) as [id, message]}
    function create_each_block(ctx) {
    	let message;
    	let t;
    	let br;
    	let current;

    	message = new Message({
    			props: {
    				id: /*id*/ ctx[4],
    				message: /*message*/ ctx[5]
    			}
    		});

    	return {
    		c() {
    			create_component(message.$$.fragment);
    			t = space();
    			br = element("br");
    		},
    		m(target, anchor) {
    			mount_component(message, target, anchor);
    			insert(target, t, anchor);
    			insert(target, br, anchor);
    			current = true;
    		},
    		p(ctx, dirty) {
    			const message_changes = {};
    			if (dirty & /*messages*/ 1) message_changes.id = /*id*/ ctx[4];
    			if (dirty & /*messages*/ 1) message_changes.message = /*message*/ ctx[5];
    			message.$set(message_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(message.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(message.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(message, detaching);
    			if (detaching) detach(t);
    			if (detaching) detach(br);
    		}
    	};
    }

    function create_fragment$2(ctx) {
    	let div;
    	let t0;
    	let br0;
    	let t1;
    	let t2;
    	let br1;
    	let t3;
    	let messagebox;
    	let current;
    	let if_block = /*$user*/ ctx[1] && create_if_block$1();
    	let each_value = Object.entries(/*messages*/ ctx[0]);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	messagebox = new MessageBox({});

    	return {
    		c() {
    			div = element("div");
    			if (if_block) if_block.c();
    			t0 = space();
    			br0 = element("br");
    			t1 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t2 = space();
    			br1 = element("br");
    			t3 = space();
    			create_component(messagebox.$$.fragment);
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			if (if_block) if_block.m(div, null);
    			append(div, t0);
    			append(div, br0);
    			append(div, t1);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div, null);
    			}

    			append(div, t2);
    			append(div, br1);
    			append(div, t3);
    			mount_component(messagebox, div, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			if (/*$user*/ ctx[1]) {
    				if (if_block) {
    					if (dirty & /*$user*/ 2) {
    						transition_in(if_block, 1);
    					}
    				} else {
    					if_block = create_if_block$1();
    					if_block.c();
    					transition_in(if_block, 1);
    					if_block.m(div, t0);
    				}
    			} else if (if_block) {
    				group_outros();

    				transition_out(if_block, 1, 1, () => {
    					if_block = null;
    				});

    				check_outros();
    			}

    			if (dirty & /*Object, messages*/ 1) {
    				each_value = Object.entries(/*messages*/ ctx[0]);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(div, t2);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			transition_in(messagebox.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			transition_out(messagebox.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			destroy_each(each_blocks, detaching);
    			destroy_component(messagebox);
    		}
    	};
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let $user;
    	component_subscribe($$self, user, $$value => $$invalidate(1, $user = $$value));
    	let messages = {};

    	//Because with realtime data we cant expand the users field, we need to get that ourselves... Might as well cache it!
    	let cachedUserIDs = {};

    	const recordToMessage = async record => {
    		//Get the username
    		if (cachedUserIDs[record.user]) {
    			//Is cached
    			record.user = cachedUserIDs[record.user];
    		} else if (record.expand?.user) {
    			//Is old message, should have expand value..
    			cachedUserIDs[record.user] = record.expand.user;

    			record.user = cachedUserIDs[record.user];
    		} else {
    			//Didnt have an expand... Probably realtime data
    			const user = await pb.collection("users").getOne(record.user);

    			cachedUserIDs[record.user] = user;
    			record.user = cachedUserIDs[record.user];
    		}

    		return {
    			content: record.content,
    			user: record.user
    		};
    	};

    	onMount(async () => {
    		//grab previous messages (max of x)
    		const oldMessages = await pb.collection("messages").getFullList(50, { sort: "+created", expand: "user" });

    		oldMessages.forEach(async message => {
    			$$invalidate(0, messages[message.id] = await recordToMessage(message), messages);
    		});

    		await pb.collection("messages").subscribe("*", async e => {
    			switch (e.action) {
    				case "create":
    					$$invalidate(0, messages[e.record.id] = await recordToMessage(e.record), messages);
    					break;
    				case "delete":
    					$$invalidate(
    						0,
    						messages[e.record.id] = {
    							user: { username: "<redacted>" },
    							content: "<message deleted>"
    						},
    						messages
    					);
    					$$invalidate(0, messages);
    					break;
    			}
    		});
    	});

    	return [messages, $user];
    }

    class ChatWindow extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$3, create_fragment$2, safe_not_equal, {});
    	}
    }

    /* src\components\AuthCallback.svelte generated by Svelte v3.55.1 */

    function create_fragment$1(ctx) {
    	let t;

    	return {
    		c() {
    			t = text("Working...");
    		},
    		m(target, anchor) {
    			insert(target, t, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(t);
    		}
    	};
    }

    function instance$2($$self) {
    	onMount(async () => {
    		let oauthInfo = localStorage.getItem("oauthTempInfo");
    		oauthInfo = JSON.parse(oauthInfo);
    		const queryString = window.location.search;
    		const urlParams = new URLSearchParams(queryString);

    		if (oauthInfo.state !== urlParams.get('state')) {
    			throw "State parameters don't match.";
    		}

    		console.log(oauthInfo);
    		await pb.collection('users').authWithOAuth2(oauthInfo.name, urlParams.get("code"), oauthInfo.codeVerifier, 'http://localhost.benlawrence.me/oauthcallback');
    		window.location.href = "/";
    	});

    	return [];
    }

    class AuthCallback extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$1, safe_not_equal, {});
    	}
    }

    /* src\components\Logout.svelte generated by Svelte v3.55.1 */

    function instance$1($$self) {
    	onMount(() => {
    		pb.authStore.clear();
    		window.location.href = "/";
    	});

    	return [];
    }

    class Logout extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, null, safe_not_equal, {});
    	}
    }

    /* src\App.svelte generated by Svelte v3.55.1 */

    function create_else_block(ctx) {
    	let chatwindow;
    	let current;
    	chatwindow = new ChatWindow({});

    	return {
    		c() {
    			create_component(chatwindow.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(chatwindow, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(chatwindow.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(chatwindow.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(chatwindow, detaching);
    		}
    	};
    }

    // (10:45) 
    function create_if_block_1(ctx) {
    	let authcallback;
    	let current;
    	authcallback = new AuthCallback({});

    	return {
    		c() {
    			create_component(authcallback.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(authcallback, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(authcallback.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(authcallback.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(authcallback, detaching);
    		}
    	};
    }

    // (8:0) {#if $path.startsWith("/logout")}
    function create_if_block(ctx) {
    	let logout;
    	let current;
    	logout = new Logout({});

    	return {
    		c() {
    			create_component(logout.$$.fragment);
    		},
    		m(target, anchor) {
    			mount_component(logout, target, anchor);
    			current = true;
    		},
    		i(local) {
    			if (current) return;
    			transition_in(logout.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(logout.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			destroy_component(logout, detaching);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let show_if;
    	let show_if_1;
    	let current_block_type_index;
    	let if_block;
    	let if_block_anchor;
    	let current;
    	const if_block_creators = [create_if_block, create_if_block_1, create_else_block];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (dirty & /*$path*/ 1) show_if = null;
    		if (dirty & /*$path*/ 1) show_if_1 = null;
    		if (show_if == null) show_if = !!/*$path*/ ctx[0].startsWith("/logout");
    		if (show_if) return 0;
    		if (show_if_1 == null) show_if_1 = !!/*$path*/ ctx[0].startsWith("/oauthcallback");
    		if (show_if_1) return 1;
    		return 2;
    	}

    	current_block_type_index = select_block_type(ctx, -1);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	return {
    		c() {
    			if_block.c();
    			if_block_anchor = empty();
    		},
    		m(target, anchor) {
    			if_blocks[current_block_type_index].m(target, anchor);
    			insert(target, if_block_anchor, anchor);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx, dirty);

    			if (current_block_type_index !== previous_block_index) {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				}

    				transition_in(if_block, 1);
    				if_block.m(if_block_anchor.parentNode, if_block_anchor);
    			}
    		},
    		i(local) {
    			if (current) return;
    			transition_in(if_block);
    			current = true;
    		},
    		o(local) {
    			transition_out(if_block);
    			current = false;
    		},
    		d(detaching) {
    			if_blocks[current_block_type_index].d(detaching);
    			if (detaching) detach(if_block_anchor);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let $path;
    	component_subscribe($$self, path, $$value => $$invalidate(0, $path = $$value));
    	return [$path];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    const app = new App({
        target: document.body
    });

    return app;

})();
