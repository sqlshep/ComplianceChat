# ComplianceChat

A **local** prototype that answers U.S. federal travel / per‑diem **compliance** questions and
validates travel claims, grounded in ingested GSA / Federal Travel Regulation (FTR) sources with
**citations** and persisted **decision records**. It uses **real AWS services** for the main
workflow:

| Concern | AWS service |
| --- | --- |
| Source PDFs, extracted JSON, decision evidence | **S3** (versioning enabled) |
| Hybrid (vector + lexical) retrieval | **OpenSearch Serverless** |
| Embeddings, generation, evaluation, guardrails | **Bedrock** |
| Controls, rates, decision metadata | **DynamoDB** |

This is a prototype intended to run locally from your machine. **It is not deployed.** There is no
ECS/Fargate/Amplify/ALB/Cognito/Step Functions/Docker/IaC — by design.

---

## Architecture

For a detailed design walkthrough (components, AWS resources, data model, pipelines, diagrams),
see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

```
packages/
  shared/      Config, types, AWS clients, Bedrock/OpenSearch/Dynamo/S3, RAG + compliance engine
  backend/     Fastify API (localhost only): /api/chat, /api/validate, /api/decisions, /api/health
  ingestion/   TypeScript CLI (run manually): bootstrap, ingest, seed, seed-perdiem, seed-zip, check, eval, ask, validate
  frontend/    React + Vite SPA (Vite dev proxy → backend; browser never touches AWS)
eval/          Evaluation cases (cases.jsonl)
fixtures/      Clearly-labeled OFFLINE test fixtures (never a runtime fallback)
data/          Source documents (e.g. the FTR PDF, GSA per-diem xlsx flat files)
```

- **All AWS calls happen in the backend or the ingestion CLI.** The browser only talks to the
  backend through the Vite dev proxy; **no AWS credentials are ever exposed to the frontend.**
- Servers bind to **`127.0.0.1`** only.

---

## Prerequisites

- Node.js ≥ 20, npm ≥ 10
- AWS CLI v2 (recent — needs `bedrock` / `opensearchserverless` and modern SSO).
  On macOS/Apple Silicon: `brew install awscli`.
- Access to an AWS account with S3, DynamoDB, Bedrock (model access for the configured models),
  and OpenSearch Serverless.

---

## AWS authentication (IAM Identity Center / SSO)

Credentials are resolved by the **AWS SDK default credential provider chain** using a named
profile. **No long-lived access keys**; nothing is committed. Configure an Identity Center
profile, e.g. in `~/.aws/config`:

```ini
[sso-session mycompany]
sso_start_url = https://<your-portal>.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access

[profile compliancechat-app]
sso_session = mycompany
sso_account_id = <account-id>
sso_role_name = <permission-set>        # app runtime (least privilege)
region = us-east-1

[profile compliancechat-ingest]
sso_session = mycompany
sso_account_id = <account-id>
sso_role_name = <permission-set>        # ingestion (separate where practical)
region = us-east-1
```

Then log in (per profile, or once per shared `sso-session`):

```bash
aws sso login --profile compliancechat-app
# or: aws sso login --sso-session mycompany
```

Set `AWS_PROFILE` (app) and `AWS_PROFILE_INGEST` (ingestion) in `.env` to those profile names.
Use **separate profiles/roles** for app vs. ingestion where practical.

---

## Configuration

Copy the example and fill in your real resource names (the file is gitignored; **placeholders
only** live in `.env.example`):

```bash
cp .env.example .env
```

Keys: region, profiles, three S3 buckets, three DynamoDB tables, the OpenSearch Serverless
collection endpoint + index name, Bedrock model IDs, and the guardrail id/version.

---

## Manual AWS resource setup

> Do **not** create paid resources without authorization. OpenSearch Serverless in particular
> bills OCU‑minutes continuously. These commands create the resources this app expects. Replace
> `<profile>`, `<acct>`, and names to taste, then mirror them into `.env`.

**1) S3 buckets (versioned, private, encrypted):**

```bash
for s in source extracted evidence; do
  B=compliancechat-$s-<acct>
  aws s3api create-bucket --bucket $B --region us-east-1 --profile <profile>
  aws s3api put-bucket-versioning --bucket $B --versioning-configuration Status=Enabled --profile <profile>
  aws s3api put-public-access-block --bucket $B --profile <profile> \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
done
```

