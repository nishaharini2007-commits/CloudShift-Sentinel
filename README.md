# CloudShift

CloudShift is a migration observability lab for demonstrating backward-compatible PostgreSQL schema changes while an API continues to serve requests. Its default mode is an in-memory **simulated demo**. Simulated values are labeled in the interface and must not be reported as measured AWS, PostgreSQL, or production results.

## What works in this project

- React and Vite dashboard with health, request/error counts, observed process latency, migration progress, consistency results, activity log, and report download.
- User creation, search, and pagination. Demo mode exposes 100,000 virtual sample records without storing 100,000 objects in memory.
- Express API with validation, parameterized SQL, centralized errors, and API latency/request observation.
- PostgreSQL legacy schema setup and a resumable-style batched backfill demonstration. Existing data remains intact in expand; user writes dual-write to both columns until contract.
- Explicit validation and a separately guarded contract action. Contract requires a validated migration, a typed confirmation in the UI, a request acknowledgment, and `LEGACY_CLIENTS_RETIRED=true` in the server environment.
- A seed script for at least 100,000 rows, and a k6 steady-traffic test.
- No frontend database credentials. TLS certificate verification stays enabled; provide an RDS CA certificate for private/custom trust chains.

## Requirements

- Node.js 20 or newer and npm.
- For real database mode: PostgreSQL 14 or newer, or Amazon RDS for PostgreSQL, with a database and a least-privilege application user.
- Optional for load tests: k6.

## Run the simulated demo

1. Open this project folder in VS Code.
2. In a terminal, run `npm install` once to install the dependencies listed in `package.json`.
3. Run `npm run dev` to start Vite and the Express API. Vite serves the UI at `http://localhost:5173`; the API listens at `http://localhost:4000`.
4. The dashboard should show **SIMULATED DATA** and a demo-mode banner. The sample dataset is virtual. Migration timings and chart reference values are illustrative, not measured. API counts/latency become local observations once requests hit the running API, but are not AWS/production metrics.

These terminal commands are not run by the project authoring process. Dependencies, runtime, and ports have not been verified in this workspace yet.

## Use PostgreSQL locally

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to a PostgreSQL connection string. Never commit `.env`.
2. For local development without TLS, keep `PG_SSL=false`. For RDS, set `PG_SSL=true` and set `PG_CA_CERT_PATH` to the AWS RDS CA bundle file. Production always enables TLS certificate verification. Do not set `rejectUnauthorized` to false.
3. Run `npm run seed` to create up to 100,000 sample users. `SEED_COUNT` controls how many rows are attempted (default 100000); batches use `SEED_BATCH_SIZE` (default 2000). The seed is additive and uses `ON CONFLICT` to avoid duplicate emails.
4. Run `npm run dev`. The API ensures the legacy `users` table and index exist at startup. Keep the database reachable from the server.
5. Use the dashboard to run the migration. The expand phase adds nullable `display_name`, then copies `name` to `display_name` in batches of 1,000 using `FOR UPDATE SKIP LOCKED`. Old `name` is preserved and all new writes populate both fields. API requests continue during backfill.
6. Validate the backfill. The server checks every record for missing values and mismatches. Only a passing validation unlocks contract.
7. For a disposable local database only, stop old application versions and all old clients. Set `LEGACY_CLIENTS_RETIRED=true` on the API server, select the retirement acknowledgment, type `DROP_LEGACY_NAME`, then separately apply contract. Contract drops `name`; it cannot be undone without restoring the column/data from backup. Do not use this operation against production without a tested backup and rollout plan.

The API process records request counts, errors, and latency from its own start. Before/during/after comparisons are actual only when captured from PostgreSQL mode. A demonstration with no traffic or too few requests can have zero/weak measurements; do not infer zero downtime from it. The app does not currently export metrics to CloudWatch.

## API routes

- `GET /api/health`
- `GET /api/metrics`
- `GET /api/users?page=1&pageSize=10&search=`
- `POST /api/users` with `{ "name": "Maya Chen", "email": "maya@example.com" }`
- `GET /api/migration/status`
- `POST /api/migration/run`
- `POST /api/migration/validate`
- `POST /api/migration/contract` with `{ "confirmContract": "DROP_LEGACY_NAME", "legacyClientsRetired": true }`
- `GET /api/report`

POSTGRESQL operations use positional parameters for untrusted input. Migration status column names are chosen only from internal booleans derived from `information_schema` checks.

## Load testing

With the API running, install k6 using the official instructions for your operating system, then run:

```sh
k6 run loadtest/cloudshift.js
```

To target another API instance, provide `API_URL`, for example `API_URL=https://your-api.example.com k6 run loadtest/cloudshift.js` (PowerShell: `$env:API_URL='https://your-api.example.com'; k6 run loadtest/cloudshift.js`). Run only against systems you own and have permission to test. The default test ramps to 10 virtual users and records HTTP latency/failures. Run it before, during, and after migration to produce comparable test results; keep duration, virtual users, network, and dataset constant. CloudShift does not claim zero downtime based on a passing threshold.

## AWS architecture and deployment checklist

This repository contains application code and deployment guidance; it does not create AWS resources or verify a deployment.

- [ ] Create an RDS PostgreSQL instance in private subnets; configure security groups so only the backend can reach port 5432. Create database credentials in AWS Secrets Manager, not in source control.
- [ ] Configure an App Runner service from this repository with the backend build/start configuration, `PORT`, database URL supplied securely, RDS CA bundle and TLS settings, and health check path `/api/health`. Restrict CORS to the deployed frontend origin.
- [ ] For production migrations, use a database role with only required privileges, test expand/backfill/contract on a restored staging snapshot, retain backups/PITR, and roll out old/new clients deliberately. Do not run contract until all old consumers are retired.
- [ ] Configure CloudWatch logs and alarms for App Runner and RDS. To publish application-level request/latency/migration metrics, implement and configure a backend CloudWatch exporter/SDK integration and IAM permissions; none is active in this starter.
- [ ] Build the frontend with `npm run build` and deploy `dist/` to S3 + CloudFront (or another static hosting service). Configure the frontend's `/api` routing to the backend URL and use HTTPS.
- [ ] Configure domain, TLS, CORS, secrets, health checks, and alerting. Run authorized k6 tests against staging.
- [ ] Verify all service health, database connectivity, measured error/latency results, and deployment URLs before calling the app deployed.

App Runner can run `node server/index.js` from the repository root for a basic single-service deployment, but the Vite frontend should be served separately in production. This starter does not include infrastructure-as-code, automatic database migrations on deploy, IAM setup, or a CloudWatch exporter; those require AWS choices and environment configuration.

## Feature checklist

**Implemented in code:** demo mode with clear simulated labels; operational dashboard; user management; virtual 100,000-row demo dataset; PostgreSQL schema bootstrap; 100k seed script; expand-and-contract flow; batched backfill; dual writes during expand; consistency checks; live API serving during migration; local API measurements; migration log and JSON report; k6 script; responsive loading/error states; secret exclusion and TLS verification safeguards.

**Requires your setup or further verification:** npm dependency installation; local PostgreSQL or RDS credentials/resources; seed command against a disposable database; actual k6 run; AWS App Runner, RDS, S3/CloudFront resources and IAM; CloudWatch application metrics integration; production measurement and downtime conclusions. No AWS resource or deployment is created by this project.
