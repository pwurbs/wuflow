#!/bin/bash

# check code
go vet ./...

# execute tests and check coverage
go test -cover ./backend/...

# builds into the binary folder for local execution
go build -o bin/wutrak main.go
