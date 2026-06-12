# CLAUDE.md - European Energy Hub

Standalone live web app, target domain **energy.lbzgiu.xyz**. Two co-equal dashboards:
**/gas** (EU gas storage choropleth, AGSI+) and **/power** (day-ahead price choropleth
by ENTSO-E bidding zone), bridged by spark/dark spread analytics. Sister site to
freight.lbzgiu.xyz, same stack and conventions.

**Active build plan: [`docs/ROADMAP.md`](docs/ROADMAP.md).** Read it at the start of
every session, find the first unchecked task, and execute. It contains the locked
stack, complete data model, API surface, phase checklists, and execution notes.

Status: pre-build (roadmap written 2026-06-12, nothing implemented yet).

Reference implementation for all structural questions: `~/quant/freight/`.
