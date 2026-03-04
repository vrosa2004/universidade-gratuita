import { useMutation, useQuery } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { AttachmentContext } from "@shared/attachments";
import type { AttachmentDescriptor } from "@shared/attachments";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Hook: compute required attachments from the rules engine via the server
// Re-runs automatically whenever context values change.
// ---------------------------------------------------------------------------
export function useRequiredAttachments(ctx: Partial<AttachmentContext> | null) {
  return useQuery<AttachmentDescriptor[]>({
    queryKey: [api.attachments.required.path, ctx],
    enabled: !!ctx?.incomeCategory,
    queryFn: async () => {
      const res = await fetch(api.attachments.required.path, {
        method: api.attachments.required.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ctx),
      });
      if (!res.ok) throw new Error("Falha ao carregar lista de anexos");
      return res.json();
    },
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Hook: validate uploaded attachments for a given enrollment (pre-flight)
// ---------------------------------------------------------------------------
export function useValidateAttachments() {
  return useMutation({
    mutationFn: async (enrollmentId: number) => {
      const url = buildUrl(api.attachments.validate.path, { id: enrollmentId });
      const res = await fetch(url, { method: api.attachments.validate.method });
      if (!res.ok && res.status !== 422) throw new Error("Erro na validação");
      return res.json() as Promise<{ valid: boolean; missingMessage: string; missing: string[] }>;
    },
  });
}
