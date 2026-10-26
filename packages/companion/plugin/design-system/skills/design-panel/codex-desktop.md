# Open Design in the current Mac Codex desktop conversation

Resolve the installed plugin root from this skill's path. Use the same selected
Design Project, shared Core save path and conversation. Keep the native cwd
separate from the Design Project directory.

Read the exact current `CODEX_THREAD_ID` and native cwd from the executing host.
The current host supplies `CODEX_APP_TOOLS_PIPE_PATH`; do not print it, discover
other sockets or choose a recent conversation. Use the user's existing ordinary
Node >=22.19.0 for Companion. Select the current desktop application's own bundled
Node separately for its host bridge, using its observed installed location.
The workspace dependency Node and ordinary system Node are not substitutes for
that host-owned runtime. If its location or native admission cannot be verified,
report the missing capability rather than copying, re-signing or guessing it.

Start the shared service through the current host's long-running command tool:

```sh
node /absolute/installed-plugin/scripts/design.mjs serve \
  --host codex --codex-desktop --browser-access local \
  --project /absolute/selected-project --thread EXACT_CURRENT_UUID \
  --host-cwd /absolute/native-cwd
```

Desktop mode requires explicit local browser access. Do not select token browser
access, a CLI remote or managed background reviews. For isolated development,
add a dedicated `--state-root` and `--disable-embedding`; ordinary design should
retain its existing Knowledge configuration. An exact verified transcript may
be passed explicitly; otherwise the service resolves it by the exact thread.

Use the returned `desktopBridge.entry`, `args` and `cwd` to launch a second
owned process directly through the same host command tool with the selected
desktop bundled Node. Companion or an MCP process must not spawn it. A direct
command has this shape:

```sh
/absolute/selected-desktop-bundled-node \
  /absolute/installed-plugin/scripts/codex-desktop-bridge.mjs \
  --connection /exact/returned/private-connection.json
```

Keep both native command handles. The bridge checks the private connection's
owner, mode, thread and cwd, then the exact current native endpoint. Its ready
receipt is required before relying on notifications. It uses the existing
authenticated connection and a fresh admission generation; no new connection
secret, generic host proxy or target-thread selection is exposed to the browser.
Do not read, print or paste the private connection contents.

When the current desktop Host exposes its actual native `collaboration.spawn_agent`
tool, add `--codex-desktop-native-bundles` to the same `serve` invocation. This
selects the attached native Bundle adapter, not another model or user setting.
It requires the exact main transcript and native cwd. If this native facility
is absent, omit the option and report unsupported isolated placement; never
replace a required Producer with main execution. Existing services are not
silently upgraded by a changed Skill or a source build.

For an admitted native Bundle, follow [native execution](native-execution.md).
Give the actual fresh child the exact Bundle ID and connection path; it must
first call `design_prepare_bundle` itself and consume the complete pinned method.
It then notifies its native parent without polling. The parent registers that
same actual launch with the declared role/target. Registration checks the exact
service, Bundle and Kit version from the child's successful native read; a task
name, old child or parent-supplied echo cannot replace this evidence. After
registration, the child reads `design_status` to consume its own registered
execution target before editing. If it yielded for registration, resume that
same child once; do not spawn a duplicate.

A nested Worker must use its real registered Producer parent; a direct main
Worker also carries the exact main Bundle invocation. Read the shared Worker
method and keep its one artifact path distinct from canonical JSON. The native
terminal event, file receipt and Producer/main publication remain separate.

Pass the returned `openPanel` object to the native `open_in_codex` tool. It opens
the shared Panel at the real local URL with `?view=panel-only`, placement `right`,
in this conversation. Do not create a replacement chat or use an HTML mock.
Browser loading does not send a notification or establish native readiness.

Panel Save persists the validated files and Core Git checkpoint first. Native
notification separately submits the authoritative saved diff to this exact
conversation. `accepted` / `submitted_unverified` means host acceptance only;
record actual Agent consumption independently. Reuse a received saved diff;
never apply it again or manufacture another save. If a claimed delivery loses
its receipt, keep it unknown and do not resend automatically. A saved file stays
durable even if the bridge is unavailable.

Use `design_status` with the exact returned connection path to check capabilities.
The default desktop route supports main execution and explicitly chosen foreground
checks. The explicit native-bundles route additionally admits exact native
Producer/Worker bindings; actual execution and publication must still be observed.
Studio trials remain unavailable.
GRA may use cooperative native background reviewers only after the current
connection's backgroundReviewProtocol and readiness prove an actual native child
and independent main work. Follow its bounded bootstrap only when offered; a
returned task name, tool availability or accepted spawn is insufficient. Bind
each prepared review to its own fresh native child with the unchanged review
prompt. Never reuse the readiness probe as a Reviewer. A Bundle requiring an isolated
Producer must not silently run in main. Keep existing review policy unchanged
unless the user chooses a permitted alternative; never substitute a synchronous
review automatically.

Desktop multi-agent v2 can keep the native assignment text opaque. The fresh
Reviewer must first read its exact request through `design_read_review`; a
successful native tool receipt for this service and review ID proves consumption.
Let it read while unbound. If it yields before binding, bind that same child once
the read is recorded, then resume it to read the binding and submit its own result.
Do not repeatedly bind before evidence exists or replace it with a child echo.

To close, stop only the two processes owned by this opening. After a normal
user-controlled app restart, return to the same conversation, verify the loaded
plugin and start fresh bound processes; do not reuse an old endpoint/connection
or claim automatic restoration. Plugin loading, durable save, host acceptance,
active Agent consumption, idle wake and user acceptance are separate checks.
