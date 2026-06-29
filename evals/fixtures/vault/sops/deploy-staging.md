---
type: sop
title: Deploy staging
uses: [linear.create_issue]
---
Deploy staging with `fly deploy -a acme-staging`. Then smoke-test with `npm run smoke`.
