import { pgTable, text, serial, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role", { enum: ['student', 'admin'] }).notNull().default('student'),
});

export const enrollments = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  status: text("status", { enum: ['pending', 'in_analysis', 'approved', 'rejected'] }).notNull().default('pending'),
  name: text("name"),
  cpf: text("cpf"),
  dateOfBirth: text("date_of_birth"),
  income: integer("income"),
  systemDecision: text("system_decision"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  enrollmentId: integer("enrollment_id").notNull(),
  type: text("type", { enum: ['rg', 'cpf', 'residence', 'transcript', 'income'] }).notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  ocrData: jsonb("ocr_data"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertEnrollmentSchema = createInsertSchema(enrollments).omit({ id: true, createdAt: true, systemDecision: true, status: true });
export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, uploadedAt: true, ocrData: true, url: true });

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Enrollment = typeof enrollments.$inferSelect;
export type InsertEnrollment = z.infer<typeof insertEnrollmentSchema>;
export type Document = typeof documents.$inferSelect;
export type InsertDocument = z.infer<typeof insertDocumentSchema>;