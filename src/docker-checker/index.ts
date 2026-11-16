import { SpanStatusCode, trace } from "@opentelemetry/api";
import express, { type Express } from "express";
import { request } from "node:http";

const PORT: number = Number(process.env.PORT || "3001");

const app: Express = express();
const tracer = trace.getTracer("homelab-hsm");

type DockerContainer = {
  Names: string[];
  State: string;
  Health?: { Status: string };
};

type ContainerStatus = { name: string; state: "up" | "degraded" | "down" };

const DOCKER_SOCKET_PATH =
  process.env.DOCKER_SOCKET_PATH || "/var/run/docker.sock";

const dockerGet = <T>(path: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const req = request(
      { socketPath: DOCKER_SOCKET_PATH, path, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(
              new Error(
                `Docker API ${path} responded ${res.statusCode}: ${body}`,
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

const toStatus = (c: DockerContainer): ContainerStatus => {
  const name = (c.Names[0] ?? "unknown").replace(/^\//, "");
  if (c.State !== "running") return { name, state: "down" };
  if (c.Health?.Status === "unhealthy") return { name, state: "degraded" };
  return { name, state: "up" };
};

const getContainers = async (): Promise<ContainerStatus[]> => {
  const containers = await dockerGet<DockerContainer[]>(
    "/containers/json?all=true",
  );
  return containers.map(toStatus);
};

app.get("/check", async (req, res) => {
  // Should print the W3C trace context sent by the gateway.
  console.log("traceparent:", req.headers.traceparent);

  await tracer.startActiveSpan("docker-check", async (span) => {
    try {
      span.setAttribute("check.type", "docker");
      const containers = await getContainers();
      const down = containers.filter((c) => c.state === "down");
      const degraded = containers.filter((c) => c.state === "degraded");
      span.setAttribute("check.containers.degraded", degraded.length);

      span.setAttribute("check.containers.total", containers.length);
      span.setAttribute("check.containers.down", down.length);
      if (down.length > 0) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `${down.length} container(s) down`,
        });
      }

      const status = down.length || degraded.length ? "degraded" : "ok";
      res.send({ status, containers });
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
