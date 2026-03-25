import "dotenv/config";
import {
  type User,
  type InsertUser,
  type Enrollment,
  type InsertEnrollment,
  type Document,
  type InsertDocument,
  users,
  enrollments,
  documents,
} from "@shared/schema";
import { db, pool } from "./db";
import { eq } from "drizzle-orm";

export interface EnrollmentWithDetails extends Enrollment {
  documents: Document[];
  student: User | null;
}

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Enrollments
  getEnrollment(id: number): Promise<Enrollment | undefined>;
  getEnrollmentByStudent(studentId: number): Promise<Enrollment | undefined>;
  getEnrollments(): Promise<Enrollment[]>;
  createEnrollment(enrollment: InsertEnrollment & { studentId: number }): Promise<Enrollment>;
  updateEnrollment(id: number, updates: Partial<InsertEnrollment>): Promise<Enrollment>;
  updateEnrollmentStatus(id: number, status: string, systemDecision?: string): Promise<Enrollment>;

  // Documents
  getDocuments(enrollmentId: number): Promise<Document[]>;
  createDocument(doc: InsertDocument & { enrollmentId: number; url: string; ocrData?: unknown }): Promise<Document>;
  deleteDocument(id: number): Promise<void>;

  /** Fetch all enrollments together with their documents and students in 2 queries. */
  getEnrollmentsWithDetails(): Promise<EnrollmentWithDetails[]>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User> = new Map();
  private enrollments: Map<number, Enrollment> = new Map();
  private documents: Map<number, Document> = new Map();
  private currentUserId = 1;
  private currentEnrollmentId = 1;
  private currentDocumentId = 1;

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id, role: insertUser.role ?? 'student' };
    this.users.set(id, user);
    return user;
  }

  async getEnrollment(id: number): Promise<Enrollment | undefined> {
    return this.enrollments.get(id);
  }

  async getEnrollmentByStudent(studentId: number): Promise<Enrollment | undefined> {
    return Array.from(this.enrollments.values()).find(e => e.studentId === studentId);
  }

  async getEnrollments(): Promise<Enrollment[]> {
    return Array.from(this.enrollments.values());
  }

  async createEnrollment(insertEnrollment: InsertEnrollment & { studentId: number }): Promise<Enrollment> {
    const id = this.currentEnrollmentId++;
    const enrollment: Enrollment = {
      name: null,
      cpf: null,
      dateOfBirth: null,
      income: null,
      monthlyExpenses: null,
      incomeCategory: null,
      hasFormalEmploymentHistory: null,
      hasVariableIncome: null,
      isCompanyActive: null,
      hasProLabore: null,
      householdSize: null,
      perCapitaIncome: null,
      ...insertEnrollment,
      id,
      status: 'pending',
      systemDecision: null,
      createdAt: new Date(),
    };
    this.enrollments.set(id, enrollment);
    return enrollment;
  }

  async updateEnrollment(id: number, updates: Partial<InsertEnrollment>): Promise<Enrollment> {
    const existing = await this.getEnrollment(id);
    if (!existing) throw new Error("Not found");
    const updated = { ...existing, ...updates };
    this.enrollments.set(id, updated);
    return updated;
  }

  async updateEnrollmentStatus(id: number, status: string, systemDecision?: string): Promise<Enrollment> {
    const existing = await this.getEnrollment(id);
    if (!existing) throw new Error("Not found");
    const updated = { ...existing, status: status as any, systemDecision: systemDecision ?? existing.systemDecision };
    this.enrollments.set(id, updated);
    return updated;
  }

  async getDocuments(enrollmentId: number): Promise<Document[]> {
    return Array.from(this.documents.values()).filter(d => d.enrollmentId === enrollmentId);
  }

  async createDocument(insertDoc: InsertDocument & { enrollmentId: number; url: string; ocrData?: unknown }): Promise<Document> {
    const id = this.currentDocumentId++;
    const doc: Document = {
      ocrData: null,
      ...insertDoc,
      id,
      uploadedAt: new Date(),
    };
    this.documents.set(id, doc);
    return doc;
  }

  async deleteDocument(id: number): Promise<void> {
    this.documents.delete(id);
  }

  async getEnrollmentsWithDetails(): Promise<EnrollmentWithDetails[]> {
    const allEnrollments = Array.from(this.enrollments.values());
    return allEnrollments.map((e) => ({
      ...e,
      documents: Array.from(this.documents.values()).filter((d) => d.enrollmentId === e.id),
      student: this.users.get(e.studentId) ?? null,
    }));
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL storage (production)
// ---------------------------------------------------------------------------
export class DrizzleStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  // Enrollments
  async getEnrollment(id: number): Promise<Enrollment | undefined> {
    const [row] = await db.select().from(enrollments).where(eq(enrollments.id, id));
    return row;
  }

  async getEnrollmentByStudent(studentId: number): Promise<Enrollment | undefined> {
    const [row] = await db.select().from(enrollments).where(eq(enrollments.studentId, studentId));
    return row;
  }

  async getEnrollments(): Promise<Enrollment[]> {
    return db.select().from(enrollments);
  }

  async createEnrollment(enrollment: InsertEnrollment & { studentId: number }): Promise<Enrollment> {
    const [row] = await db.insert(enrollments).values(enrollment).returning();
    return row;
  }

  async updateEnrollment(id: number, updates: Partial<InsertEnrollment>): Promise<Enrollment> {
    const [row] = await db.update(enrollments).set(updates).where(eq(enrollments.id, id)).returning();
    if (!row) throw new Error("Enrollment not found");
    return row;
  }

  async updateEnrollmentStatus(id: number, status: string, systemDecision?: string): Promise<Enrollment> {
    const set: any = { status };
    if (systemDecision !== undefined) set.systemDecision = systemDecision;
    const [row] = await db.update(enrollments).set(set).where(eq(enrollments.id, id)).returning();
    if (!row) throw new Error("Enrollment not found");
    return row;
  }

  // Documents
  async getDocuments(enrollmentId: number): Promise<Document[]> {
    return db.select().from(documents).where(eq(documents.enrollmentId, enrollmentId));
  }

  async createDocument(doc: InsertDocument & { enrollmentId: number; url: string; ocrData?: unknown }): Promise<Document> {
    const [row] = await db.insert(documents).values(doc).returning();
    return row;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  /** Fetch all enrollments with their documents and students using a single JOIN query. */
  async getEnrollmentsWithDetails(): Promise<EnrollmentWithDetails[]> {
    // Single pool.query() with LEFT JOINs — works under any PgBouncer pool mode because
    // the entire operation is one auto-committed transaction that never needs to hold a
    // connection across multiple round-trips.

    const sql = `
      SELECT
        e.id,
        e.student_id       AS "studentId",
        e.status,
        e.name,
        e.cpf,
        e.date_of_birth    AS "dateOfBirth",
        e.income,
        e.monthly_expenses AS "monthlyExpenses",
        e.income_category  AS "incomeCategory",
        e.has_formal_employment_history AS "hasFormalEmploymentHistory",
        e.has_variable_income           AS "hasVariableIncome",
        e.is_company_active             AS "isCompanyActive",
        e.has_pro_labore                AS "hasProLabore",
        e.household_size   AS "householdSize",
        e.per_capita_income AS "perCapitaIncome",
        e.system_decision  AS "systemDecision",
        e.created_at       AS "createdAt",
        row_to_json(u.*) AS student_json,
        COALESCE(
          json_agg(
            json_build_object(
              'id',           d.id,
              'enrollmentId', d.enrollment_id,
              'type',         d.type,
              'name',         d.name,
              'url',          d.url,
              'ocrData',      d.ocr_data,
              'uploadedAt',   d.uploaded_at
            ) ORDER BY d.id
          ) FILTER (WHERE d.id IS NOT NULL),
          '[]'::json
        ) AS documents_json
      FROM enrollments e
      LEFT JOIN users u ON u.id = e.student_id
      LEFT JOIN documents d ON d.enrollment_id = e.id
      GROUP BY e.id, u.id
      ORDER BY e.id DESC
    `;

    const result = await pool.query(sql);

    return result.rows.map((row: any) => {
      const { student_json, documents_json, ...enrollment } = row;
      return {
        ...enrollment,
        student: student_json ?? null,
        documents: documents_json ?? [],
      };
    });
  }
}

export const storage: IStorage = process.env.DATABASE_URL
  ? new DrizzleStorage()
  : new MemStorage();
