import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import session from "express-session";

declare module 'express-session' {
  interface SessionData {
    userId: number;
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Setup session
  app.use(session({
    secret: 'super-secret-prototype-key',
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
      if (!user || user.password !== password) {
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
      const user = await storage.createUser(input);
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
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

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
      const id = parseInt(req.params.id);
      const updated = await storage.updateEnrollment(id, input);
      res.json(updated);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.post(api.documents.upload.path, requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const input = api.documents.upload.input.parse(req.body);
      
      // Mock OCR Data based on document type
      let ocrData = null;
      if (input.type === 'cpf') {
        ocrData = { extractedCpf: "123.456.789-00", valid: true };
      } else if (input.type === 'income') {
        ocrData = { extractedIncome: Math.floor(Math.random() * 3000), valid: true };
      }

      const doc = await storage.createDocument({
        enrollmentId: id,
        type: input.type,
        name: input.name,
        url: `mock-url-${Date.now()}`,
        ocrData
      });
      res.status(201).json(doc);
    } catch (e) {
      res.status(400).json({ message: "Bad request" });
    }
  });

  app.post(api.enrollments.submit.path, requireAuth, async (req, res) => {
    const id = parseInt(req.params.id);
    const enrollment = await storage.getEnrollment(id);
    if (!enrollment) return res.status(404).json({ message: "Not found" });

    // Mock Rules Engine
    let systemDecision = "Elegível";
    let status = "in_analysis";

    if (!enrollment.income || enrollment.income >= 2000) {
      systemDecision = "Não elegível: Renda superior a R$ 2000";
    } else {
      systemDecision = "Elegível: Renda dentro do limite";
    }

    const updated = await storage.updateEnrollmentStatus(id, status, systemDecision);
    res.json(updated);
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
      const id = parseInt(req.params.id);
      const { status } = api.admin.updateStatus.input.parse(req.body);
      const updated = await storage.updateEnrollmentStatus(id, status);
      res.json(updated);
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
    const users = await storage.getUserByUsername('admin');
    if (!users) {
      await storage.createUser({ username: 'admin', password: '123', role: 'admin' });
      const student1 = await storage.createUser({ username: 'aluno', password: '123', role: 'student' });
      const student2 = await storage.createUser({ username: 'maria', password: '123', role: 'student' });

      const e1 = await storage.createEnrollment({
        studentId: student1.id,
        name: 'Aluno da Silva',
        cpf: '111.222.333-44',
        dateOfBirth: '2000-01-01',
        income: 1500
      });
      await storage.updateEnrollmentStatus(e1.id, 'in_analysis', 'Elegível: Renda dentro do limite');
      
      await storage.createDocument({ enrollmentId: e1.id, type: 'rg', name: 'rg_frente.png', url: 'mock' });
      await storage.createDocument({ enrollmentId: e1.id, type: 'cpf', name: 'cpf.pdf', url: 'mock', ocrData: { extractedCpf: "111.222.333-44", valid: true } });
      await storage.createDocument({ enrollmentId: e1.id, type: 'income', name: 'holerite.pdf', url: 'mock', ocrData: { extractedIncome: 1500, valid: true } });

      const e2 = await storage.createEnrollment({
        studentId: student2.id,
        name: 'Maria Souza',
        cpf: '555.666.777-88',
        dateOfBirth: '1998-05-15',
        income: 3500
      });
      await storage.updateEnrollmentStatus(e2.id, 'in_analysis', 'Não elegível: Renda superior a R$ 2000');
    }
  }

  seedDatabase();

  return httpServer;
}