# Kubernetes deployment

Kubernetes deployment is not implemented. This directory is reserved for a
future deployment design and manifests.

Before deploying, define authentication and authorization, TLS and ingress,
secret management, persistent PostgreSQL and MQTT storage, backup and recovery,
readiness checks, and network policies. Building Control currently requires a
single active instance; its local Compose development proxy is not a
production security boundary.

For the implemented local Docker deployment, see the
[development environment guide](../../docs/technical/development-environment.md).
