# Incident timeline — Cedarline integration outage, 2 October 2026

All times Pacific.

| Time | Event |
|---|---|
| 06:12 | Cedarline Logistics begins returning errors on shipment-status requests. |
| 06:25 | Brightwater monitoring alerts on a 14% error rate for the Cedarline connector. |
| 06:40 | Severity 1 declared; on-call engineer starts investigating. |
| 07:05 | Cause identified: Cedarline changed an authentication token format without notice. |
| 07:30 | Workaround deployed: connector accepts both token formats. |
| 08:10 | Error rate back to normal; backlog of 1,860 shipment updates replayed. |
| 09:00 | Customer notifications sent to 23 affected workspaces. |

## Impact

- 23 workspaces saw delayed shipment statuses for up to 2 hours 58 minutes.
- Larkspur Foods was affected: about 310 status updates were delayed.
- No data was lost; all updates were replayed in order.

## Follow-ups

1. Agree a change-notice period with Cedarline (target: 14 days).
2. Add a contract test for the Cedarline token format.
3. Publish the incident on the status page.
