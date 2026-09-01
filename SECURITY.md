# Security policy

## Supported versions

Security fixes are currently applied to the latest release on the default branch.

## Threat model

Local Agent Workspace is designed to reduce the authority granted to a local language model and to content retrieved from the web.

The intended boundary includes:

- one explicitly configured filesystem workspace;
- bounded UTF-8 text reads and writes;
- no delete, shell, process, credential, or arbitrary-code tool;
- public HTTP/HTTPS destinations on configured ports only;
- validation of every redirect;
- DNS resolution followed by a connection pinned to the validated public address;
- blocking private, loopback, link-local, multicast, reserved, and unspecified addresses;
- blocking symlinks and Windows filesystem reparse points below the workspace;
- loopback-only UI binding unless the operator explicitly opts into remote access.

## Out of scope and known limitations

- This is not a sandbox against malware or another local process running as the same operating-system user.
- There is no user authentication. Do not enable remote binding on an untrusted network.
- A malicious or unreliable model can still create misleading text or make unwanted edits within the approved workspace.
- Filesystem validation is path-based. Although reparse points are rejected and edits use an atomic replacement, this release does not use Windows handle-relative opens to eliminate every possible local time-of-check/time-of-use race.
- The default Bing RSS search endpoint is convenient but unofficial and may change. It can be replaced in configuration.
- Only text-oriented public content is supported; active browser automation and authenticated sites are intentionally out of scope.

Keep backups of important files and use a dedicated workspace rather than a personal documents root.

## Reporting a vulnerability

Please use the repository's private **Report a vulnerability** flow under the Security tab. Do not open a public issue for an unpatched vulnerability or include credentials, private files, or model data in a report.
