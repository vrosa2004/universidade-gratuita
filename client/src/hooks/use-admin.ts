import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

export function useCreateAdminUser() {
  return useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const res = await fetch(api.admin.createUser.path, {
        method: api.admin.createUser.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Erro ao criar administrador");
      return data;
    },
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: [api.admin.stats.path],
    queryFn: async () => {
      const res = await fetch(api.admin.stats.path);
      if (!res.ok) throw new Error("Failed to fetch admin stats");
      return res.json();
    },
  });
}

export function useAdminEnrollments() {
  return useQuery({
    queryKey: [api.admin.list.path],
    queryFn: async () => {
      const res = await fetch(api.admin.list.path);
      if (!res.ok) throw new Error("Failed to fetch enrollments");
      return res.json();
    },
  });
}

export function useUpdateEnrollmentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: 'pending' | 'in_analysis' | 'approved' | 'rejected' }) => {
      const url = buildUrl(api.admin.updateStatus.path, { id });
      const res = await fetch(url, {
        method: api.admin.updateStatus.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.admin.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.admin.stats.path] });
    },
  });
}