**2) DynamoDB tables (on-demand):**

```bash
aws dynamodb create-table --profile <profile> --table-name compliancechat-controls \
  --attribute-definitions AttributeName=controlId,AttributeType=S AttributeName=version,AttributeType=S AttributeName=status,AttributeType=S \
  --key-schema AttributeName=controlId,KeyType=HASH AttributeName=version,KeyType=RANGE \
  --global-secondary-indexes '[{"IndexName":"status-index","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"controlId","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST

aws dynamodb create-table --profile <profile> --table-name compliancechat-rates \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE --billing-mode PAY_PER_REQUEST

aws dynamodb create-table --profile <profile> --table-name compliancechat-decisions \
  --attribute-definitions AttributeName=decisionId,AttributeType=S AttributeName=entityType,AttributeType=S AttributeName=createdAt,AttributeType=S \
  --key-schema AttributeName=decisionId,KeyType=HASH \
  --global-secondary-indexes '[{"IndexName":"created-index","KeySchema":[{"AttributeName":"entityType","KeyType":"HASH"},{"AttributeName":"createdAt","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
  --billing-mode PAY_PER_REQUEST
```

**3) Bedrock:** enable model access for the embedding + generation models in the Bedrock console,
then create a guardrail (content filters + contextual grounding) and publish a version; put its id
and version in `.env`. Newer Anthropic models require an **inference profile** id (e.g.
`us.anthropic.claude-...`) for `BEDROCK_GENERATION_MODEL_ID`.

**4) OpenSearch Serverless** (encryption + network + data-access policies, then collection). The
network endpoint is **public but never anonymous** — access is gated by a data-access policy
scoped to your IAM principal (SigV4). If you instead make the collection **private**, the
localhost client cannot reach it directly — connect over a VPN/SSH tunnel/port-forward to the VPC
endpoint. See `scripts`/README history for the exact `aws opensearchserverless` policy + collection
commands. Finally create the index: `npm run bootstrap`.

---

## Developer commands

```bash
npm install                      # install all workspaces

# Run frontend + backend together (localhost)
npm run dev                      # frontend :5173 (proxy) + backend :8787

# Ingest a PDF (manual, local)
npm run bootstrap                       # create the OpenSearch index
npm run seed                            # seed controls + sample per-diem/M&IE rates into DynamoDB

# Load an official GSA per-diem flat file (xlsx) into the rates table.
# Drop the file in data/ and point the loader at it; --fiscal-year tags the rows.
# Add --upload to also store the source file in the versioned S3 source bucket.
npm run seed:perdiem -- "$PWD/data/FY2027_PerDiemRates_Validated090126.xlsx" --fiscal-year 2027

# Load the GSA ZIP-code per-diem crosswalk (~40k ZIPs -> destination + lodging).
# Fiscal year is read from the file (override with --fiscal-year). Lodging only;
# M&IE is joined from the destination rows at lookup time.
npm run seed:zip -- "$PWD/data/FY2027PerDiemZipCode_Validated090126.xlsx"

npm run ingest -- data/CFR-2021-title41-vol4.pdf \
  --doc-id ftr-2021 --title "Federal Travel Regulation (July 1, 2021 edition)" \
  --edition "2021-07-01" --source-url https://www.gsa.gov/...

# Check AWS connectivity + permissions (real calls)
npm run check

# Run evaluation cases end-to-end (real AWS)
npm run eval

# Ask / validate from the CLI
npm run cli -- ask "Are lodging taxes included in the CONUS per diem rate?"
npm run cli -- validate --claim '{"location":"Washington","state":"DC","fiscalYear":2025,"nights":3,"lodgingCostPerNight":300,"travelDays":4,"providedMeals":{"breakfast":1,"lunch":0,"dinner":0}}'

# Type checks and tests
npm run typecheck
npm run test
```

---

## How the requirements are met

- **Document versioning** — source PDFs land in a versioned S3 bucket; the S3 `versionId` is
  captured and stored on every chunk and on the extracted-JSON manifest, and used as the citation
  version. Controls are versioned in DynamoDB (`controlId` + `version`).
- **Retrieval** — hybrid: Bedrock Titan embeddings + OpenSearch kNN, fused with BM25 via
  Reciprocal Rank Fusion.
- **Compliance validation** — a deterministic engine checks a claim against seeded per-diem rates,
  the M&IE breakdown table, and active controls (lodging ceiling / 300% actual expense, first/last
  day 75%, provided-meal deductions, lodging taxes, receipts).
