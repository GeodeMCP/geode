---
type: note
title: Paxon deploy notes
---
Paxon staging is deployed via `kubectl apply -f k8s/staging/`. Run `make smoke` after each deploy to verify the gateway responds.
