import { type User, type InsertUser, type Enrollment, type InsertEnrollment, type Document, type InsertDocument } from "@shared/schema";

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
  createDocument(doc: InsertDocument & { enrollmentId: number }): Promise<Document>;
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

  async createDocument(insertDoc: InsertDocument & { enrollmentId: number }): Promise<Document> {
    const id = this.currentDocumentId++;
    const doc: Document = {
      ...insertDoc,
      id,
      uploadedAt: new Date(),
    };
    this.documents.set(id, doc);
    return doc;
  }
}

export const storage = new MemStorage();
