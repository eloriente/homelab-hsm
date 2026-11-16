import { SpanStatusCode, trace } from "@opentelemetry/api";
import express, { type Express } from "express";

const PORT: number = Number(process.env.PORT || "3001");

const app: Express = express();
const tracer = trace.getTracer("homelab-hsm");

type ContainerStatus = { name: string; state: "up" | "down" };

// TODO: replace with a real query to the Docker socket
// (/var/run/docker.sock, GET /containers/json?all=true).
const getContainers = async (): Promise<ContainerStatus[]> => [
  { name: "elasticsearch", state: "up" },
  { name: "kibana", state: "up" },
  { name: "apm-server", state: "up" },
];

app.get("/check", async (req, res) => {
  // Should print the W3C trace context sent by the gateway.
  console.log("traceparent:", req.headers.traceparent);

  await tracer.startActiveSpan("docker-check", async (span) => {
    try {
      span.setAttribute("check.type", "docker");
      const containers = await getContainers();
      const down = containers.filter((c) => c.state === "down");

      span.setAttribute("check.containers.total", containers.length);
      span.setAttribute("check.containers.down", down.length);
      if (down.length > 0) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `${down.length} container(s) down`,
        });
      }

      res.send({ status: down.length ? "degraded" : "ok", containers });
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      res.status(500).send({ status: "error" });
    } finally {
      span.end();
    }
  });
});

const server = app.listen(PORT, () => {
  console.log(`docker-checker running at http://localhost:${PORT}`);
});
