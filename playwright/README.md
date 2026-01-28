# wuTrak

## Automated Regression Testing
This project uses **Playwright** for automated UI/DOM regression testing.

### Prerequisites
- Node.js installed
- Docker/Podman/Container (for running the containerized app)

### Setup
All commands in this section must be executed in the `playwright` directory.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Install Playwright browsers (locally):
   ```bash
   npx playwright install
   ```

### Running Tests
The tests run against a containerized instance of the application to ensure a clean state (ephemeral database).

1. **Start the Container**:
   ```bash
   container run -d -p 8080:8080 --name wutrak-test wutrak
   ```

2. **Run the Tests**:
   ```bash
   npm test
   ```

3. **Cleanup**:
   ```bash
   container stop wutrak-test && container rm wutrak-test
   ```

4. **Open Test Report**:
   ```bash
   open playwright-report/index.html
   ```

### VS Code Tasks
You can also use the defined VS Code tasks to run the full regression pipeline:
- **Run Regression Tests**: Executes the full sequence (Start -> Test -> Stop -> Open Report).
- **Start Test Container**: Starts the ephemeral DB container.
- **Run E2E Tests**: Runs the Playwright tests.
- **Stop Test Container**: Stops and removes the container.
- **Open Test Report**: Opens the HTML report in your default browser.
