---
id: echo-tool
name: Echo Tool
type: cli
description: Trivial echo fixture for Docker integration tests
image:
  base: node:20-slim
requires:
  - TOKEN
connections:
  - label: default
install:
  - "echo IyEvYmluL3NoCmNhc2UgIiQxIiBpbgogIC0tdXJsKSBlY2hvICJ7XCJ1cmxcIjpcIiQyXCJ9IiA7OwogIC0tdG9rZW4pIGVjaG8gIntcInRva2VuXCI6XCIkVE9LRU5cIn0iIDs7CiAgLS1uZXQtY2hlY2spIG5vZGUgLWUgInJlcXVpcmUoJ2h0dHAnKS5nZXQoJ2h0dHA6Ly8xLjEuMS4xJyxmdW5jdGlvbigpe3Byb2Nlc3MuZXhpdCgwKX0pLm9uKCdlcnJvcicsZnVuY3Rpb24oKXtwcm9jZXNzLmV4aXQoMSl9KSIgOzsKICAqKSBlY2hvICd7Im9rIjp0cnVlfScgOzsKZXNhYwo= | base64 -d > /usr/local/bin/echo-tool"
  - "chmod +x /usr/local/bin/echo-tool"
bin: /usr/local/bin/echo-tool
permissions:
  network: none
limits:
  timeoutMs: 30000
  memoryMb: 256
actions:
  fetch:
    description: Echo the url param as JSON
    params:
      - name: url
        required: true
    command: ["--url", "${params.url}"]
  token-check:
    description: Echo the TOKEN env var to confirm credential injection
    command: ["--token"]
  net-check:
    description: Attempt a network connection (should fail with network none)
    command: ["--net-check"]
---
