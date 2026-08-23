# Deploying the CloudPulse Sync Agent

Most CloudPulse customers use the fully-hosted cloud service and never need to deploy anything.
This guide is for Enterprise customers running the optional **CloudPulse Sync Agent** — a
self-hosted component that mirrors board data into an internal database for compliance or offline
reporting. It supports deployment via Docker or AWS.

## Prerequisites

- Docker 24+ and Docker Compose v2, or an AWS account with permissions to create ECS services
- An Enterprise-tier CloudPulse workspace with the Sync Agent add-on enabled
- A PostgreSQL 14+ database reachable from the deployment target
- A CloudPulse API key with `admin` scope

## Option A: Docker Deployment

1. Pull the official image:

   ```bash
   docker pull cloudpulse/sync-agent:2.4.0
   ```

2. Create a `.env` file with your configuration:

   ```env
   CLOUDPULSE_API_KEY=cp_live_xxxxxxxx
   CLOUDPULSE_WORKSPACE=acme-engineering
   SYNC_DATABASE_URL=postgresql://user:pass@db-host:5432/cloudpulse_sync
   SYNC_INTERVAL_SECONDS=300
   ```

3. Start the container:

   ```bash
   docker run -d --name cloudpulse-sync --env-file .env -p 9090:9090 cloudpulse/sync-agent:2.4.0
   ```

4. Verify it's healthy:

   ```bash
   curl http://localhost:9090/healthz
   # {"status":"ok","lastSyncAt":"2026-01-20T10:15:00Z"}
   ```

The agent polls the CloudPulse API every `SYNC_INTERVAL_SECONDS` (default 300) and writes
incremental changes to the configured Postgres database using an upsert-based sync, so it is safe
to restart the container at any time without data loss.

## Option B: AWS ECS Deployment

1. Create an ECS task definition using the `cloudpulse/sync-agent:2.4.0` image, allocating at
   least 512 MB memory and 0.25 vCPU.
2. Store `CLOUDPULSE_API_KEY` and `SYNC_DATABASE_URL` in AWS Secrets Manager and reference them in
   the task definition's `secrets` block — never place them in plain environment variables in the
   task definition JSON.
3. Attach the task to a security group that allows outbound HTTPS (port 443) to
   `api.cloudpulse.io` and outbound access to your RDS Postgres instance on port 5432.
4. Set the ECS service's desired count to 1 — the sync agent is not designed to run multiple
   concurrent replicas against the same target database, since concurrent writers can produce
   duplicate sync-lock contention.
5. Configure a CloudWatch alarm on the `/healthz` endpoint (via an Application Load Balancer
   target group health check) to alert if the agent stops syncing for more than 15 minutes.

## Configuration Reference

| Variable                | Required | Default | Description                              |
| ----------------------- | -------- | ------- | ---------------------------------------- |
| `CLOUDPULSE_API_KEY`    | Yes      | —       | Admin-scoped API key                     |
| `CLOUDPULSE_WORKSPACE`  | Yes      | —       | Workspace slug to sync                   |
| `SYNC_DATABASE_URL`     | Yes      | —       | Target Postgres connection string        |
| `SYNC_INTERVAL_SECONDS` | No       | 300     | Polling interval                         |
| `SYNC_BATCH_SIZE`       | No       | 500     | Records fetched per API page during sync |
| `LOG_LEVEL`             | No       | info    | One of `debug`, `info`, `warn`, `error`  |

## Upgrading

The sync agent follows semantic versioning. Patch releases (e.g. `2.4.0` → `2.4.1`) are always
safe to apply with zero downtime. Minor releases (e.g. `2.4.0` → `2.5.0`) may add new synced
tables and require running `sync-agent migrate` once before restarting. Major releases are
announced at least 60 days in advance via the CloudPulse changelog.

## Troubleshooting Deployment

If `/healthz` reports `"status":"degraded"`, check the container logs for `SYNC_DB_CONN_ERROR` —
this almost always indicates the security group or firewall is blocking outbound access to the
Postgres target on port 5432. A `SYNC_AUTH_ERROR` status indicates the configured API key has been
revoked or lacks `admin` scope.
