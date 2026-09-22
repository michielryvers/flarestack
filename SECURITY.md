# Security policy

Flarestack is an early preview. Security fixes target the latest preview release;
older preview package sets are not maintained separately. Upgrade the complete
Flarestack package set together.

Please report suspected vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/michielryvers/flarestack/security/advisories/new).
If that form is unavailable, open an issue asking for a private contact without
including vulnerability details or credentials.

Include the affected package version, operating system, configuration mode, impact
and a minimal reproduction using synthetic accounts. Never include live tokens,
cookies, passwords, recovery links, raw telemetry or private customer data.

Local bridge credentials and telemetry relay credentials are generated for each
run. The Docker telemetry relay accepts only authenticated OTLP requests. Its
listener defaults to the detected Linux Docker bridge address, or all IPv4
interfaces for Docker Desktop. `FLARESTACK_RELAY_HOST` can restrict the bind address;
container access must still reach it through `host.docker.internal`. Credentials
are not intended to authenticate services across an untrusted network.

Local `.env` files, Alchemy state, machine overrides and generated evidence must
remain outside version control. See [the security model](docs/security-model.md)
for session validation and ownership boundaries.
