import type { Instrumentation } from "next";

/** Server errors go to Admin → Errors, with an email alert (see src/lib/errors.ts). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("@/lib/errors");
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : null;
  await recordError({
    where: "server", message, digest, path: request.path,
    detail: { method: request.method, route: context.routePath, kind: context.routerKind, type: context.routeType, stack: err instanceof Error ? err.stack?.slice(0, 3000) : undefined },
  });
};
