import { trace } from "@opentelemetry/api";
import express, { type Express } from "express";

const PORT: number = Number(process.env.PORT || "3000");
const DOCKER_CHECKER_URL: string =
  process.env.DOCKER_CHECKER_URL || "http://localhost:3001";

const app: Express = express();
const tracer = trace.getTracer("homelab-hsm");

app.get("/health", async (_req, res) => {
  // Outgoing fetch is auto-instrumented (undici): it creates a CLIENT span and
  // injects the `traceparent` header, so docker-checker continues this trace.
  try {
    const response = await fetch(`${DOCKER_CHECKER_URL}/check`, {
      signal: AbortSignal.timeout(5000),
    });
    const docker = await response.json();

    res.send({ status: response.ok ? "ok" : "degraded", checks: { docker } });
  } catch (err) {
    // The CLIENT span is already marked as error by the instrumentation;
    // here we only report the degraded state to the caller.
    res.status(502).send({
      status: "degraded",
      checks: { docker: { error: (err as Error).message } },
    });
  }
});

// Keep the self check as an example of a manual INTERNAL span.
app.get("/self", (_req, res) => {
  tracer.startActiveSpan("self-check", (span) => {
    span.setAttribute("check.type", "self");
    span.end();
  });
  res.send({ status: "ok" });
});

const server = app.listen(PORT, () => {
  console.log(`gateway running at http://localhost:${PORT}`);
});
