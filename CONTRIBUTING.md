# Contributing

Contributions are welcome when they preserve the project's least-privilege design.

Before opening a pull request:

1. Keep model-facing tools narrow and explicit. Do not add a general shell or arbitrary-code tool.
2. Add or update tests for path, network, size-limit, and configuration behavior.
3. Run `python -m unittest discover -s tests -v`.
4. Run `npm ci` and `npm run build` in `ui`.
5. Do not commit model weights, generated workspaces, logs, credentials, local configuration, `node_modules`, or frontend build output.

For security-sensitive changes, describe the threat being addressed and the remaining limitations. Report unpatched vulnerabilities privately as described in [SECURITY.md](SECURITY.md).
