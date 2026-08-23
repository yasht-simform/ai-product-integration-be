# CloudPulse Architecture Overview

CloudPulse is built as a set of independently deployable microservices running behind a single
API gateway, rather than as one monolithic application. This document describes the major
components, how they communicate, and where customer data is hosted.

## API Gateway

Every external request — from the web app, the CLI, an SDK, or a direct `curl` call — enters the
system through **Kong**, CloudPulse's API gateway. Kong is responsible for authenticating bearer
tokens, enforcing per-plan rate limits (60/300/2,000 requests per minute for Free/Pro/Enterprise),
and routing each request to the correct downstream microservice based on the request path. Kong
also terminates TLS at the edge, so no internal service ever receives unencrypted traffic from the
public internet.

## Core Microservices

Behind the gateway, CloudPulse is decomposed into four primary services:

| Service              | Responsibility                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task Service         | Owns workspaces, boards, tasks, comments, and attachments — the core domain model and the target of most `GET`/`POST`/`PATCH`/`DELETE` calls under `/v1`. |
| Notification Service | Delivers in-app notifications, email digests, and outbound webhook payloads triggered by task and board events.                                           |
| Search Service       | Indexes task titles, descriptions, and comments into Elasticsearch and serves the `GET /v1/search` endpoint.                                              |
| Sync Service         | Keeps the Elasticsearch index and any connected third-party integrations (see the integrations guide) consistent with the system of record.               |

Each service owns its own read path but shares the same underlying Postgres cluster for
transactional writes, so there is one authoritative copy of workspace/board/task data at all
times.

### Task Service

The Task Service is the largest and most heavily used component. It exposes the bulk of the
public REST API — board and task CRUD, custom fields, labels, and due dates — and is the service
that ultimately writes every task mutation to PostgreSQL. It also publishes an event to Kafka
(described below) after every successful write, which is how the Notification Service and Search
Service learn that something changed without querying the database directly.

### Notification Service

The Notification Service consumes Kafka events and turns them into three kinds of output:
in-app notification badges, batched email digests, and signed webhook deliveries (see the
webhooks reference for the retry and signing details). Because it consumes events asynchronously
rather than being called synchronously by the Task Service, a temporary outage in the
Notification Service never blocks a user from creating or updating a task — events simply queue in
Kafka until the service catches up.

### Search Service

The Search Service maintains an Elasticsearch index of task titles, descriptions, and comment
bodies. It does not read from Postgres directly on the query path; instead, it consumes the same
Kafka event stream the Notification Service uses, so full-text search results can lag writes by a
small number of seconds under normal load. This index is what powers `GET /v1/search`.

### Sync Service

The Sync Service is responsible for keeping external systems — connected integrations, and the
Search Service's Elasticsearch index during a full reindex — up to date. It's also the service
that performs bulk backfills, for example after a schema migration that requires recomputing
derived fields across every existing task.

## Data Storage

**PostgreSQL 15** is CloudPulse's system of record for every relational entity: workspaces,
boards, tasks, comments, attachments, custom field definitions, and user/role assignments. All
writes go through the Task Service, which is the only service with write access to the primary
Postgres cluster.

**Redis** serves two distinct purposes: as a cache in front of frequently read Postgres queries
(board and task lookups, permission checks), and as the backing store for the per-API-key
rate-limit counters that Kong enforces at the gateway. Because Redis operations are in-memory,
rate-limit checks add negligible latency to the request path.

**Kafka** is the event bus connecting all four microservices. Every task and board mutation is
published as an event, and every downstream consumer (Notification Service, Search Service, Sync
Service) subscribes independently. This decouples the services from one another: the Task Service
never needs to know how many consumers exist or whether they're currently healthy.

## Hosting and Deployment

CloudPulse runs on **AWS**, using **ECS Fargate** for all four microservices plus the Kong gateway.
Fargate was chosen specifically so that no team has to manage or patch underlying EC2 instances —
each service scales horizontally by adding Fargate tasks behind its own internal load balancer.

## Data Residency

As of version 3.6.0, Enterprise customers can choose which AWS region hosts their workspace data:

- **US (default)** — `us-east-1`
- **EU** — `eu-west-1`

This choice is made once, at workspace provisioning time, and applies to the full stack for that
workspace — Postgres, Redis, Kafka, and the Elasticsearch index all run in the selected region.
Free and Pro workspaces are always hosted in `us-east-1`; regional choice is an Enterprise-only
capability tied to the plan's broader compliance feature set alongside SSO.
