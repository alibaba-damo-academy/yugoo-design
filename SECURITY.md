# Security reporting

This policy explains how to report security issues for yugoo-design without exposing private data.

## Report privately

Do not post credentials, private design projects, conversation transcripts, or an exploitable reproduction in a public issue.

A private reporting channel has not yet been verified in this policy. Contact the maintainers through the [feedback guide](docs/wiki/support.md) with the subject “Private security reporting channel request”. Include only a brief, non-sensitive description and a way to contact you. The ordinary feedback email is not a verified security-reporting channel. Wait for a confirmed private channel before sending reproduction steps or affected private data.

GitHub private vulnerability reporting is the intended primary channel. Once it is enabled in the public repository, use its private reporting entry, following [GitHub's reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately). Use a security email alternative only after its monitored address is explicitly listed here; no address is currently configured in this policy.

Include the affected package and version, host and operating system, a minimal synthetic reproduction, expected and observed behavior, and the likely impact. Remove tokens, personal data, internal addresses, and unrelated project files. A screenshot or log can contain sensitive data even when no API key is visible.

## Supported versions and response expectations

No supported-version list is currently published here. No response deadline, bounty, or support period is promised.

## Relevant security boundaries

Please report suspected escapes from project or Bundle file permissions, unintended writes or overwrites, unsafe artifact execution, private-data disclosure, credential leakage, or installer actions that affect unrelated host configuration. Include whether the issue occurs in the agent tools, Panel, generated artifact, Kit script, knowledge store, or installation adapter.

Generated content and third-party Kits are not automatically trustworthy. Kit and Bundle definitions are declarative content; importing or adopting them does not authorize executable code or install dependencies. Review their provenance, permissions and licenses. Any required executable Provider, native component or external tool needs its separately trusted installation path. Schema validity or an AI review is not a security certification. Do not give a reproduction access to a real project or production credentials when a temporary synthetic project will suffice.

## Keep host and plugin reports distinct

yugoo-design is a plugin, not a distribution of the host agent application. A report should identify the host version and explain whether the problem remains without the plugin, where practical. The project should investigate its own boundaries without requiring users to patch the host application or disclose host credentials.

Maintainers can find the [reporting-channel checklist in the contribution guide](CONTRIBUTING.md#maintain-private-security-reporting).
