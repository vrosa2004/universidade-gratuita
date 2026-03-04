import "dotenv/config";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { pool } from "./db";
import { api } from "@shared/routes";
import { getRequiredAttachments, validateAttachments } from "@shared/attachments";
import { LIMITE_MULTIPLICADOR, LIMITE_RENDA_PER_CAPITA } from "@shared/schema";
import type { AttachmentContext, IncomeCategory } from "@shared/attachments";
import { z } from "zod";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import { extractTextFromDataUrl } from "./services/ocr.service.js";
import { extractValueCandidates, extractMoneyValues, calculateIncomeResult } from "./services/income.service.js";

/** Document types that must have income validated via OCR */
const INCOME_DOC_TYPES = new Set([
  // kept in a shared constant for reuse in recalculateFamilyIncome below
  "income_proof", "payslip_3", "payslip_6", "income_justification",
  "rural_declaration", "fishing_declaration", "inss_extract",
  "decore", "pro_labore_3",
]);

/**
 * After every income-document upload, recalculate the aggregate family income
 * and per-capita value on the enrollment record.
 *
 * Two modes:
 *
 * ── PAYSLIP-3 MODE (salaried, renda fixa) ───────────────────────────────────
 *   When the enrollment has payslip_3 documents uploaded:
 *   • Collect all 3 contracheques and OCR-extract the líquido of each.
 *   • mediaSalarial = (s1 + s2 + s3) / 3
 *   • familyIncomeDocs = todos os income docs EXCETO payslip_3 (um por familiar)
 *   • mediaFamilia = avg(familyIncomeDocs OCR)
 *   • perCapita = (mediaAluno + mediaFamilia) / 2
 *   • perCapita = rendaFamiliarTotal / householdSize
 *   • Requires all 3 payslips with valid OCR; otherwise perCapita stays null.
 *
 * ── STANDARD MODE (all other income types) ──────────────────────────────────
 *   • One income doc per household member; each doc OCR yields that member's income.
 *   • Per-capita is finalized only when validOcrDocs >= householdSize.
 */
async function recalculateFamilyIncome(enrollmentId: number): Promise<void> {
  const enrollment = await storage.getEnrollment(enrollmentId);
  if (!enrollment) return;

  const householdSize = enrollment.householdSize ?? 1;
  const allDocs = await storage.getDocuments(enrollmentId);

  // ── PAYSLIP-3 MODE ──────────────────────────────────────────────────────────
  const payslip3Docs = allDocs.filter((d) => d.type === "payslip_3");
  if (payslip3Docs.length > 0) {
    if (payslip3Docs.length < 3) {
      console.log(`[FamilyIncome] Payslip-3 mode: ${payslip3Docs.length}/3 contracheques — aguardando`);
      await storage.updateEnrollment(enrollmentId, { perCapitaIncome: null });
      return;
    }

    const validPayslips = payslip3Docs.filter((d) => {
      const ocr = d.ocrData as any;
      return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
    });

    if (validPayslips.length < 3) {
      console.log(`[FamilyIncome] Payslip-3 mode: apenas ${validPayslips.length}/3 com OCR válido — revisão manual`);
      await storage.updateEnrollment(enrollmentId, { perCapitaIncome: null });
      return;
    }

    const mediaAluno = validPayslips.reduce((s, d) => s + ((d.ocrData as any).rendaTotal as number), 0) / 3;

    // Family income docs: todos exceto payslip_3
    const familyIncomeDocs = allDocs.filter((d) => INCOME_DOC_TYPES.has(d.type) && d.type !== "payslip_3");
    const validFamilyDocs = familyIncomeDocs.filter((d) => {
      const ocr = d.ocrData as any;
      return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
    });

    const numOutros = Math.max(0, householdSize - 1);
    if (numOutros > 0 && validFamilyDocs.length < numOutros) {
      console.log(`[FamilyIncome] Payslip-3: ${validFamilyDocs.length}/${numOutros} comprovantes familiares com OCR — membros sem doc contam como R$ 0`);
    }

    // Total income = student salary + sum of all valid family docs (missing = R$ 0)
    const familyIncomeTotal = validFamilyDocs.reduce((s, d) => s + ((d.ocrData as any).rendaTotal as number), 0);
    const totalIncome = mediaAluno + familyIncomeTotal;
    const perCapita = Math.round(totalIncome / householdSize);

    await storage.updateEnrollment(enrollmentId, { perCapitaIncome: perCapita });
    console.log(
      `[FamilyIncome] Payslip-3: aluno R$ ${mediaAluno.toFixed(2)} + família R$ ${familyIncomeTotal.toFixed(2)}` +
      ` = R$ ${totalIncome.toFixed(2)} ÷ ${householdSize} pessoas = R$ ${perCapita} per capita` +
      (validFamilyDocs.length < numOutros ? ` (parcial: ${validFamilyDocs.length}/${numOutros} familiares)` : '')
    );
    return;
  }

  // ── STANDARD MODE ───────────────────────────────────────────────────────────
  const incomeDocs = allDocs.filter((d) => INCOME_DOC_TYPES.has(d.type));
  const validOcrDocs = incomeDocs.filter((d) => {
    const ocr = d.ocrData as any;
    return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
  });

  console.log(
    `[FamilyIncome] Standard mode: ${validOcrDocs.length}/${householdSize} membros documentados`
  );

  // Per-capita is computed with however many docs have valid OCR.
  // Sending a doc per member is optional — missing members count as R$ 0.
  if (validOcrDocs.length === 0) {
    await storage.updateEnrollment(enrollmentId, { perCapitaIncome: null });
    return;
  }

  const totalFamilyIncome = validOcrDocs.reduce((sum, d) => {
    const ocr = d.ocrData as any;
    return sum + (ocr.rendaTotal as number);
  }, 0);

  const perCapita = Math.round(totalFamilyIncome / householdSize);
  await storage.updateEnrollment(enrollmentId, { perCapitaIncome: perCapita });
  console.log(
    `[FamilyIncome] Renda total familiar: R$ ${totalFamilyIncome} | Per capita (${validOcrDocs.length}/${householdSize} docs): R$ ${perCapita}`
  );
}

