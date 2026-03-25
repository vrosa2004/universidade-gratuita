import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { ensureSchemaCompatibility } from "./db";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function sanitizeForLog(value: unknown): unknown {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return {
      _type: "array",
      count: value.length,
    };
  }

  if (typeof value !== "object") {
    if (typeof value === "string" && value.length > 200) {
      return `${value.slice(0, 200)}...`;
    }
    return value;
  }

  const obj = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(obj)) {
    const lower = key.toLowerCase();

    if (lower === "base64content" || lower === "url" || lower === "rawbody") {
      sanitized[key] = "[omitted]";
      continue;
    }

    if (lower === "ocrdata") {
      const ocr = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : null;
      sanitized[key] = ocr
        ? {
            status: ocr.status,
            score_confianca: ocr.score_confianca,
            tipo_documento: ocr.tipo_documento,
          }
        : null;
      continue;
    }

    if (lower === "documents" || lower === "attachments") {
      const docs = Array.isArray(raw) ? raw : [];
      sanitized[key] = {
        count: docs.length,
      };
      continue;
    }

    if (Array.isArray(raw)) {
      sanitized[key] = {
        _type: "array",
        count: raw.length,
      };
      continue;
    }

    if (raw && typeof raw === "object") {
      sanitized[key] = sanitizeForLog(raw);
      continue;
    }

    if (typeof raw === "string" && raw.length > 200) {
      sanitized[key] = `${raw.slice(0, 200)}...`;
      continue;
    }

    sanitized[key] = raw;
  }

  return sanitized;
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const safeBody = sanitizeForLog(capturedJsonResponse);
        const serialized = JSON.stringify(safeBody);
        logLine += ` :: ${serialized.length > 1200 ? `${serialized.slice(0, 1200)}...` : serialized}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  ensureSchemaCompatibility().catch(() => {});
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
