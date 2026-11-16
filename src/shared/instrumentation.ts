import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

// Exporters are configured via environment variables (OTEL_EXPORTER_OTLP_*),
// so no traceExporter/metricReaders are passed here: passing them would
// override the env-based configuration.
const sdk = new NodeSDK({
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

let shuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  // Ctrl+C under tsx delivers SIGINT twice (terminal + tsx relay): ignore repeats
  // so the second one doesn't kill the process before spans are flushed.
  if (shuttingDown) return;
  shuttingDown = true;

  // Safety net: don't hang forever if the exporter can't reach the backend.
  setTimeout(() => {
    console.error("OpenTelemetry SDK shutdown timed out");
    process.exit(1);
  }, 5000).unref();

  try {
    await sdk.shutdown();
    console.log(`OpenTelemetry SDK shut down (${signal})`);
    process.exit(0);
  } catch (err) {
    console.error("Error shutting down OpenTelemetry SDK", err);
    process.exit(1);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
