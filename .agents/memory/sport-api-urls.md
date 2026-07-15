---
name: Sport API URLs
description: Phase 6 sport betting uses three separate service URLs, not the main retailApiUrl
---

Phase 6 sport betting flow uses three separate service base URLs:
- `sportIntegrationApiUrl` — for Payin, PayOut, GetPin, ManualProcessing, FetchConfiguration
- `sportDataProviderUrl`   — for getRandomEvent (Admin API, no BO auth needed, uses terminal token)
- `sportRiskApiUrl`        — for AuthorizeTicket (risk/compliance approval)

**Why:** These are separate microservices, not routes on the main retail API. The SOAP test uses three separate endpoint properties (sportintegrationpublic, sdpv3, sportriskpublic).

**How to apply:** Always call sport endpoints on `config.sportIntegrationApiUrl` etc., never on `config.baseUrl` or `config.virtualRaceApiUrl`. Env vars `SPORT_INTEGRATION_API_URL`, `SPORT_DATA_PROVIDER_URL`, `SPORT_RISK_API_URL` override the stage defaults.
