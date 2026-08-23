# Performance Tuning the CloudPulse Sync Agent

The self-hosted CloudPulse Sync Agent (Enterprise-only) mirrors workspace data into your own
PostgreSQL database on a polling interval. Its default configuration is tuned for small-to-medium
workspaces; larger workspaces — particularly ones with 10,000 or more tasks — benefit from
adjusting a small number of environment variables. This guide covers the two variables that matter
most for throughput, `SYNC_CONCURRENCY` and `SYNC_BATCH_SIZE`, plus how to monitor the agent's
health while you tune it.

## Understanding the Default Behavior

Out of the box, the Sync Agent polls the CloudPulse API every 300 seconds (the default sync
interval) and pulls changed records since its last successful run. For a workspace with a few
hundred tasks, a single polling cycle completes in well under a second and the defaults never need
touching. As task volume grows, two things start to matter: how many records are fetched per API
page, and how many of those pages are processed concurrently.

## `SYNC_BATCH_SIZE`

`SYNC_BATCH_SIZE` controls how many records the agent requests per API page during a sync cycle.

- **Default:** `100`
- **Recommended for large workspaces:** increase this for any workspace with 10,000+ tasks, so a
  full sync cycle requires fewer round trips to the CloudPulse API

```env
SYNC_BATCH_SIZE=500
```

A larger batch size trades a bit of per-request memory for far fewer HTTP round trips — for a
workspace with 50,000 tasks, the difference between fetching in batches of 100 versus batches of
500 is the difference between roughly 500 API calls and roughly 100 API calls per full sync. Raise
this value incrementally (e.g. `100` → `250` → `500`) rather than jumping straight to a very large
number, and watch the agent's own memory usage after each change — each in-flight batch is held in
memory until it's written to Postgres.

## `SYNC_CONCURRENCY`

`SYNC_CONCURRENCY` controls how many batches the agent processes in parallel during a single sync
cycle.

- **Default:** `4`
- **Maximum:** `16`

```env
SYNC_CONCURRENCY=8
```

Raising concurrency helps most when the bottleneck is network round-trip latency to the CloudPulse
API rather than local CPU or your Postgres instance's write throughput — running more batches in
flight at once hides that latency behind parallelism. It stops helping (and can start hurting) once
your Postgres instance becomes the bottleneck instead: a higher `SYNC_CONCURRENCY` means more
concurrent write transactions against the same tables, which can increase lock contention on a
smaller database instance. `16` is a hard ceiling in the agent itself — values above it are
rejected at startup.

A reasonable tuning order for a workspace with 10,000+ tasks:

1. Increase `SYNC_BATCH_SIZE` first (it reduces total API round trips with the least risk)
2. Increase `SYNC_CONCURRENCY` afterward only if sync cycles still take longer than your polling
   interval allows

## Monitoring While You Tune

The agent exposes a `/health` endpoint on port 9090 for monitoring, independent of whichever port
your own application traffic uses:

```bash
curl http://localhost:9090/health
```

Watch this endpoint before and after each configuration change — a sync cycle that used to
complete comfortably within the 300-second default interval but now runs long after a batch-size or
concurrency change is a sign you've pushed a value too far for your current database instance size,
not a sign to push it further.

## A Note on the Sync Interval

The default 300-second sync interval is deliberately conservative — it's meant to keep the mirrored
database reasonably fresh without generating constant API load. Lowering the interval doesn't
address a slow sync cycle; if a cycle already takes close to 300 seconds to complete, shortening the
interval only increases the chance of overlapping cycles. Tune `SYNC_BATCH_SIZE` and
`SYNC_CONCURRENCY` to get each individual cycle comfortably under the interval first, and only
consider changing the interval itself once cycle time is no longer the limiting factor.

## Summary

| Variable           | Default | Max | Purpose                                           |
| ------------------ | ------- | --- | ------------------------------------------------- |
| `SYNC_BATCH_SIZE`  | 100     | —   | Records fetched per API page per sync cycle       |
| `SYNC_CONCURRENCY` | 4       | 16  | Number of batches processed in parallel per cycle |

Start with `SYNC_BATCH_SIZE` for large workspaces, add `SYNC_CONCURRENCY` only if needed, and use
the `/health` endpoint on port 9090 to confirm each change actually shortens sync cycle time before
making the next one.
