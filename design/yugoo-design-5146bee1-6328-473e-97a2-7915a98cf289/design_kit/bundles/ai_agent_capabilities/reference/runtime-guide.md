# Runtime candidates — design aid, not an installer

Checked against primary project documentation, 2026-10-09. Candidates describe
different abstraction levels, not an interchangeable feature/compatibility promise.
Consult this reference only when the user requests implementation comparison.
The product Panel does not require or present an SDK/harness selector.
Record meaningful technical decisions in optional notes; existing saved runtime
choices remain readable, not automatically converted or discarded.
Choosing an implementation does not configure this coding host, install libraries
or authorize a model call. Compare the exact intended version, deployment and authentication.

| Candidate | Useful fit / supplied layer | App responsibilities and important limits |
| --- | --- | --- |
| Pi Agent Core | Lightweight stateful Agent loop, tools and streaming; customize the harness around it | Plan persistence, permissions, resource loading and MCP adaptation explicitly; a loop alone is not a durable app/platform. |
| Claude Agent SDK | Claude Code-based Agent runtime with tools, hooks, subagents, sessions and MCP integration | Not the regular Claude API SDK; process/deployment/auth/model-access requirements and applicable commercial terms need review. A custom URL is not proof of arbitrary model support. |
| Codex App Server | Codex threads/turns, bidirectional events, tools and approval integration | Build the product integration and permissions; verify supported transport, authentication and deployment. Experimental transports are not automatically production-supported. |
| Self-built Harness (possible framework: LangGraph) | Design the loop/workflow yourself; LangGraph can provide state, persistence and durable execution | The app supplies its instructions, context/resource management and policy. The precise framework is a technical choice recorded in notes. Deep Agents is related guidance, not a requirement to use both. |

An existing runtime owns its built-in context management. The product form does
not ask users to recreate those mechanisms; it keeps the required task inputs and
permission boundaries visible. Reference knowledge and cross-conversation
long-term memory are optional product requirements for every runtime: describe
the material that may be consulted, what may persist, and access/update/deletion
expectations. These are not context-window, compaction or retrieval-implementation
controls. A self-built Harness may record meaningful technical choices in notes.
Changing the choice never clears saved content.

Skill and MCP support must be checked in the chosen version and configuration,
not inferred from the brand. Record built-in, application-provided and unknown
capabilities in the Agent's optional notes, retaining exact source metadata. No runtime is implicitly selected
because it is present in this guide. No license assertion here replaces a review
of the actual distributed dependencies and deployment terms.

Primary references:
- [Pi Agent Core](https://github.com/badlogic/pi-mono/blob/main/packages/agent/README.md)
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [LangGraph](https://docs.langchain.com/oss/python/langgraph/overview)
- [Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview)
- [Agent Skills format](https://agentskills.io/specification)
- [MCP server concepts](https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts)

Historical `model_access` values remain readable. Reuse (`inherit`) means
using the selected runtime's existing model settings and authorization; no
repeated target or connection fields are needed. Where the target cannot be
inferred, identify the intended service in optional notes. Product configuration
(`configure`) means the deployer or end user supplies model settings through the
product at use/deployment time. An absent choice remains undecided; neither a
runtime selection nor a reuse choice proves authorization or connectivity.

For new product designs, use optional `model_connection`: configure at product
use time (`runtime`), integrate an existing service (`existing`, with an optional
manual `model_service` plan or real `integration_ref`), or a free-text arrangement
(`other`, explained in `model_service`), not the historical runtime/access selectors.
Real keys are supplied at product use time, never in Design Files. A manual
template uses placeholders such as `${MODEL_API_KEY}`; it is not executed here.
When referencing an integration, keep its configuration there rather than copying
it. Hidden fields are retained but inactive under the selected approach.
The designer's local
coding-host authorization is not evidence of a deployed product user's access.
Keep meaningful model/source preferences and data boundaries in model-service
intent or notes. Official, third-party and self-hosted access remain
possible intentions, not mandatory configuration categories. Actual URL,
protocol, credential and precise model settings belong to runtime setup. A
self-hosted service may forward elsewhere; unknown data boundaries stay unknown.
Do not probe endpoints, copy credentials or reconfigure the coding host to
populate a product design.
