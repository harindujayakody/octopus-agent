# Writing an automation module

A module adds blocks to the automation library. It is a `.wasm` file the
launcher loads from its modules directory, and its blocks sit in the picker
next to the built-in ones.

## What a module is

A module **drives**. It runs on its own thread and asks for one action at a
time; the runner performs it and hands back the result, so the module can read
what is on the page, count what it found, notice that an API answered 429, and
decide what to do next. Everything in this example needs that.

There is an older contract, and it still works: a module that exports `run`
instead of `step` is handed the step's parameters and answers with a finished
list of actions, learning nothing about what any of them did. The launcher will
keep running those for ever — but there is no reason to write one, so this
example does not show you how.

What the newer contract did **not** change: the module still touches nothing
itself. Every action
it asks for is turned into an ordinary block and performed by the runner
through the browser's human-input engine, exactly as if the operator had placed
it by hand. A module cannot execute script in a page, cannot reach the machine,
and its clicks are human clicks like every other click the launcher makes. A
module you downloaded from a stranger lives inside the same guarantee as the
rest of the launcher.

## The contract

Exports — the module provides these:

| Export | Signature | What it does |
| --- | --- | --- |
| `alloc` | `(len: i32) -> i32` | gives the host somewhere to write |
| `dealloc` | `(ptr: i32, len: i32)` | takes it back |
| `blocks` | `() -> i64` | JSON array of block descriptors |
| `step` | `(ptr: i32, len: i32) -> i64` | runs one placed block, start to finish |
| `manifest` | `() -> i64` | optional: what it needs permission to call |

Exporting `step` is what puts a module on this path. Export `run` instead and
the launcher uses the older one.

Imports — the host provides these, in module `shardx`:

| Import | Signature | What it does |
| --- | --- | --- |
| `log` | `(ptr, len)` | one line into the run log |
| `do_action` | `(ptr, len) -> i64` | perform one action, answer with the result |
| `get_var` | `(ptr, len) -> i64` | read one of the run's variables |
| `set_var` | `(kptr, klen, vptr, vlen) -> i32` | write one |
| `now_ms` | `() -> i64` | wall clock |
| `random` | `(ptr, len) -> i32` | the host's randomness, into your buffer |
| `sleep_ms` | `(ms: i64)` | wait, without burning fuel |
| `should_stop` | `() -> i32` | 1 once the operator has stopped the run |
| `state_get` | `(ptr, len) -> i64` | what this module remembered, from any earlier run |
| `state_set` | `(kptr, klen, vptr, vlen) -> i32` | remember something; an empty value forgets it |

Every string crosses the boundary as `(ptr << 32) | len` in one i64 — one
return value, because multi-value returns are not universal. A string the host
returns was allocated with **your** `alloc`, so you free it; `sdk.rs` does that
for you.

Import only what you use: a module that imports none of them still runs.

### `do_action`

You send `{ "kind": "...", ...params }` — `kind` is any block the runner knows,
and the rest is that block's parameters exactly as the picker spells them. So
the entire existing palette is your API without a single new concept: `goto`,
`click`, `readText`, `count`, `if.exists`, `waitFor`, `http.request`,
`db.query`, `touch.swipe`, `screenshot`.

You get back:

```json
{ "ok": true, "flow": "next", "error": "", "vars": { "...": "..." } }
```

- `ok` — it ran. `false` means it failed and `error` says why.
- `flow` — `"else"` when a conditional block took its other branch. `if.exists`
  on a missing element is `ok: true, flow: "else"`, not an error: that is an
  answer, and the module is supposed to act on it.
- `vars` — every variable of the run after the action. A block that writes into
  a variable (`readText`, `count`, `http.request`) shows up here, which is how
  you read a page: ask for `readText` with `"into": "_shx_tmp"` and take
  `_shx_tmp` out of the reply.

Variables are shared with the rest of the project: what you set with `set_var`
is visible to the blocks after yours, and `{{name}}` in any parameter you send
is expanded by the runner before the action runs. Use a prefixed scratch name
(`_shx_tmp` here) so a module cannot quietly overwrite something the operator
keeps.

## Calling other people's work

A module can run **another module's block** and **one of the operator's own saved
projects**, and both go through the same door:

```rust
let done = call_module("csv-tools", "parse", json!({ "text": rows, "into": "out" }));
let done = call_flow("Log in", "", &[("user", "kit"), ("pass", pw)], &["session"]);
```

A called flow behaves like a function when you name what goes in and out: it
sees only what it was handed, and only the names in `take` come back. Name
neither and it shares every variable of the run, which is what an inlined
section of the same project should do.