- **Citations** — every answer and finding carries citations (doc title, version, section/page,
  source URL, snippet).
- **Decision records** — every chat answer and validation writes full evidence JSON to the S3
  evidence bucket and queryable metadata to the DynamoDB decisions table.
- **Guardrails** — generation runs through a Bedrock guardrail (content filters + contextual
  grounding) with the retrieved context tagged as the grounding source.

## Sample questions to try

Paste these into the **Ask** tab (or `npm run cli -- ask "…"`):

1. Are lodging taxes included in the CONUS per diem rate, and how are they reimbursed?
2. What percentage of the M&IE rate do I get on the first and last day of travel?
3. What should I do if there are no hotels available at the per diem rate?
4. How much of per diem can my agency authorize under actual expense when lodging is unavailable?
5. When am I required to provide receipts for travel expenses?
6. What counts as an incidental expense under the per diem allowance?
7. Can I shift unused lodging per diem into my meal allowance to pay for a nicer dinner?
8. Do I get a meal reimbursement for one-day travel away from my duty station?
9. If the government provides lunch at a conference, how does that affect my M&IE?
10. Who sets the per diem rates for Alaska, Hawaii, and foreign locations?

Rate-specific questions (answered from the structured GSA rate data, cited as source [1]):

11. What is the per diem in New York City?
12. What is the lodging and M&IE per diem for ZIP code 20001?
13. What is the FY2027 Standard CONUS per diem rate?

## Data sources

- Federal Travel Regulation (FTR) — GSA (historical July 1, 2021 annual edition PDF in `data/`).
- Per Diem FAQs — <https://www.gsa.gov/travel/plan-a-trip/per-diem-rates/faqs>
- M&IE Breakdowns — <https://www.gsa.gov/travel/plan-a-trip/per-diem-rates/mie-breakdowns>
- Per Diem Rates — <https://www.gsa.gov/travel/plan-book/per-diem-rates>
- Per Diem API — <https://open.gsa.gov/api/perdiem/>

Seeded rate values in `packages/ingestion/seed/` are **sample fixtures**. For authoritative,
location-specific rates, download the official GSA per-diem flat file (xlsx) from the Per Diem
Rates page, drop it in `data/`, and load it with `npm run seed:perdiem` (see Developer commands).
The current `data/FY2027_PerDiemRates_Validated090126.xlsx` is the GSA **FY2027** flat file and
is loaded as the FY2027 rate set (287 destinations + the Standard CONUS fallback of $113 / $68).
The loader collapses seasonal rows to one row per destination using the **maximum** lodging rate,
and the validator matches a claim location by exact name first, then a case-insensitive partial
match (e.g. "New York" → "New York City"), falling back to Standard CONUS when nothing matches.
Note GSA lists the capital as **"District of Columbia"**, so typing "Washington" resolves to the
Standard CONUS fallback.

The GSA **ZIP-code crosswalk** (`data/FY2027PerDiemZipCode_Validated090126.xlsx`, ~40k ZIPs) is
loaded with `npm run seed:zip` into the same rates table as `ZIP#<FY>#<zip>` rows (lodging only —
the file has no M&IE). In the **Validate** form, entering a ZIP code looks it up via
`GET /api/rates/zip`, auto-fills the destination + state, and joins M&IE from that destination's
per-diem row (falling back to Standard CONUS M&IE if the destination isn't found).

## Security & configuration

- **No secrets in the repo.** `.env` is gitignored; copy [`.env.example`](./.env.example) (placeholders
  only) to `.env` and fill it in locally. AWS access uses the default credential provider chain
  (IAM Identity Center / SSO or a named profile) — **no access keys** in code or config.
- All AWS calls run in the backend or ingestion CLI; the browser never receives credentials.
- Resource names, account, region, model IDs, and guardrail identifiers are all configurable.

## Disclaimer

This is a **prototype for reference/education only** — not individualized legal, financial, or
travel-policy advice. Per-diem and FTR content derive from public GSA sources (see **Data sources**)
and may be out of date; always confirm against the official GSA Per Diem Rates and the current
Federal Travel Regulation. The U.S. Government documents in `data/` are public-domain works of the
U.S. Government; this project is not affiliated with or endorsed by GSA.

## License

[MIT](./LICENSE) © 2026 Shep Sheppard.
