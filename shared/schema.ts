import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { INCOME_CATEGORIES } from "./attachments";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role", { enum: ['student', 'admin'] }).notNull().default('student'),
});

// Income category values derived from the rules engine so they stay in sync.
export type IncomeCategory = keyof typeof INCOME_CATEGORIES;
const incomeCategoryEnum = Object.keys(INCOME_CATEGORIES) as [IncomeCategory, ...IncomeCategory[]];

export const enrollments = pgTable("enrollments", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id").notNull(),
  status: text("status", { enum: ['pending', 'in_analysis', 'approved', 'rejected'] }).notNull().default('pending'),
  name: text("name"),
  cpf: text("cpf"),
  dateOfBirth: text("date_of_birth"),
  income: integer("income"),
  /** Total monthly expenses including tuition – used for the income < expenses conditional rule */
  monthlyExpenses: integer("monthly_expenses"),
  /** Income category selected by the student */
  incomeCategory: text("income_category", { enum: incomeCategoryEnum }),
  /** (unemployed) Had formal employment in last 2 years */
  hasFormalEmploymentHistory: boolean("has_formal_employment_history"),
  /** (salaried) Receives variable income such as commissions or overtime */
  hasVariableIncome: boolean("has_variable_income"),
  /** (business_owner) Company is currently active */
  isCompanyActive: boolean("is_company_active"),
  /** (business_owner) Actually withdraws pro-labore */
  hasProLabore: boolean("has_pro_labore"),
  systemDecision: text("system_decision"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const DOCUMENT_TYPE_VALUES = [
  // Base documents
  'rg', 'cpf', 'residence', 'transcript',
  // General income
  'income_proof', 'income_justification',
  // Shared
  'cnis',
  // Unemployed
  'unemployment_proof', 'non_employment_declaration',
  // Salaried
  'payslip_3', 'payslip_6',
  // Rural
  'rural_declaration',
  // Fishing
  'fishing_declaration',
  // Retired
  'inss_extract',
  // Autonomous
  'decore',
  // Business owner
  'pro_labore_3', 'irpj', 'company_inactivity',
  // Intern
  'internship_contract',
  // Researcher
  'research_declaration',
] as const;

export type DocumentType = typeof DOCUMENT_TYPE_VALUES[number];

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  enrollmentId: integer("enrollment_id").notNull(),
  type: text("type", { enum: DOCUMENT_TYPE_VALUES }).notNull(),
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