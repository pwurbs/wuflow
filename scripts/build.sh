#!/bin/bash

# execute tests
go test ./...

# builds into the binary folder for local execution
go build -o bin/wutrak main.go
