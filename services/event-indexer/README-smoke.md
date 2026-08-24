# Event Indexer — Manual Smoke Test

This guide walks through verifying the indexer end-to-end against a local
Stellar standalone node spun up via Docker Compose.

## Prerequisites

- Docker + Docker Compose installed
- `stellar` CLI installed (`cargo install stellar-cli`)
- Node.js 20+ installed

---

## 1 — Start the local stack

```bash
# From the repository root
docker compose -f docker-compose.indexer.yml up -d
```

Wait for all services to be healthy:

```bash
docker compose -f docker-compose.indexer.yml ps
```

Expected: `stellar`, `postgres`, `indexer` all showing `healthy` or `running`.

---

## 2 — Deploy contracts

```bash
# Inside the contracts toolchain container (or locally if Stellar CLI is installed)
bash scripts/deploy.sh veritoken-dev
```

This writes contract IDs to `frontend/.env`. Copy the relevant IDs:

```bash
cat frontend/.env | grep _ID
```

---

## 3 — Configure the indexer

```bash
cp services/event-indexer/.env.example services/event-indexer/.env
```

Edit `services/event-indexer/.env`:

```dotenv
RPC_URL=http://localhost:8000/soroban/rpc
CONTRACT_IDS=rwa:<VITE_RWA_TOKEN_ID>,kyc:<VITE_KYC_REGISTRY_ID>,compliance:<VITE_COMPLIANCE_ENGINE_ID>
DATABASE_URL=postgres://veritoken:veritoken@localhost:5432/veritoken_indexer
```

Restart the indexer container (or run locally):

```bash
docker compose -f docker-compose.indexer.yml restart indexer
# or
cd services/event-indexer && npm run dev
```

---

## 4 — Emit some events

Use the Stellar CLI to mint tokens and trigger KYC operations:

```bash
# Approve a KYC subject
stellar contract invoke --network standalone \
  --id <KYC_REGISTRY_ID> --source admin \
  -- approve \
  --verifier <ADMIN_ADDR> --subject <HOLDER_ADDR> \
  --tier 1 --expiry 1893456000 --jurisdiction US

# Mint tokens (triggers a `mint` event on the rwa-token contract)
stellar contract invoke --network standalone \
  --id <RWA_TOKEN_ID> --source admin \
  -- mint \
  --caller <ADMIN_ADDR> --to <HOLDER_ADDR> --amount 1000000000

# Transfer tokens (triggers a `transfer` event)
stellar contract invoke --network standalone \
  --id <RWA_TOKEN_ID> --source holder \
  -- transfer \
  --from <HOLDER_ADDR> --to <RECIPIENT_ADDR> --amount 100000000
```

---

## 5 — Verify indexer health

After ~60 seconds:

```bash
curl -s http://localhost:3001/health | jq .
```

Expected output:

```json
{
  "status": "ok",
  "lag_seconds": 0,
  "cursors": {
    "<RWA_TOKEN_ID>": "000...0-0",
    "<KYC_REGISTRY_ID>": "000...0-0"
  }
}
```

`lag_seconds < 10` confirms the indexer is keeping up.

---

## 6 — Query indexed events

```bash
# All events for the RWA token contract
curl -s "http://localhost:3001/events?contractId=<RWA_TOKEN_ID>&pageSize=20" | jq .

# Filter by type
curl -s "http://localhost:3001/events?contractId=<RWA_TOKEN_ID>&type=mint" | jq .

# KYC subjects expiring within 24 hours
curl -s "http://localhost:3001/kyc/pending-expiry?within_seconds=86400" | jq .

# Compliance violations
curl -s "http://localhost:3001/compliance/violations?contractId=<COMPLIANCE_ID>" | jq .
```

---

## 7 — Restart idempotency test

Stop and restart the indexer, then verify event count does not increase:

```bash
count_before=$(curl -s "http://localhost:3001/events" | jq '.total')
docker compose -f docker-compose.indexer.yml restart indexer
sleep 15
count_after=$(curl -s "http://localhost:3001/events" | jq '.total')
echo "Before: $count_before  After: $count_after"
# count_after should equal count_before (no duplicates replayed)
```

---

## 8 — Acceptance checklist

| Check | Command | Expected |
|---|---|---|
| Events indexed after 60 s | `GET /events?contractId=<rwa>` | Returns all emitted events |
| KYC expiry query | `GET /kyc/pending-expiry?within_seconds=86400` | Returns subjects expiring within 24 h |
| Health lag | `GET /health` | `lag_seconds < 10` |
| Restart idempotency | Restart then re-query | Event count unchanged |
| Frontend hook | Set `VITE_INDEXER_URL` in `frontend/.env`, reload | `useEventQuery` data served from indexer |
