import { createServer } from "node:http";

import { requestHandler } from "./app.js";

const defaultPort = 3000;
const host = "0.0.0.0";

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return defaultPort;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `PORT must be an integer between 1 and 65535. Received: ${value}`,
    );
  }

  return port;
}

const port = readPort(process.env.PORT);
const server = createServer(requestHandler);

server.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});

server.on("error", (error) => {
  console.error("Server error:", error);
  process.exitCode = 1;
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`${signal} received. Shutting down.`);

  server.close((error) => {
    if (error !== undefined) {
      console.error("Shutdown error:", error);
      process.exitCode = 1;
      return;
    }

    console.log("Server stopped.");
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
