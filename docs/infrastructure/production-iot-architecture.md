# Proposed production infrastructure for real IoT

## Table of contents

- [Proposal and shared requirements](#proposal-and-shared-requirements)
  - [Building configuration and device state](#building-configuration-and-device-state)
  - [Data and scaling prerequisites](#data-and-scaling-prerequisites)
  - [Production readiness and open decisions](#production-readiness-and-open-decisions)
- [AWS](#aws)
  - [Status and recommendation](#status-and-recommendation)
  - [Proposed architecture](#proposed-architecture)
  - [Network and security](#network-and-security)
  - [AWS IoT integration](#aws-iot-integration)
  - [Data and scaling](#data-and-scaling)
  - [Delivery and operations](#delivery-and-operations)
  - [AWS references](#aws-references)
- [Azure](#azure)
  - [Azure architecture](#azure-architecture)
  - [Azure network and security](#azure-network-and-security)
  - [Azure IoT and data](#azure-iot-and-data)
  - [Azure scaling and operations](#azure-scaling-and-operations)
  - [Azure references](#azure-references)

## Proposal and shared requirements

**Proposal only:** this is not deployed or implemented. The intended production product is a building configurator connected to physical IoT devices, with a separate instrumentation application. The current simulator and editor are a starting point, not an existing physical-device integration. They are designed for local, loopback-only use and must not be exposed to the internet or a shared network as they stand. See the [simulator](../technical/building-light-simulator.md#building-editor) and [instrumentation](../technical/lighting-instrumentation.md#dashboard-information-hierarchy) security notes.

### Building configuration and device state

The desired product replaces the simulated building with a managed configuration mapped to real controllers, rooms, sensors and lights. Define stable building and device identities, onboarding and ownership, and how configured devices map to physical hardware. Keep desired configuration and commands distinct from device-reported state; a successful cloud request or publication must not be presented as confirmed physical execution. Show pending, acknowledged, failed, stale and offline states based on real observations.

Determine the required protocols, device connectivity and provisioning model, event ordering and deduplication, multi-building isolation, telemetry retention, fleet size, and whether existing building gateways or direct device connections are needed before choosing the final integration architecture. If commands are enabled, require explicit authorization, acknowledgement, idempotency, expiry and replay protection; define device-side safety and operation during cloud or network outages. The current in-memory simulator, MQTT topics and local editor do not provide these production capabilities.

### Data and scaling prerequisites

The simulator design store and instrumentation telemetry store currently use separate SQLite databases, and simulator runtime presence, faults and lights are held in process memory. Before horizontal scaling or rolling replacement, define authoritative ownership of configuration, command state and last-observed device state, with transactional writes, revision/conflict handling and safe recovery. Physical devices remain the source of their reported behavior; persisted observations must not be mistaken for live confirmation. One possible design is a durable shared state store with concurrency control; alternatively partition buildings to single owners with durable state and explicit failover/fencing. Prove that reads, mutations, message publication and design activation remain consistent under concurrent requests, task replacement and zone failure. Sticky sessions are not a correctness or failover strategy. Until then, a single simulator process avoids divergent replicas but is **not highly available** and can lose runtime state on restart; overlapping rolling deployments must also be prevented or coordinated.

Migrate both SQLite stores to PostgreSQL with schema migrations, transaction and concurrency tests, data import/verification, backup and rollback procedures. Keep logical ownership and least-privilege identities separate, whether the stores share a database service or not. Instrumentation runs HTTP polling and an MQTT subscriber in each process today; multiple replicas can duplicate ingestion and events or race on membership and status. Separate or coordinate ingestion, define idempotency and stale-state behavior, and ensure the dashboard can read shared state before scaling it.

### Production readiness and open decisions

1. Provide authorized remote access to the production configurator; define users, internet exposure, access roles, authentication provider and audit requirements. The current loopback-only editor must not be exposed unchanged.
2. Choose ownership, durability and failure semantics for configuration, commands and observed device state; prove concurrent updates, task replacement, device reconnects, duplicate delivery, ordering and outage recovery.
3. Design PostgreSQL migrations and instrumentation ingestion coordination; establish retention, backup/restore and data migration tests.
4. Choose region, availability zones, capacity, availability target, recovery objectives, expected load and a monthly cost budget; compare service tiers and database options.
5. Specify the device and gateway protocols, onboarding, tenant/building isolation, telemetry flow, whether remote commands are required, and their authorization, replay protection and outage behavior.
6. Implement and test network boundaries, authenticated APIs, observability, deployment/rollback, load and failover before enabling production traffic or autoscaling.

## AWS

### Status and recommendation

ECS on AWS Fargate, an Application Load Balancer (ALB), Aurora PostgreSQL, and AWS IoT Core are a sensible managed starting point for the production product. Evolve the simulator into the configurator and device integration service, and run it separately from instrumentation, using the existing Docker targets as a starting point. First make the applications, device integration, and state safe for production. Size and price the design against the expected device fleet, traffic, availability and recovery requirements.

The ALB terminates TLS and routes separate hostnames to the two services. It is not a substitute for application authentication or authorization.

### Proposed architecture

![Proposed AWS architecture: users connect through WAF and an internet-facing load balancer to a building configurator and instrumentation on Fargate in private subnets. Instrumentation polls the configurator privately; both services use Aurora PostgreSQL in isolated subnets. The configurator and physical devices exchange messages through AWS IoT Core. The production integration and scaling require application changes.](../assets/diagrams/production-aws.svg)

The diagram is a target design, not a depiction of current behavior. It groups subnets across at least two Availability Zones (AZs); each tier has separate subnets in each AZ. AWS WAF is associated with the ALB. The configurator and instrumentation have separate target groups and services, with private service discovery or an internal load balancer for instrumentation-to-configurator traffic. Use separate hostnames, such as `config.example.com` and `monitor.example.com`, so their existing root-relative frontend paths do not collide. AWS IoT Core is a managed service outside the VPC; the arrows represent proposed two-way device communication, not an existing integration or a commitment to a specific command model. DNS, certificate management, egress, deployment and logging are omitted for clarity.

The diagram uses [official AWS architecture icons](https://aws.amazon.com/architecture/icons/); the selected downloaded SVGs are in [the icon directory](../assets/aws-icons/). The diagram embeds copies so it remains self-contained.

### Network and security

- **Public / DMZ edge:** place the internet-facing ALB in public subnets in at least two AZs, with a route to an internet gateway. This public edge is the proposed DMZ; an AWS subnet is not inherently a separate security boundary. Route HTTPS on port 443 to the correct target group; redirect or disable port 80. Use an ACM certificate, suitable TLS policy, and WAF rules appropriate to the exposure.
- **Private application tier:** place Fargate tasks in private subnets in both AZs without public IPs. Allow application ingress only from the ALB security group and, for configurator polling, the instrumentation security group or a dedicated internal load balancer. Restrict outbound access. Configure a NAT gateway or the necessary VPC endpoints and routes for image pulls, logs, secrets and other dependencies; validate every required dependency, not just ECR.
- **Isolated database tier:** put Aurora in private database subnets across AZs, with no public access or internet route. Allow PostgreSQL port 5432 only from the application security groups that need it. Encrypt storage and backups, require TLS to the database, and use least-privilege database identities.
- **Application access:** implement authentication and authorization for both applications and all APIs before exposure, including read access and configurator control. For instrumentation polling, use a dedicated machine identity with short-lived credentials and authorization restricted to the required read endpoints; deliver credentials securely, validate identity and use TLS on the internal path. The current poller has no credentials, so this needs implementation. Define user roles, audit sensitive actions, protect cookie-based mutations against CSRF, validate inputs, and configure trusted proxy/forwarded headers and host handling explicitly. Current loopback and origin checks are not authentication and reject proxied simulator mutations; the editor remains unavailable behind a proxy. Do not remove these protections without a tested replacement.
- **Secrets and telemetry:** use Secrets Manager, scoped task/execution IAM roles and rotation; never put credentials in images or logs. Send application logs and infrastructure metrics to CloudWatch with appropriate retention and alerts. Consider ALB access logs, audit trails, WAF rules and VPC flow logs with appropriate privacy controls.
- **IoT transport:** propose AWS IoT Core for device connectivity rather than operating a broker. Provision distinct device identities and certificates, mutual TLS, narrowly scoped IoT policies, secure onboarding, rotation and revocation. Give application workloads separate, least-privilege IAM identities and encrypted connectivity; choose and test the supported protocol and network route, including any needed VPC endpoints. Set message limits and monitor authentication failures and device connectivity. The existing MQTT implementation and topic contracts are not an AWS IoT Core integration; the current command handler lacks replay protection. Design idempotency and replay defenses before enabling commands. HTTP polling between applications remains a separate input.

### AWS IoT integration

Propose IoT Core as the secure messaging boundary: devices publish telemetry, and the configurator or a dedicated integration worker consumes and reconciles it. The diagram also shows a possible command path, but whether remote control is required and which commands are permitted remain decisions. Evaluate IoT device shadows for desired/reported state only after selecting the reconciliation model.

### Data and scaling

Aurora PostgreSQL is a **future migration**, not a configuration change. Fargate task storage is ephemeral; replacing a task can lose its local data. Aurora alone does not make live simulator state consistent across tasks or provide device integration. In addition to the shared requirements, test IoT Core reconnects, duplicate delivery, ordering and outage recovery. Compare provisioned Aurora with Aurora Serverless v2 and other database options.

After these prerequisites are proven:

- Spread application tasks across at least two AZs and use health checks, graceful draining and deployment policies that preserve the state ownership invariant.
- Apply ECS service auto scaling independently to safe-to-replicate services using measured CPU, memory, ALB request rate or application metrics, with minimum/maximum counts and cooldowns. Load-test polling frequency, database connections and latency; more tasks do not automatically increase safe throughput.
- Place an Aurora writer and a reader in different AZs for compute failover; use the cluster writer endpoint for writes and only use readers where replica lag is acceptable. Set connection limits and evaluate RDS Proxy if connection churn warrants it. Test failover and restores; choose backup retention and recovery point/time objectives explicitly.

### Delivery and operations

Build the two existing Docker targets in CI, scan and publish immutable images to ECR, and deploy infrastructure and services using version-controlled infrastructure as code. Run schema migrations as a controlled, single deployment step with compatible application versions. Add authenticated smoke tests, readiness and liveness checks, alerts for failed deployments and telemetry freshness, tested rollback, restore drills, and an incident runbook. Do not assume a running task means that telemetry or the database is healthy.

![Proposed delivery sequence: source and tests flow through build, test and scan, image publication to ECR, controlled database migration, ECS deployment, and authenticated smoke tests and health checks. Failed checks lead to rollback of a compatible release.](../assets/diagrams/production-delivery.svg)

This is a proposed delivery sequence; it is not the current CI/CD workflow. Rollback must account for irreversible schema changes and cannot by itself restore lost data.

### AWS references

- [AWS architecture icons and usage](https://aws.amazon.com/architecture/icons/) (icon package release 2026-07-31).
- [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html).
- [ECS service auto scaling](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-auto-scaling.html).
- [Aurora high availability](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html).
- [AWS IoT Core protocols and authentication](https://docs.aws.amazon.com/iot/latest/developerguide/protocols.html).
- [Current project architecture](../README.md#architecture-overview) and [project plan](../plans/plan.md).

## Azure

This is an alternative **proposal**, based on the AWS design and the shared production-readiness requirements above, not an existing deployment. It retains separate configurator and instrumentation services, a managed PostgreSQL database, an IoT messaging boundary, and private application and database tiers. Service behavior and availability differ; this is not a drop-in port of AWS infrastructure or of the current application.

### Azure architecture

![Proposed Azure architecture: users reach Application Gateway with WAF in a virtual network. It routes to the building configurator and instrumentation in an internal Azure Container Apps environment. Both applications use Azure Database for PostgreSQL in a private subnet. The configurator and physical devices exchange messages through Azure IoT Hub. Integration and scaling require application changes.](../assets/diagrams/production-azure.svg)

Use an internet-facing Azure Application Gateway with WAF in its dedicated subnet, an internal Azure Container Apps environment in a separate dedicated subnet, and Azure Database for PostgreSQL Flexible Server using private access in its own delegated subnet. The configurator and instrumentation are separate container apps; the gateway routes separate hostnames to them, and instrumentation accesses the configurator over internal ingress. Use the environment's private DNS and configure backend hostnames, TLS and health probes correctly. Azure IoT Hub is a managed service outside the VNet; the device arrows represent proposed telemetry and possible commands, not implemented behavior.

The diagram uses [official Azure architecture icons](https://learn.microsoft.com/en-us/azure/architecture/icons/); selected downloaded SVGs are in [the Azure icon directory](../assets/azure-icons/), and copies are embedded in the diagram.

### Azure network and security

- **Public / DMZ edge:** use Application Gateway WAF with a public frontend, HTTPS listeners and appropriate rules, certificates and access logging. The dedicated gateway subnet is the proposed edge, not an authorization boundary by itself. Configure the internal environment so direct public access to the applications is not available.
- **Private application tier:** integrate the internal Container Apps environment with its own VNet subnet. Configure private DNS, gateway-to-app routing, internal service discovery, ingress restrictions and required egress for the registry, secrets, monitoring and IoT endpoints. Choose private endpoints or controlled outbound connectivity as supported by each dependency.
- **Private database tier:** use PostgreSQL Flexible Server private access, a dedicated delegated subnet and private DNS; deny public database access. Restrict connectivity to authorized workloads, enforce TLS and least-privilege database identities, and protect backups.
- **Identity:** implement user authentication and authorization for both applications, including an authorized remote configurator. Use a separate machine identity and short-lived credentials for instrumentation polling, with internal TLS and read-only authorization. Use managed identities where supported, Key Vault for secrets and certificate lifecycle, and scoped access. The current editor and unauthenticated poller cannot be exposed unchanged.
- **Device security:** use individual device identities, certificate-based authentication where supported, provisioning and revocation, per-device authorization, encrypted transport, quotas and monitoring. Define safe behavior during outages; do not treat successful message submission as physical execution.

### Azure IoT and data

Azure IoT Hub is the proposed managed device boundary. Device-to-cloud telemetry can be consumed from its built-in Event Hubs-compatible endpoint by a coordinated integration worker; design partition ownership, checkpointing, replay, deduplication and recovery. Select cloud-to-device messaging, direct methods or device twins only if appropriate to the final command and reconciliation requirements; validate the selected IoT Hub tier, protocol and delivery semantics. IoT Hub is not a general-purpose MQTT topic broker: the existing simulator's topics and handler need adaptation, and the integration is not implemented.

Apply the shared separation of desired configuration, command status and observed physical state, including acknowledgements, authorization, idempotency, expiry, replay defenses, stale/offline states and device-side safety. Decide how devices or gateways connect and are mapped to buildings before implementation.

PostgreSQL Flexible Server is also a future migration, not a connection-string change. The existing SQLite stores and in-memory state must be redesigned and migrated with verified backups, transactions and recovery. For production availability, evaluate zone-redundant high availability where supported in the chosen region and tier, test failover and restores, and specify recovery objectives and retention. Its standby/failover model is not identical to Aurora's writer/reader topology.

### Azure scaling and operations

Use a zone-redundant Container Apps environment where supported, and set minimum replicas and autoscaling rules based on measured HTTP load, CPU/memory or suitable event metrics. Do not scale to zero for components that must continuously ingest telemetry. Scale only after state ownership and ingestion are safe across replicas; coordinate workers and checkpoint recovery, and load-test device, database and service limits. A single current simulator process is not highly available.

Build and scan the existing Docker targets, publish immutable images to Azure Container Registry, deploy via version-controlled infrastructure as code, and execute controlled compatible schema migrations. Use Azure Monitor and Log Analytics for health, telemetry freshness and operational alerts, with tested rollback, backups and restore drills. Define region, availability, capacity and cost targets before selecting service tiers. The [AWS delivery diagram](../assets/diagrams/production-delivery.svg) illustrates the equivalent sequence, but its ECR/ECS labels are AWS-specific; use ACR/Container Apps for Azure.

### Azure references

- [Azure architecture icons and usage](https://learn.microsoft.com/en-us/azure/architecture/icons/).
- [Application Gateway WAF with internal Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/waf-app-gateway).
- [Azure Container Apps overview](https://learn.microsoft.com/en-us/azure/container-apps/overview).
- [IoT Hub built-in events endpoint](https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-messages-read-builtin).
- [IoT Hub messaging and tiers](https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-messaging).
