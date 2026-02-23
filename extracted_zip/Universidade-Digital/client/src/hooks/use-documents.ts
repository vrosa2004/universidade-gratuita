import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: z.infer<typeof api.documents.upload.input> }) => {
      const url = buildUrl(api.documents.upload.path, { id });
      const res = await fetch(url, {
        method: api.documents.upload.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to upload document");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.enrollments.my.path] });
      queryClient.invalidateQueries({ queryKey: [api.admin.list.path] });
    },
  });
}
