import { z } from 'zod';
import { insertUserSchema, insertEnrollmentSchema, insertDocumentSchema, users, enrollments, documents, DOCUMENT_TYPE_VALUES } from './schema';
import type { AttachmentContext } from './attachments';
import { INCOME_CATEGORIES } from './attachments';

export type { AttachmentContext };

const incomeCategoryEnum = Object.keys(INCOME_CATEGORIES) as [keyof typeof INCOME_CATEGORIES, ...(keyof typeof INCOME_CATEGORIES)[]];

export const api = {
  auth: {
    login: {
      method: 'POST' as const,
      path: '/api/auth/login' as const,
      input: z.object({ username: z.string(), password: z.string() }),
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: z.object({ message: z.string() }),
      }
    },
    register: {
      method: 'POST' as const,
      path: '/api/auth/register' as const,
      input: z.object({ username: z.string(), password: z.string(), role: z.enum(['student', 'admin']).optional() }),
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: z.object({ message: z.string() }),
      }
    },
    me: {
      method: 'GET' as const,
      path: '/api/auth/me' as const,
      responses: {
        200: z.custom<typeof users.$inferSelect>(),
        401: z.object({ message: z.string() }),
      }
    },
    logout: {
      method: 'POST' as const,
      path: '/api/auth/logout' as const,
      responses: {
        200: z.object({ message: z.string() }),
      }
    }
  },
  enrollments: {
    my: {
      method: 'GET' as const,
      path: '/api/enrollments/my' as const,
      responses: {
        200: z.custom<any>(), // EnrollmentWithDocs
      }
    },
    create: {
      method: 'POST' as const,
      path: '/api/enrollments' as const,
      input: insertEnrollmentSchema,
      responses: {
        201: z.custom<typeof enrollments.$inferSelect>(),
      }
    },
    update: {
      method: 'PUT' as const,
      path: '/api/enrollments/:id' as const,
      input: insertEnrollmentSchema.partial(),
      responses: {
        200: z.custom<typeof enrollments.$inferSelect>(),
      }
    },
    submit: {
      method: 'POST' as const,
      path: '/api/enrollments/:id/submit' as const,
      responses: {
        200: z.custom<typeof enrollments.$inferSelect>(),
      }
    }
  },
  documents: {
    upload: {
      method: 'POST' as const,
      path: '/api/enrollments/:id/documents' as const,
      input: z.object({
        type: z.enum(DOCUMENT_TYPE_VALUES),
        name: z.string(),
        base64Content: z.string()
      }),
      responses: {
        201: z.custom<typeof documents.$inferSelect>(),
      }
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/documents/:docId' as const,
      responses: {
        200: z.object({ message: z.string() })
      }
    }
  },
  attachments: {
    required: {
      method: 'POST' as const,
      path: '/api/attachments/required' as const,
      input: z.object({
        incomeCategory: z.enum(incomeCategoryEnum),
        income: z.number().default(0),
        monthlyExpenses: z.number().default(0),
        hasFormalEmploymentHistory: z.boolean().optional(),
        hasVariableIncome: z.boolean().optional(),
        isCompanyActive: z.boolean().optional(),
        hasProLabore: z.boolean().optional(),
      }),
      responses: {
        200: z.array(z.object({
          key: z.string(),
          label: z.string(),
          required: z.boolean(),
          condition: z.string().optional(),
          group: z.string().optional(),
        }))
      }
    },
    validate: {
      method: 'POST' as const,
      path: '/api/enrollments/:id/validate-attachments' as const,
      responses: {
        200: z.object({ valid: z.boolean(), missingMessage: z.string(), missing: z.array(z.string()) })
      }
    }
  },
  admin: {
    list: {
      method: 'GET' as const,
      path: '/api/admin/enrollments' as const,
      responses: {
        200: z.array(z.custom<any>()), // EnrollmentWithDocs & { student: User }
      }
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/admin/enrollments/:id/status' as const,
      input: z.object({ status: z.enum(['pending', 'in_analysis', 'approved', 'rejected']) }),
      responses: {
        200: z.custom<typeof enrollments.$inferSelect>(),
      }
    },
    stats: {
      method: 'GET' as const,
      path: '/api/admin/stats' as const,
      responses: {
        200: z.object({
          total: z.number(),
          pending: z.number(),
          inAnalysis: z.number(),
          approved: z.number(),
          rejected: z.number()
        })
      }
    },
    createUser: {
      method: 'POST' as const,
      path: '/api/admin/users' as const,
      input: z.object({ username: z.string().min(3), password: z.string().min(4) }),
      responses: {
        201: z.custom<typeof users.$inferSelect>(),
        400: z.object({ message: z.string() }),
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}