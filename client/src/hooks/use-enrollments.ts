import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertEnrollment, type Enrollment } from "@shared/schema";

export function useMyEnrollment() {
  return useQuery({
    queryKey: [api.enrollments.my.path],
    queryFn: async () => {
      const res = await fetch(api.enrollments.my.path);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch enrollment");
      return res.json();
    },
  });
}

export function useCreateEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertEnrollment) => {
      const res = await fetch(api.enrollments.create.path, {
        method: api.enrollments.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create enrollment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.enrollments.my.path] });
    },
  });
}

export function useUpdateEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<InsertEnrollment> }) => {
      const url = buildUrl(api.enrollments.update.path, { id });
      const res = await fetch(url, {
        method: api.enrollments.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update enrollment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.enrollments.my.path] });
    },
  });
}

export function useSubmitEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.enrollments.submit.path, { id });
      const res = await fetch(url, { method: api.enrollments.submit.method });
      if (!res.ok) throw new Error("Failed to submit enrollment");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.enrollments.my.path] });
    },
  });
}