### Permission

**A module may call nothing until the operator says so** — including a module
that asks for nothing, which is every module written before this existed. Export
`manifest` to ask:

```rust
#[no_mangle]
pub extern "C" fn manifest() -> i64 {
    pack(json!({
        "reason": "the login is the operator's own flow",
        "flows": ["Log in"],
        "modules": ["csv-tools"]
    }).to_string())
}
```

Flows are asked for **by name**, because a module is written before it has met
anyone's projects; the launcher resolves the name and refuses an ambiguous one
rather than guessing. What the operator ticks is stored against the **digest of
the .wasm**, so replacing the file under the same name inherits nothing.

### Variables

A run's variables are the **operator's**: they hold accounts, tokens, whatever a
file block put there. A module sees what it declared and what it wrote or named
itself, and nothing else.

```rust
"vars": ["account", "order_*"]   // a trailing * is a prefix
```

Declare nothing and you still see your own: `readText` with `into: "_shx_tmp"`
makes `_shx_tmp` — and `_shx_tmp_*`, since one request can write several — yours
to read back, because a module that could not see the result of the action it
just asked for would be useless. Everything else has to be named, and what you
name is shown in the Modules list beside your module, where the operator reads
it before deciding anything.

A variable you may not see reads as empty, the same as one that was never set.
That is deliberate: a module asking for something it does not have is not an
error, and the difference is not the module's business.

Asking is not being granted. Until the operator ticks a line in Modules, the
call comes back as an ordinary failed action whose error names what was missing,
and your module can decide what to do about it.

### What bounds it

- **Four frames.** A → B → flow → C is fine; one more is refused.
- **A loop is refused as a loop**, naming the chain, rather than as "too deep" —
  a module that calls itself would otherwise always get the wrong message.
- **5000 actions per chain, shared.** The same number one module has always had;
  sharing it downward is what stops nesting multiplying it.
- A flow that fails hands the failure to the caller's own "when it fails" edge.
  A flow that ends with Stop after a step that worked has simply finished.

## The blocks in this example

Each one is here because it cannot be built out of the blocks in the picker.

| Block | What it does | Why it has to drive |
| --- | --- | --- |
| **Harvest a paginated list** | reads every row on every page, following the next-page link | after clicking "next" it waits for the first row's text to actually change, so it never reads the same page twice — a fixed sleep is wrong in both directions |
| **Walk an API** | requests page after page through the profile's own proxy | it reads the status code: 429 and 5xx back off and retry with spread, a short page ends the walk |
| **Submit and recover** | presses submit, reads the complaint, retries | it decides from the error text — a rate limit is worth waiting out, a wrong password is not — and it waits on success and failure at once, so a failure does not cost the full timeout |
| **Whichever appears first** | waits on several selectors together | the dialog, the captcha and the error banner arrive at the same place and only one will; built-in blocks need a branch each |
| **Scroll a feed to the end** | swipes until the feed stops growing | the end of an endless feed has no marker: the only sign is that the count stopped moving after a swipe |
| **Sign in, harvest, parse** | calls the operator's login flow, reads the page, hands the rows to another module | most of the work is somebody else's and stays theirs — the login keeps working when the site changes it, without this module being rebuilt |

The feed block is also how to handle a phone profile without asking what it is
standing on: it swipes, and if the runner refuses because the profile has no
touchscreen, that refusal is the answer and the same movement goes out through
the wheel instead. Nothing is wasted probing — the first swipe was one it
wanted anyway.

## Layout

A real module is large. `lib.rs` stays a manifest and a switch; the blocks live
in files of their own.

```
src/sdk.rs      the ABI, wrapped — copy this file as it is
src/lib.rs      blocks() manifest + step() dispatcher
src/scrape.rs   harvest, api_pages
src/forms.rs    submit, race
src/mobile.rs   feed
src/compose.rs  compose — calls a flow and another module
```

`blocks()` also decides where each block appears: `"group"` naming a built-in
group by id or label (`data`, `flow`, `Touch`, `Requests`…) drops it in there,
any other name starts a new group with that title, and leaving it out puts it
in the module's own group.

## Building

```bash
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
```

Install `target/wasm32-unknown-unknown/release/octopus_agent_module_example.wasm` from the
block library, or drop it in the modules directory yourself:

- macOS — `~/Library/Application Support/octopus-agent/automation-modules/`
- Windows — `%APPDATA%\shardx-launcher\automation-modules\`
- Linux — `~/.config/octopus-agent/automation-modules/`

The file's name is the module id, and its blocks are addressed as
`module:<id>:<block>`. A module that does not load is refused at install time
rather than at run time, so a broken one cannot break the library.

Compiled modules are cached by path and mtime, so replacing the `.wasm` takes
effect on the next step — no restart while you are writing one.

**Every step gets a fresh instance**, deliberately. Compiling is what costs
(≈40 ms, and it is cached); instantiating the compiled module is ≈19 µs, against
a step that talks to a browser in tens of milliseconds. Keeping an instance
alive between steps would save nothing worth having and would let a module's
globals survive a change of profile inside one worker — which is the one thing
this browser exists to prevent. If something must carry forward, `remember` it:
that way it is deliberate, bounded, and per module rather than per accident.

## Testing it without a browser

`harness/` runs a module against a stand-in host: the same import names and
signatures the launcher uses, the same packing, and a clock that only moves
when the module waits — so a poll loop with a thirty-second deadline finishes
instantly. `do_action` is answered by a small script instead of a real page, so
you can say "the third `if.exists` finds it" or "this request answers 429" and
check what the module does about it.

```bash
cargo build --release --target wasm32-unknown-unknown
cargo build --release --manifest-path harness/Cargo.toml
./harness/target/release/module-harness \
  target/wasm32-unknown-unknown/release/octopus_agent_module_example.wasm
```

It checks this example — that `blocks()` fills in every field the picker reads,
that harvest reads the second page and not the first one twice, that the API
walk retries a 429, that submit does not retry a wrong password, and that the
feed falls back to the wheel when the profile has no touchscreen. Copy it and
rewrite the scripts for your own blocks.

## What a module may not do, whatever it asks for

Separate from permissions, and not negotiable: a handful of blocks are
general-purpose escapes, so allowing them by name would describe what they are
called rather than what they reach. When a step is a module's — including a step
inside a flow the module called, because it chose the flow and what went into it
— these are refused:

| Refused | Why |
| --- | --- |
| `goto` to anything but http/https (and about:blank) | `file:///…` plus `readText` is a disk read; `data:text/html,<script>` is code in the page |
| `file.readLine` / `file.append` / a `screenshot` path outside the module's own folder | reading a line REMOVES it, and any absolute path reaches the launcher's own settings |
| `script.run` | a module never runs code in the page — that is the guarantee the whole subsystem is built on |
| `traffic.editResponse`, `traffic.fulfill` | the response body is executed by the next navigation; blocking, redirecting and headers are still available |
| `db.open` with anything but a local SQLite file inside that folder | a Postgres or MySQL connection string is an outbound connection nobody saw |
| `http.request` with `via` other than the profile | a request leaving on the host address beside a browser that did not is two visitors |

Your module gets a folder of its own next to the `.wasm` for anything it needs
to keep. If it should read the operator's file, the operator passes the value in
as a step field — then they can see what they gave it.

Refusing `script.run` is not enough on its own, so **where a value came from
travels with it**: a variable a module wrote cannot be interpolated into
`script.run` or a traffic body, even by a block the operator wrote themselves.
Everywhere else it is an ordinary variable.

The operator may still do all of it. They can see the block they placed.

## What a module remembers

Variables live for a run. `recall` and `remember` are the other thing: a cursor
into a list, a counter, when something last happened — facts about the **module**
that outlive the project that called it.

```rust
let from = recall("cursor").parse().unwrap_or(1);
remember("cursor", &page.to_string());
```

Per module, not per project or per profile, and kept in the module's own folder.
A project cannot reach it by spelling a variable name. Bounded at 2000 keys and
a megabyte; past either, the write is refused and logged rather than dropped in
silence. A state file that will not parse is kept aside as `.corrupt.json` and
the module starts empty — the one thing that must never happen to remembered
state is being quietly replaced with nothing.

## Limits

- Fuel: a module that loops forever is stopped. `sleep_ms` does not burn it —
  waiting for a page is the right thing to do and is not charged. The default is
  200 million units (roughly one per instruction); `"fuel"` in the manifest asks
  for more, up to 2 billion.
- Memory: 256 MB by default, `"memory_mb"` up to 1024, and no single string over
  8 MB either way. Both are **clamped, not refused**: a module that asks for too
  much gets the ceiling, because failing to run over a number the author guessed
  is the worse outcome.
- 5000 actions per step. A module that wants more is a bug, and letting it run
  is indistinguishable from an attack.
- 500 log lines per call.
- `sleep_ms` is clamped to 60 s per call.
- A module may call another module or a saved flow, four frames deep, and only
  what the operator granted it.
- `should_stop()` goes to 1 when the operator stops the run. Check it in every
  loop and leave; a module that does not is killed by the fuel ceiling, which
  is a worse way to end.
