/**
 * Attachment Rules Engine – Programa Universidade Gratuita (2º sem. 2024)
 *
 * This module is the single source-of-truth for which documents are required
 * for each income category. Both the server-side validation and the client-side
 * checklist consume the same logic, ensuring consistency.
 */

// ---------------------------------------------------------------------------
// Income Categories
// ---------------------------------------------------------------------------

export const INCOME_CATEGORIES = {
  unemployed:    'Desempregado (maior de 18 anos)',
  salaried:      'Assalariado',
  rural:         'Atividade Rural',
  fishing:       'Atividade de Pesca',
  retired:       'Aposentado ou Pensionista',
  autonomous:    'Autônomo / Prestador de Serviço / Trabalhador Avulso',
  business_owner:'Proprietário / Sócio / Dirigente de Empresa',
  intern:        'Estagiário',
  researcher:    'Bolsista de Pesquisa ou Extensão',
} as const;

export type IncomeCategory = keyof typeof INCOME_CATEGORIES;

// ---------------------------------------------------------------------------
// Document type keys – must match the `type` enum in schema.ts
// ---------------------------------------------------------------------------

export const DOC_TYPES = {
  // Base docs (collected independently of income category)
  rg_frente:                  'Carteira de Identidade – Frente e Verso (RG / CNH)',
  residence:                  'Comprovante de Residência',
  transcript:                 'Histórico Escolar',
  // General income docs
  income_proof:               'Comprovante(s) de Renda Familiar Bruta Mensal',
  income_justification:       'Justificativa de Renda e Gastos',
  // Shared across categories
  cnis:                       'CNIS – Relações Previdenciárias',
  // Unemployed
  unemployment_proof:         'Documento de Perda de Vínculo Empregatício (últimos 2 anos)',
  non_employment_declaration: 'Declaração de Não Atividade Laboral Remunerada',
  // Salaried
  payslip_3:                  '3 Últimos Contracheques',
  payslip_6:                  '6 Últimos Contracheques (renda variável/comissões)',
  // Rural
  rural_declaration:          'Declaração de Venda Rural (últimos 12 meses – Setor de Agricultura do Município)',
  // Fishing
  fishing_declaration:        'Declaração do Sindicato de Pesca assinada pelo presidente',
  // Retired / Pension
  inss_extract:               'Extrato de Benefício / DCB – INSS (último mês)',
  // Autonomous
  decore:                     'DECORE ou Declaração de Rendimentos assinada por contador',
  // Business owner
  pro_labore_3:               '3 Últimos Pró-labores',
  irpj:                       'IRPJ – DEFIS completo + recibo / ECF recibo / Extrato MEI (exercício 2024 / ano-calendário 2023)',
  company_inactivity:         'Comprovante de Inatividade da Empresa ou Declaração do Contador (ausência de pró-labore)',
  // Intern
  internship_contract:        'Termo de Compromisso de Estágio (com valor recebido)',
  // Researcher
  research_declaration:       'Declaração PROPIEX (período e valor recebido)',
} as const;

export type DocTypeKey = keyof typeof DOC_TYPES;

// ---------------------------------------------------------------------------
// Attachment descriptor
// ---------------------------------------------------------------------------

export interface AttachmentDescriptor {
  /** Machine key, matches the `type` column */
  key: DocTypeKey;
  /** Human-readable label */
  label: string;
  /** Whether the document is always required (false = conditional) */
  required: boolean;
  /** Human-readable condition description (only set when required=false) */
  condition?: string;
  /** Mutually-exclusive group: only ONE from the group needs to be uploaded */
  group?: string;
}

// ---------------------------------------------------------------------------
// Context provided by the enrollment form to resolve conditional rules
// ---------------------------------------------------------------------------

export interface AttachmentContext {
  /** Selected income category */
  incomeCategory: IncomeCategory;
  /** Gross monthly family income in BRL (cents or integer) */
  income: number;
  /** Total monthly expenses including tuition in BRL */
  monthlyExpenses: number;
  /** Total number of people in the household (includes the applicant) */
  householdSize?: number;
  /** (unemployed) Has had a formal employment in the last 2 years */
  hasFormalEmploymentHistory?: boolean;
  /** (salaried) Receives commissions or overtime (requires 6 payslips) */
  hasVariableIncome?: boolean;
  /** (business_owner) Company is currently active */
  isCompanyActive?: boolean;
  /** (business_owner) Actually withdraws pro-labore */
  hasProLabore?: boolean;
}

// ---------------------------------------------------------------------------
// Core rules engine
// ---------------------------------------------------------------------------

/**
 * Returns the full list of attachment descriptors for the given context.
 * Required=true items block form submission; required=false items are shown
 * with their condition text so the user understands why they may apply.
 */
