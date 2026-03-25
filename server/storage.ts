import "dotenv/config";
import { type User, type InsertUser, type Enrollment, type InsertEnrollment, type Document, type InsertDocument, users, enrollments, documents } from "@shared/schema";
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

  /** Fetch all enrollments together with their documents and students. */
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
      address: null,
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
  private hasAddressColumnCached: boolean | null = null;
  private hasAddressColumnCheckedAt = 0;
  private fallbackAddressTableEnsured = false;

  private async hasAddressColumn(forceRefresh = false): Promise<boolean> {
    const now = Date.now();
    if (!forceRefresh && this.hasAddressColumnCached === true) return true;
    if (
      !forceRefresh &&
      this.hasAddressColumnCached === false &&
      now - this.hasAddressColumnCheckedAt < 30_000
    ) {
      return false;
    }

    const result = await pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'enrollments'
            AND column_name = 'address'
        ) AS ok
      `
    );

    this.hasAddressColumnCached = !!result.rows?.[0]?.ok;
    this.hasAddressColumnCheckedAt = now;
    return this.hasAddressColumnCached;
  }

  private async ensureAddressColumnIfNeeded(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("SET lock_timeout = '5000ms'");
      await client.query('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS address text');
      this.hasAddressColumnCached = true;
      this.hasAddressColumnCheckedAt = Date.now();
    } finally {
      client.release();
    }
  }

  private async ensureFallbackAddressTable(): Promise<void> {
    if (this.fallbackAddressTableEnsured) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS enrollment_addresses (
        enrollment_id integer PRIMARY KEY,
        address text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    this.fallbackAddressTableEnsured = true;
  }

  private async upsertFallbackAddress(enrollmentId: number, address: string): Promise<void> {
    await this.ensureFallbackAddressTable();
    await pool.query(
      `
        INSERT INTO enrollment_addresses (enrollment_id, address)
        VALUES ($1, $2)
        ON CONFLICT (enrollment_id)
        DO UPDATE SET address = EXCLUDED.address, updated_at = now()
      `,
      [enrollmentId, address],
    );
  }

  private buildEnrollmentSelectSql(whereClause = "", orderClause = ""): string {
    return `
      SELECT
        e.id,
        e.student_id AS "studentId",
        e.status,
        e.name,
        ${"${ADDRESS_EXPR}"} AS "address",
        e.cpf,
        e.date_of_birth AS "dateOfBirth",
        e.income,
        e.monthly_expenses AS "monthlyExpenses",
        e.income_category AS "incomeCategory",
        e.has_formal_employment_history AS "hasFormalEmploymentHistory",
        e.has_variable_income AS "hasVariableIncome",
        e.is_company_active AS "isCompanyActive",
        e.has_pro_labore AS "hasProLabore",
        e.household_size AS "householdSize",
        e.per_capita_income AS "perCapitaIncome",
        e.system_decision AS "systemDecision",
        e.created_at AS "createdAt"
      FROM enrollments e
      ${whereClause}
      ${orderClause}
    `;
  }

  private async selectEnrollments(whereClause = "", params: any[] = [], orderClause = ""): Promise<Enrollment[]> {
    const hasAddress = await this.hasAddressColumn();
    if (!hasAddress) {
      await this.ensureFallbackAddressTable();
    }
    const sql = this
      .buildEnrollmentSelectSql(whereClause, orderClause)
      .replace(
        "${ADDRESS_EXPR}",
        hasAddress
          ? "e.address"
          : "(SELECT ea.address FROM enrollment_addresses ea WHERE ea.enrollment_id = e.id)",
      );
    const result = await pool.query(sql, params);
    return result.rows as Enrollment[];
  }

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
    const rows = await this.selectEnrollments("WHERE e.id = $1", [id]);
    return rows[0];
  }

  async getEnrollmentByStudent(studentId: number): Promise<Enrollment | undefined> {
    const rows = await this.selectEnrollments("WHERE e.student_id = $1", [studentId]);
    return rows[0];
  }

  async getEnrollments(): Promise<Enrollment[]> {
    return this.selectEnrollments("", [], "ORDER BY e.id DESC");
  }

  async createEnrollment(enrollment: InsertEnrollment & { studentId: number }): Promise<Enrollment> {
    const values: any = { ...enrollment };
    const fallbackAddress = typeof values.address === "string" ? values.address : undefined;
    let hasAddress = await this.hasAddressColumn();
    if (!hasAddress && values.address != null) {
      try {
        await this.ensureAddressColumnIfNeeded();
        hasAddress = await this.hasAddressColumn(true);
      } catch {
        hasAddress = false;
      }
    }
    if (hasAddress) {
      const [row] = await db.insert(enrollments).values(values).returning();
      return row;
    }
    delete values.address;
    const [inserted] = await db.insert(enrollments).values(values).returning({ id: enrollments.id });
    if (fallbackAddress) {
      await this.upsertFallbackAddress(inserted.id, fallbackAddress);
    }
    const rows = await this.selectEnrollments("WHERE e.id = $1", [inserted.id]);
    if (!rows[0]) throw new Error("Enrollment not found after insert");
    return rows[0];
  }

  async updateEnrollment(id: number, updates: Partial<InsertEnrollment>): Promise<Enrollment> {
    const setValues: any = { ...updates };
    const fallbackAddress = typeof setValues.address === "string" ? setValues.address : undefined;
    let hasAddress = await this.hasAddressColumn();
    if (!hasAddress && setValues.address != null) {
      try {
        await this.ensureAddressColumnIfNeeded();
        hasAddress = await this.hasAddressColumn(true);
      } catch {
        hasAddress = false;
      }
    }
    if (hasAddress) {
      const [row] = await db.update(enrollments).set(setValues).where(eq(enrollments.id, id)).returning();
      if (!row) throw new Error("Enrollment not found");
      return row;
    }
    delete setValues.address;
    await db.update(enrollments).set(setValues).where(eq(enrollments.id, id));
    if (fallbackAddress) {
      await this.upsertFallbackAddress(id, fallbackAddress);
    }
    const rows = await this.selectEnrollments("WHERE e.id = $1", [id]);
    if (!rows[0]) throw new Error("Enrollment not found");
    return rows[0];
  }

  async updateEnrollmentStatus(id: number, status: string, systemDecision?: string): Promise<Enrollment> {
    const set: any = { status };
    if (systemDecision !== undefined) set.systemDecision = systemDecision;
    const hasAddress = await this.hasAddressColumn();
    if (hasAddress) {
      const [row] = await db.update(enrollments).set(set).where(eq(enrollments.id, id)).returning();
      if (!row) throw new Error("Enrollment not found");
      return row;
    }
    await db.update(enrollments).set(set).where(eq(enrollments.id, id));
    const rows = await this.selectEnrollments("WHERE e.id = $1", [id]);
    if (!rows[0]) throw new Error("Enrollment not found");
    return rows[0];
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

  async getEnrollmentsWithDetails(): Promise<EnrollmentWithDetails[]> {
    const hasAddress = await this.hasAddressColumn();
    if (!hasAddress) {
      await this.ensureFallbackAddressTable();
    }
    const addressExpr = hasAddress
      ? "e.address"
      : "(SELECT ea.address FROM enrollment_addresses ea WHERE ea.enrollment_id = e.id)";
    const sql = `
      SELECT
        e.id,
        e.student_id       AS "studentId",
        e.status,
        e.name,
        ${addressExpr} AS "address",
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