const PgSession = connectPgSimple(session);

declare module 'express-session' {
  interface SessionData {
    userId: number;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Setup session (uses PostgreSQL when DATABASE_URL is available)
  const sessionStore = process.env.DATABASE_URL
    ? new PgSession({ pool, createTableIfMissing: true })
    : undefined;

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));

  // Simple auth middlewares
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    next();
  };

  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (user?.role !== 'admin') {
      return res.status(403).json({ message: "Not authorized" });
    }
    next();
  };

  // Auth Routes
  app.post(api.auth.login.path, async (req, res) => {
    try {
      const { username, password } = api.auth.login.input.parse(req.body);
      const user = await storage.getUserByUsername(username);
      const passwordValid = user ? await bcrypt.compare(password, user.password) : false;
      if (!user || !passwordValid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.session.userId = user.id;
      res.json(user);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.post(api.auth.register.path, async (req, res) => {
    try {
      const input = api.auth.register.input.parse(req.body);
      const existing = await storage.getUserByUsername(input.username);
      if (existing) {
        return res.status(400).json({ message: "Username already exists" });
      }
      const hashedPassword = await bcrypt.hash(input.password, 10);
      // Public registration is always student — admin accounts can only be created by an existing admin
      const user = await storage.createUser({ ...input, password: hashedPassword, role: 'student' });
      req.session.userId = user.id;
      res.status(201).json(user);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.get(api.auth.me.path, async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    res.json(user);
  });

  app.post(api.auth.logout.path, (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy error:", err);
      }
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  // ── DEV: OCR debug endpoint ──────────────────────────────────────────────
  // POST /api/debug/ocr — accepts { base64: "data:image/...;base64,..." }
  // Returns raw OCR text, found values and income result (no DB writes).
  if (process.env.NODE_ENV !== "production") {
    app.post("/api/debug/ocr", requireAuth, async (req, res) => {
      try {
        const { base64 } = req.body as { base64?: string };
        if (!base64) return res.status(400).json({ message: "Envie { base64: 'data:...' }" });

        const householdSize = parseInt(req.body.householdSize ?? "1") || 1;

        const { text, confidence, mimeType } = await extractTextFromDataUrl(base64);
        const candidates = extractValueCandidates(text);
        const result = calculateIncomeResult(candidates, householdSize);

        res.json({
          mimeType,
          confidence: Math.round(confidence),
          textLength: text.length,
          rawText: text.slice(0, 2000),
          candidatos: candidates.map((c) => ({ ...c, value: `R$ ${c.value.toFixed(2)}` })),
          valoresEncontrados: result.valoresEncontrados,
          resultado: result,
        });
      } catch (err: any) {
        res.status(500).json({ message: err?.message ?? "Erro no OCR", stack: err?.stack });
      }
    });
  }

  // Student Routes
  app.get(api.enrollments.my.path, requireAuth, async (req, res) => {
    const enrollment = await storage.getEnrollmentByStudent(req.session.userId!);
    if (!enrollment) {
      return res.json(null);
    }
    const documents = await storage.getDocuments(enrollment.id);
    res.json({ ...enrollment, documents });
  });

  app.post(api.enrollments.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.enrollments.create.input.parse(req.body);
      const enrollment = await storage.createEnrollment({ ...input, studentId: req.session.userId! });
      res.status(201).json(enrollment);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.put(api.enrollments.update.path, requireAuth, async (req, res) => {
    try {
      const input = api.enrollments.update.input.parse(req.body);
      const id = parseInt(req.params.id as string);
      // Recalculate perCapitaIncome whenever income or householdSize changes
      const existing = await storage.getEnrollment(id);
      const income = (input as any).income ?? existing?.income;
      const householdSize = (input as any).householdSize ?? existing?.householdSize;
      const perCapitaIncome =
        income != null && householdSize != null && householdSize > 0
          ? Math.round(income / householdSize)
          : existing?.perCapitaIncome ?? null;
      const updated = await storage.updateEnrollment(id, { ...(input as any), perCapitaIncome });
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.post(api.documents.upload.path, requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const input = api.documents.upload.input.parse(req.body);

      let ocrData: Record<string, unknown> | null = null;

      if (INCOME_DOC_TYPES.has(input.type)) {
        // ── Per-document OCR ────────────────────────────────────────────
        // householdSize = 1 here: we extract THIS PERSON'S income only.
        // Per-capita is computed later by recalculateFamilyIncome() once
        // all family members have submitted their income documents.
        try {
          const { text, confidence } = await extractTextFromDataUrl(input.base64Content);
          const candidates = extractValueCandidates(text);
          const result = calculateIncomeResult(candidates, 1);

          ocrData = {
            ...result,
            ocrConfidence: Math.round(confidence),
          };

          if (result.status === "REVISAO_MANUAL") {
            await storage.updateEnrollmentStatus(
              id,
              "pending",
              "Revisão manual necessária: OCR não conseguiu extrair valores de renda do documento enviado."
            );
          }
        } catch (ocrErr: any) {
          console.error(`[OCR] Falha ao processar documento ${input.name}:`, ocrErr?.message ?? ocrErr);
          ocrData = {
            status: "REVISAO_MANUAL",
            motivo: "Erro interno no OCR. Reenvie o arquivo.",
            observacao: ocrErr?.message ?? "Erro desconhecido",
          };
          await storage.updateEnrollmentStatus(id, "pending",
            "Revisão manual necessária: falha no processamento OCR."
          );
        }
      }

      const doc = await storage.createDocument({
        enrollmentId: id,
        type: input.type,
        name: input.name,
        url: input.base64Content,
        ocrData,
      });

      // Recalculate aggregate family income after every income doc upload
      if (INCOME_DOC_TYPES.has(input.type)) {
        await recalculateFamilyIncome(id);
      }

      res.status(201).json(doc);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.post(api.enrollments.submit.path, requireAuth, async (req, res) => {
    const id = parseInt(req.params.id as string);
    const enrollment = await storage.getEnrollment(id);
    if (!enrollment) return res.status(404).json({ message: "Not found" });

    // Build attachment context from enrollment fields
    if (!enrollment.incomeCategory) {
      return res.status(422).json({ message: "Selecione a categoria de renda antes de enviar." });
    }

    const ctx: AttachmentContext = {
      incomeCategory: enrollment.incomeCategory as IncomeCategory,
      income: enrollment.income ?? 0,
      monthlyExpenses: enrollment.monthlyExpenses ?? 0,
      householdSize: enrollment.householdSize ?? 1,
      hasFormalEmploymentHistory: enrollment.hasFormalEmploymentHistory ?? undefined,
      hasVariableIncome: enrollment.hasVariableIncome ?? undefined,
      isCompanyActive: enrollment.isCompanyActive ?? undefined,
      hasProLabore: enrollment.hasProLabore ?? undefined,
    };

    const docs = await storage.getDocuments(id);
    const uploadedKeys = docs.map((d) => d.type);
    const validation = validateAttachments(ctx, uploadedKeys);
    if (!validation.valid) {
      return res.status(422).json({ message: validation.missingMessage, missing: validation.missingRequired.map(a => a.label) });
    }

    const householdSize = enrollment.householdSize ?? 1;

    // ── Payslip-3 mode: require exactly 3 contracheques uploaded ──────────────
    const payslip3Docs = docs.filter((d) => d.type === "payslip_3");
    const isPayslip3Mode = payslip3Docs.length > 0;

    if (isPayslip3Mode) {
      if (payslip3Docs.length < 3) {
        return res.status(422).json({
          message: `Envie exatamente 3 contracheques (${payslip3Docs.length}/3 enviados). Os três últimos meses são obrigatórios.`,
          payslipsRequired: 3,
          payslipsSubmitted: payslip3Docs.length,
        });
      }
      // Note: OCR failure is NOT a submission blocker — per-capita ficará null
      // e o admin revisará manualmente os contracheques.
      const failedOcr = payslip3Docs.filter((d) => {
        const ocr = d.ocrData as any;
        return !ocr || ocr.status === "REVISAO_MANUAL" || !ocr.rendaTotal || ocr.rendaTotal <= 0;
      });
      if (failedOcr.length > 0) {
        console.warn(
          `[Submit] ${failedOcr.length} contracheque(s) com OCR não extraído — per capita ficará nulo para revisão manual.`,
          failedOcr.map(d => d.name),
        );
      }
      // income_proof for family members is optional — use whatever has valid OCR
      // (no hard block; per-capita will be null/partial if none sent)
    } else {
      // ── Standard mode ────────────────────────────────────────────────────────
      // Income docs for family members are optional — per-capita is computed
      // with whatever valid OCR docs are available (at least 1 required).
      // No hard block here; recalculateFamilyIncome handles the math.
    }

    // Ensure per-capita is up-to-date
    await recalculateFamilyIncome(id);
    const refreshedEnrollment = await storage.getEnrollment(id);

    // Eligibility rules engine
    let systemDecision = "Elegível";
    let status = "in_analysis";

    const perCapita = refreshedEnrollment?.perCapitaIncome ?? null;
    const allIncomeDocs = docs.filter((d) => INCOME_DOC_TYPES.has(d.type));
    const limiteStr = LIMITE_RENDA_PER_CAPITA.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    let incomeLabel: string;
    if (isPayslip3Mode) {
      const validPayslipsForLabel = payslip3Docs.filter((d) => {
        const ocr = d.ocrData as any;
        return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
      });
      const mediaAluno = validPayslipsForLabel.length > 0
        ? validPayslipsForLabel.reduce((s, d) => s + ((d.ocrData as any).rendaTotal as number), 0) / validPayslipsForLabel.length
        : null;
      const familyDocs = allIncomeDocs.filter((d) => d.type !== "payslip_3");
      const validFamilyDocs = familyDocs.filter((d) => {
        const ocr = d.ocrData as any;
        return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
      });
      const mediaFamilia = validFamilyDocs.length > 0
        ? validFamilyDocs.reduce((s, d) => s + ((d.ocrData as any).rendaTotal as number), 0) / validFamilyDocs.length
        : null;
      const numOutros = Math.max(0, householdSize - 1);
      const familyTotalForLabel = validFamilyDocs.reduce((s, d) => s + ((d.ocrData as any).rendaTotal as number), 0);
      const totalIncomeForLabel = (mediaAluno ?? 0) + familyTotalForLabel;
      const partialNote = validFamilyDocs.length < numOutros ? ` (${validFamilyDocs.length}/${numOutros} familiar(es) com OCR)` : '';
      if (perCapita != null && mediaAluno != null) {
        incomeLabel = `Aluno R$ ${mediaAluno.toFixed(2)} + família R$ ${familyTotalForLabel.toFixed(2)}${partialNote} = R$ ${totalIncomeForLabel.toFixed(2)} ÷ ${householdSize} pessoas = R$ ${perCapita} per capita`;
      } else {
        const payslipStr = mediaAluno != null ? `R$ ${mediaAluno.toFixed(2)}` : `${validPayslipsForLabel.length}/3 com OCR`;
        incomeLabel = `Aluno ${payslipStr} | família R$ ${familyTotalForLabel.toFixed(2)}${partialNote} — aguardando revisão manual`;
      }
    } else {
      const validOcrDocs = allIncomeDocs.filter((d) => {
        const ocr = d.ocrData as any;
        return ocr && ocr.status !== "REVISAO_MANUAL" && typeof ocr.rendaTotal === "number" && ocr.rendaTotal > 0;
      });
      const totalFamilyIncome = validOcrDocs.reduce((s, d) => s + ((d.ocrData as any).rendaTotal as number), 0);
      incomeLabel = perCapita != null
        ? `Renda familiar total R$ ${totalFamilyIncome} ÷ ${householdSize} pessoas = R$ ${perCapita} per capita`
        : `Renda familiar bruta R$ ${enrollment.income} (per capita via OCR indisponível – revisão manual)`;
    }

    if (perCapita == null) {
      // OCR não concluiu — não há dado suficiente para decisão automática
      systemDecision = `Revisão manual necessária: ${incomeLabel}`;
    } else if (perCapita > LIMITE_RENDA_PER_CAPITA) {
      systemDecision = `Não elegível: ${incomeLabel} – valor per capita acima de R$ ${limiteStr} (${LIMITE_MULTIPLICADOR}× salário mínimo)`;
    } else {
      systemDecision = `Elegível: ${incomeLabel} – valor per capita dentro do limite de R$ ${limiteStr}`;
    }

    // Append note when there is at least one missing family income doc
    const submittedFamilyDocs = isPayslip3Mode
      ? allIncomeDocs.filter((d) => d.type !== "payslip_3").length
      : allIncomeDocs.length;
    const expectedFamilyDocs = isPayslip3Mode ? Math.max(0, householdSize - 1) : householdSize;
    if (submittedFamilyDocs < expectedFamilyDocs) {
      systemDecision += ' — Um comprovante de renda familiar a menos do que o esperado (possível desempregado na família).';
    }

    const updated = await storage.updateEnrollmentStatus(id, status, systemDecision);
    res.json(updated);
  });

  // DELETE /api/documents/:docId – remove a single uploaded file
  app.delete(api.documents.delete.path, requireAuth, async (req, res) => {
    try {
      const docId = parseInt(req.params.docId as string);
      if (isNaN(docId)) {
        return res.status(400).json({ message: 'Invalid document ID' });
      }
      await storage.deleteDocument(docId);
      res.json({ message: 'Deleted' });
    } catch (err: any) {
      console.error('Error deleting document:', err);
      res.status(500).json({ message: err?.message ?? 'Failed to delete document' });
    }
  });

  // GET /api/attachments/required – returns the checklist for a given context
  app.post(api.attachments.required.path, (req, res) => {
    try {
      const ctx = api.attachments.required.input.parse(req.body) as AttachmentContext;
      const attachments = getRequiredAttachments(ctx);
      res.json(attachments);
    } catch {
      res.status(400).json({ message: "Parâmetros inválidos" });
    }
  });

  // POST /api/enrollments/:id/validate-attachments – pre-flight check without submitting
  app.post(api.attachments.validate.path, requireAuth, async (req, res) => {
    const id = parseInt(req.params.id as string);
    const enrollment = await storage.getEnrollment(id);
    if (!enrollment || !enrollment.incomeCategory) {
      return res.json({ valid: false, missingMessage: "Categoria de renda não selecionada.", missing: [] });
    }
    const ctx: AttachmentContext = {
      incomeCategory: enrollment.incomeCategory as IncomeCategory,
      income: enrollment.income ?? 0,
      monthlyExpenses: enrollment.monthlyExpenses ?? 0,
      householdSize: enrollment.householdSize ?? 1,
      hasFormalEmploymentHistory: enrollment.hasFormalEmploymentHistory ?? undefined,
      hasVariableIncome: enrollment.hasVariableIncome ?? undefined,
      isCompanyActive: enrollment.isCompanyActive ?? undefined,
      hasProLabore: enrollment.hasProLabore ?? undefined,
    };
    const docs = await storage.getDocuments(id);
    const result = validateAttachments(ctx, docs.map((d) => d.type));
    res.json({ valid: result.valid, missingMessage: result.missingMessage, missing: result.missingRequired.map(a => a.label) });
  });

  // Admin Routes
  app.get(api.admin.list.path, requireAdmin, async (req, res) => {
    const enrollments = await storage.getEnrollments();
    const result = await Promise.all(enrollments.map(async (e) => {
      const docs = await storage.getDocuments(e.id);
      const student = await storage.getUser(e.studentId);
      return { ...e, documents: docs, student };
    }));
    res.json(result);
  });

  app.patch(api.admin.updateStatus.path, requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id as string);
      const { status } = api.admin.updateStatus.input.parse(req.body);
      const updated = await storage.updateEnrollmentStatus(id, status);
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  // Admin: create a new admin user
  app.post(api.admin.createUser.path, requireAdmin, async (req, res) => {
    try {
      const input = api.admin.createUser.input.parse(req.body);
      const existing = await storage.getUserByUsername(input.username);
      if (existing) {
        return res.status(400).json({ message: "Nome de usuário já existe" });
      }
      const hashedPassword = await bcrypt.hash(input.password, 10);
      const user = await storage.createUser({ username: input.username, password: hashedPassword, role: 'admin' });
      res.status(201).json(user);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.get(api.admin.stats.path, requireAdmin, async (req, res) => {
    const enrollments = await storage.getEnrollments();
    res.json({
      total: enrollments.length,
      pending: enrollments.filter(e => e.status === 'pending').length,
      inAnalysis: enrollments.filter(e => e.status === 'in_analysis').length,
      approved: enrollments.filter(e => e.status === 'approved').length,
      rejected: enrollments.filter(e => e.status === 'rejected').length,
    });
  });

  // Seed Data for Prototype
  async function seedDatabase() {
    const existingAdmin = await storage.getUserByUsername('admin');
    if (!existingAdmin) {
      const hashPw = (pw: string) => bcrypt.hash(pw, 10);
      await storage.createUser({ username: 'admin', password: await hashPw('123'), role: 'admin' });
      const student1 = await storage.createUser({ username: 'aluno', password: await hashPw('123'), role: 'student' });
      const student2 = await storage.createUser({ username: 'maria', password: await hashPw('123'), role: 'student' });

      const e1 = await storage.createEnrollment({
        studentId: student1.id,
        name: 'Aluno da Silva',
        cpf: '111.222.333-44',
        dateOfBirth: '2000-01-01',
        income: 1500
      });
      await storage.updateEnrollmentStatus(e1.id, 'in_analysis', 'Elegível: Renda dentro do limite');
      
      await storage.createDocument({ enrollmentId: e1.id, type: 'rg', name: 'rg_frente.png', url: 'mock', ocrData: null });
      await storage.createDocument({ enrollmentId: e1.id, type: 'cpf', name: 'cpf.pdf', url: 'mock', ocrData: { extractedCpf: "111.222.333-44", valid: true } });
      await storage.createDocument({ enrollmentId: e1.id, type: 'income_proof', name: 'holerite.pdf', url: 'mock', ocrData: { extractedIncome: 1500, valid: true } });

      const e2 = await storage.createEnrollment({
        studentId: student2.id,
        name: 'Maria Souza',
        cpf: '555.666.777-88',
        dateOfBirth: '1998-05-15',
        income: 3500
      });
      await storage.updateEnrollmentStatus(e2.id, 'in_analysis', `Não elegível: Renda superior a R$ ${LIMITE_RENDA_PER_CAPITA.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${LIMITE_MULTIPLICADOR}× salário mínimo)`);
    }
  }

  seedDatabase();

  return httpServer;
}