export function getRequiredAttachments(ctx: AttachmentContext): AttachmentDescriptor[] {
  const attachments: AttachmentDescriptor[] = [];

  const add = (key: DocTypeKey, required: boolean, condition?: string, group?: string) => {
    attachments.push({ key, label: DOC_TYPES[key], required, condition, group });
  };

  // ------------------------------------------------------------------
  // 0. Documentos base – obrigatórios para todos os candidatos
  // ------------------------------------------------------------------
  add('rg_frente',  true);
  add('residence',  true);
  add('transcript', true);

  // ------------------------------------------------------------------
  // 1. Renda < Despesas → Justificativa obrigatória (universal rule)
  // ------------------------------------------------------------------
  if (ctx.monthlyExpenses > 0 && ctx.income < ctx.monthlyExpenses) {
    add('income_justification', true, 'Renda familiar menor que as despesas mensais (incluindo mensalidade)');
  }

  // ------------------------------------------------------------------
  // 2. Category-specific rules
  // ------------------------------------------------------------------

  switch (ctx.incomeCategory) {

    // ── Desempregado ────────────────────────────────────────────────
    case 'unemployed': {
      add('cnis', true);
      if (ctx.hasFormalEmploymentHistory === true) {
        // Had formal employment → must prove loss
        add('unemployment_proof', true);
      } else if (ctx.hasFormalEmploymentHistory === false) {
        // Never had formal employment or undeclared without link
        add('non_employment_declaration', true, 'Declaração de desemprego sem vínculo formal recente');
      } else {
        // hasFormalEmploymentHistory not yet answered → show both as conditional
        add('unemployment_proof', false, 'Se teve vínculo empregatício formal nos últimos 2 anos');
        add('non_employment_declaration', false, 'Se nunca teve vínculo empregatício formal recente');
      }
      break;
    }

    // ── Assalariado ─────────────────────────────────────────────────
    case 'salaried': {
      const numOutros = Math.max(0, (ctx.householdSize ?? 1) - 1);
      if (ctx.hasVariableIncome === true) {
        add('payslip_6', true, undefined, 'payslips');
        // income_proof for family members is optional — the more sent, the more accurate the per-capita
        if (numOutros > 0) add('income_proof', false, `Envie um comprovante de renda para cada um dos ${numOutros} familiar(es) na resid\u00eancia para c\u00e1lculo mais preciso da renda per capita`);
      } else if (ctx.hasVariableIncome === false) {
        add('payslip_3', true, undefined, 'payslips');
        if (numOutros > 0) add('income_proof', false, `Envie um comprovante de renda para cada um dos ${numOutros} familiar(es) na resid\u00eancia (o sal\u00e1rio do solicitante vem dos contracheques)`);
      } else {
        // Not yet answered \u2192 present both as alternatives
        add('payslip_3', false, 'Se renda fixa (sem comiss\u00f5es ou horas extras)', 'payslips');
        add('payslip_6', false, 'Se houver comiss\u00e3o ou hora extra', 'payslips');
        if (numOutros > 0) add('income_proof', false, `Comprovante de renda dos ${numOutros} familiar(es) na resid\u00eancia`);
      }
      break;
    }

    // ── Rural ────────────────────────────────────────────────────────
    case 'rural': {
      add('rural_declaration', true);
      add('cnis', true);
      break;
    }

    // ── Pesca ────────────────────────────────────────────────────────
    case 'fishing': {
      add('fishing_declaration', true);
      add('cnis', true);
      break;
    }

    // ── Aposentado / Pensionista ──────────────────────────────────────
    case 'retired': {
      add('inss_extract', true);
      add('cnis', true);
      break;
    }

    // ── Autônomo / Avulso ─────────────────────────────────────────────
    case 'autonomous': {
      add('decore', true);
      add('cnis', true);
      break;
    }

    // ── Sócio / Proprietário ──────────────────────────────────────────
    case 'business_owner': {
      if (ctx.hasProLabore !== false) {
        add('pro_labore_3', true);
      }
      add('irpj', true);
      if (!ctx.isCompanyActive) {
        add('company_inactivity', false, 'Empresa inativa ou sem retirada de pró-labore');
      } else if (ctx.hasProLabore === false) {
        add('company_inactivity', true, 'Declaração do contador justificando ausência de pró-labore');
      }
      break;
    }

    // ── Estagiário ────────────────────────────────────────────────────
    case 'intern': {
      add('internship_contract', true);
      add('cnis', true);
      break;
    }

    // ── Bolsista ──────────────────────────────────────────────────────
    case 'researcher': {
      add('research_declaration', true);
      add('cnis', true);
      break;
    }
  }

  // ------------------------------------------------------------------
  // 3. income_proof: required for all non-salaried categories
  //    (for salaried, it was handled per-member count in the case above)
  // ------------------------------------------------------------------
  if (ctx.incomeCategory !== 'salaried') {
    add('income_proof', true);
  }

  return attachments;
}

// ---------------------------------------------------------------------------
// Validation helper (used server-side at submission time)
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  missingRequired: AttachmentDescriptor[];
  missingMessage: string;
}

/**
 * Validates that all *required* attachments have been uploaded.
 * `uploadedKeys` is the list of `type` values already on record.
 * For group items, only ONE from the group is needed.
 */
export function validateAttachments(
  ctx: AttachmentContext,
  uploadedKeys: string[],
): ValidationResult {
  const required = getRequiredAttachments(ctx).filter((a) => a.required);
  const missing: AttachmentDescriptor[] = [];

  // Track which groups have been satisfied already
  const satisfiedGroups = new Set<string>();

  for (const att of required) {
    const uploaded = uploadedKeys.includes(att.key);
    if (att.group) {
      if (uploaded) {
        satisfiedGroups.add(att.group);
      } else if (!satisfiedGroups.has(att.group)) {
        // Check if any peer in the same group was uploaded
        const groupSatisfied = required
          .filter((a) => a.group === att.group)
          .some((a) => uploadedKeys.includes(a.key));
        if (!groupSatisfied) {
          missing.push(att);
        } else {
          satisfiedGroups.add(att.group);
        }
      }
    } else if (!uploaded) {
      missing.push(att);
    }
  }

  // De-duplicate by group
  const deduplicated = missing.reduce<AttachmentDescriptor[]>((acc, item) => {
    if (item.group && acc.some((a) => a.group === item.group)) return acc;
    acc.push(item);
    return acc;
  }, []);

  const missingMessage = deduplicated.length === 0
    ? ''
    : `Anexos obrigatórios ausentes: ${deduplicated.map((d) => `"${d.label}"`).join(', ')}.`;

  return {
    valid: deduplicated.length === 0,
    missingRequired: deduplicated,
    missingMessage,
  };
}
