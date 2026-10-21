# Security reporting

This document describes how to handle security reports for yugoo-design. Maintainers have selected GitHub private vulnerability reporting as the primary channel, with a dedicated security email as an optional alternative. Neither an enabled repository channel nor a monitored email address is announced by this draft; it does not announce a released or supported version.

## Report privately

Do not post credentials, private design projects, conversation transcripts, or an exploitable reproduction in a public issue. Once private vulnerability reporting is enabled in the public GitHub repository, use the repository's private vulnerability reporting entry, following [GitHub's reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately). A dedicated security email may also be used once its monitored address is explicitly listed in this policy; no address is configured here yet. If neither channel is available, do not disclose sensitive details publicly; ask the maintainers to provide a private reporting channel first.

Include the affected package and version, host and operating system, a minimal synthetic reproduction, expected and observed behavior, and the likely impact. Remove tokens, personal data, internal addresses, and unrelated project files. A screenshot or log can contain sensitive data even when no API key is visible.

No response deadline, bounty, or support period is promised by this draft. Maintainers must establish the reporting channel and a supported-version policy before replacing this draft with a public policy.

## Relevant security boundaries

Please report suspected escapes from project or Bundle file permissions, unintended writes or overwrites, unsafe artifact execution, private-data disclosure, credential leakage, or installer actions that affect unrelated host configuration. Include whether the issue occurs in the agent tools, Panel, generated artifact, Kit script, knowledge store, or installation adapter.

Generated content and third-party Kits are not automatically trustworthy. Kit and Bundle definitions are declarative content; importing or adopting them does not authorize executable code or install dependencies. Review their provenance, permissions and licenses. Any required executable Provider, native component or external tool needs its separately trusted installation path. Schema validity or an AI review is not a security certification. Do not give a reproduction access to a real project or production credentials when a temporary synthetic project will suffice.

## Keep host and plugin reports distinct

yugoo-design is a plugin, not a distribution of the host agent application. A report should identify the host version and explain whether the problem remains without the plugin, where practical. The project should investigate its own boundaries without requiring users to patch the host application or disclose host credentials.

## Before publishing this policy

Enable and test private vulnerability reporting in the actual public repository, list the supported package versions, and verify that the README links to this policy. If the email alternative is offered, publish only an authorized, monitored security address and verify that it receives reports. Confirm that the npm and source distributions contain no private reporting addresses, development credentials, or real user projects. These checks remain prerequisites for activating this public policy, not claims about the local evaluation package. External publication follows the user's own package testing and separate authorization; this draft does not authorize a GitHub push or npm publish.
