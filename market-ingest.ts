import { createFileRoute } from "@tanstack/react-router";

// Scheduled market-data ingestion: provider -> validate -> normalize -> upsert into market_data.
//
// Called by a scheduler (see AGENTS.md), NOT by the browser. Every request must carry
// `Authorization: Bearer <LOVABLE_CRON_SECRET>`; authentication is done by the existing
// cron-auth.ts helper (constant-time compare). The path is under /api/public only in the sense
// that it is outside the user-session auth middleware — the cron secret is the gate.
//
// All logic lives in src/lib/market-ingest-handler.server.ts (unit-tested). It is imported lazily
// inside the handler so nothing provider- or service-role-related reaches a client bundle.
export const Route = createFileRoute("/api/public/market-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleIngestRequest } = await import("@/lib/market-ingest-handler.server");
        return handleIngestRequest(request);
      },
    },
  },
});
