# Changelog

[简体中文](CHANGELOG.md) · English

This log summarizes major features, noticeable experience changes, and installation or upgrade improvements in the Yugoo Design repository, organized by version. It omits small adjustments and internal refactoring. See the [Git commit history](https://github.com/alibaba-damo-academy/yugoo-design/commits/main/) for the full changes.

## 0.3.0

This round focuses on consistent Design Panels, suggestions that are easier to act on, and clearer Web App Kit design and research.

- **Consistent Panel reading and editing.** Unify page headings, gray sections, white record cards, identifiers and inline editing. Make questions more compact, improve editing within permission tables, and standardize required markers and field help. Expose direct language and light/dark theme switches in DSH and Companion, connected to host preferences.
- **Better research and flow design.** AI can refine research directions into editable questions and scope. Retain search records for the questions, align direction and final-report reading widths, and strengthen guidance for visual reports. Organize process nodes as child records of a flow, with access to node details from the diagram.
- **Clearer design suggestions.** Automatic review (GRA) uses concise, actionable advice to explain the proposed change and its evidence. Clarify the three review scopes—Current design, Related designs and Entire project—and shorten review output and repeated context while retaining Accept, Reject and Later decisions.
- **More readable relationships and clarity signals.** Reduce visual clutter in the knowledge graph (KAG), simplify tools and filters, and improve access to nodes, relationships and original evidence. Keep the Ideation index's individual U/S/T progress bars and explanations while removing the combined score.
- **Better generation and recovery feedback.** Correct subagent log placement and remove logs after completion, temporarily hide the previous PRD while it is being updated, and improve Studio error, cancellation and retry feedback, alongside bilingual empty states when no Kit is selected.

Existing projects retain their complete Kit and Bundle definitions; updating the plugin does not replace them automatically. To adopt structures such as the revised flow nodes, update the relevant Bundle as needed and have the Agent supplement the design while preserving existing results.

## [0.2.11](https://github.com/alibaba-damo-academy/yugoo-design/tree/v0.2.11)

Simpler installation preparation and less repeated AI context.

- Ship prebuilt local CPU runtime dependencies, reducing source builds, extra CUDA downloads and manual build configuration. Support normal pnpm dependency links.
- Reduce repeated context and add review depth and frequency controls. Save GRA settings directly without starting an extra main-conversation turn just to save them.

This entry brings together the consecutive improvements from 0.2.9–0.2.11.

## [0.2.8](https://github.com/alibaba-damo-academy/yugoo-design/tree/v0.2.8)

Better Panels, relationship browsing and host installation.

- Improve shared headings, forms, groups and action feedback, English/Chinese labels and host-theme support. Simplify relationship browsing, filters and evidence details.
- Improve installation and path handling for QwenWork, WorkBuddy and DSH, plus Studio navigation and export feedback.
- Include layout, measurement and search dependencies with the Flow Bundle so a complete project copy can run its flow tools independently.

## [0.2.7](https://github.com/alibaba-damo-academy/yugoo-design/tree/v0.2.7)

Complete bilingual examples ready to explore.

- Add matching Chinese and English Web App Kit examples covering all 15 Panels, with flow diagrams, pages, PRDs and whiteboard artifacts.
- Fix intermittent empty mind maps after saved content is reopened or a record detail is closed.

## [0.2.0](https://github.com/alibaba-damo-academy/yugoo-design/tree/v0.2.0)

Turn Studio into an authoring workspace for customizing professional methods and Panels.

- Open Studio independently and use the host AI while editing a Kit or Bundle. Manual editing, file creation, diffs, save/revert and live Panel previews share the current content.
- Simplify content management: keep one current saved state in the local library and copy content to create independent items. Remove local version switching and publication steps. Each project owns its complete `design_kit`; library updates do not silently overwrite existing projects.
- Import Kits and Bundles separately from source ZIPs or Skill folders, preserving supporting files. Export ZIPs and move deleted content to the system trash.
- Improve KAG light/dark themes and node legibility, alongside shared Panel layout, scrolling and feedback.

## [0.1.2](https://github.com/alibaba-damo-academy/yugoo-design/tree/v0.1.2)

Clearer first installation and local semantic preparation.

- Provide short Chinese and English installation prompts and retain the selected exact version throughout installation.
- Add `yugoo-design prepare-embedding` to check model files, download them when requested and verify actual CPU inference. Distinguish plugin activation, model preparation and project semantic readiness; basic design remains available before models are ready.

## [0.1.0](https://github.com/alibaba-damo-academy/yugoo-design/tree/v0.1.0)

Unify the product package and establish a workspace for people and AI to develop, inspect and revise designs together.

- Unify client integration through the `yugoo-design` package and CLI, reusing the host's models, conversation and tools. DSH uses a native plugin with embedded Panels. Companion connects Codex CLI, Claude Code CLI, Qoder CLI, QwenWork and WorkBuddy. Codex Desktop on macOS arm64 has a separate native plugin entry point.
- Include the Web App Kit, combining professional methods and interactive Panels for questions, research, functions, flows, rules, data and pages, with prototypes, PRDs and development handoffs.
- Combine gap-driven collaboration, U/S/T clarity assessment, KAG knowledge connections and GRA review suggestions. Keep design results in independent project files and Git history so later conversations can continue the work.

Integration, platform scope and background capabilities differ by client; the integration list does not mean every feature has been verified on every client. Check the documentation for your installed version; see the current [host guide](docs/wiki/hosts.en.md) for entry points.
