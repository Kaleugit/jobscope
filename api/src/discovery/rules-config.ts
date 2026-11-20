// Every term the deterministic filters use lives here, so tuning a rule is
// editing a list, not hunting through code. Matching is done on folded text
// (lowercase, no accents, punctuation as spaces), so write terms the same way:
// "u s only" is not needed, "us only" matches "U.S. only" and "US-only".
//
// Changing a list changes behavior covered by api/test/rules.test.ts: run the
// tests after editing.

// ── Area pre-filter ──────────────────────────────────────────────────────
// Runs on the title, before any LLM. Order: hard exclusions, then inclusions,
// then soft exclusions, then the source's own category.

/** Specialized domains out of reach no matter what the title says. Always out. */
export const AREA_HARD_EXCLUDE = [
  "embedded", "firmware", "hardware", "fpga", "asic", "pcb", "rf engineer",
  "mechanical", "electrical", "civil engineer", "chemical", "structural",
  "process engineer", "manufacturing", "hvac", "nurse", "physician", "pharmacist",
  "therapist", "dentist", "driver", "warehouse", "mechanic", "unreal", "unreal engine",
  "game engine", "obras",
];

/** Core technical nouns. A title with one of these is in even when it also
 *  carries a non-technical word ("Sales Engineer", "Customer Support Engineer"). */
export const AREA_CORE = [
  "engineer", "engineering", "developer", "desenvolvedor", "desenvolvedora", "programador",
  "programadora", "programmer", "sre", "devops", "sdet", "qa", "data scientist", "data engineer",
  "data analyst", "analytics engineer", "cientista de dados", "engenheiro", "engenheira",
];

/** Technical families the owner applies to, AI evaluation included. Lose to
 *  AREA_SOFT_EXCLUDE unless the title also has an AREA_CORE noun. */
export const AREA_INCLUDE = [
  "software", "full stack", "fullstack", "frontend", "front end", "backend", "back end", "web",
  "mobile", "android", "ios", "react", "angular", "node", "nodejs", "typescript", "javascript",
  "python", "golang", "java", "kotlin", "platform", "cloud", "infrastructure", "data", "dados",
  "analytics", "bi", "business intelligence", "machine learning", "ml", "ai", "llm", "genai",
  "artificial intelligence", "inteligencia artificial", "quality", "test", "tester", "automation",
  "implementation", "solutions", "integration", "integrations", "forward deployed", "technical",
  "it", "systems", "rlhf", "ai trainer", "ai tutor", "evaluator", "annotator", "prompt",
  "model evaluation", "stem expert", "implementacao", "integracao", "integracoes",
  "sistemas", "suporte tecnico", "infraestrutura", "testes", "automacao", "desarrollador",
  "ingeniero", "base de datos",
  "language expert", "bilingual expert", "portuguese", "linguist",
];

/** Non-technical families. Beat AREA_INCLUDE, lose to AREA_CORE. */
export const AREA_SOFT_EXCLUDE = [
  "sales", "account executive", "account manager", "sdr", "bdr", "business development",
  "marketing", "growth", "seo", "content", "copywriter", "writer", "editor", "social media",
  "recruiter", "recruiting", "talent", "people partner", "human resources", "hr",
  "finance", "financial", "accountant", "accounting", "bookkeeper", "payroll", "tax", "legal", "lawyer",
  "paralegal", "customer success", "customer service", "customer support", "support specialist",
  "call center", "receptionist", "assistant", "office manager", "designer", "illustrator",
  "photographer", "video editor", "operations manager", "project coordinator", "procurement",
  "teacher", "tutor", "coach", "consultant", "product owner", "product manager",
  "scrum master", "project manager", "gerente de projetos", "agile coach", "comercial",
  "administrativo", "auditor", "audit",
];

/** Source categories that settle the area when the title is not conclusive. */
export const AREA_CATEGORY_INCLUDE = [
  "developer", "full stack programming", "back end programming", "front end programming",
  "devops and sysadmin", "software development", "data science", "data and analytics",
  "artificial intelligence", "information technology", "qa", "engineering",
];

// ── Remote check ─────────────────────────────────────────────────────────

/** Structured workplace values that mean the job is not remote. */
export const NOT_REMOTE_WORKPLACE = ["hybrid", "onsite", "on site", "in office", "office"];

// ── LATAM, layer 1 ───────────────────────────────────────────────────────

/** Places that include Brazil. Matched against structured location fields
 *  (Himalayas restrictions, Remotive candidate location, WWR region, ATS
 *  location). A match there confirms by rule. Country codes are handled apart. */
export const LATAM_LOCATIONS = [
  "brazil", "brasil", "latam", "latin america", "south america", "americas",
  "sao paulo", "rio de janeiro", "lat am",
];

/** Words in a location value that name no place. A value that is only these
 *  ("Remote", "Anywhere in the World", "Worldwide") means open to anyone:
 *  probable by rule. Anything left after removing them is some other place, so
 *  the value excludes Brazil ("USA Only", "Remote/Greece", "Any State"). */
export const PLACELESS_LOCATION_WORDS = [
  "remote", "remotely", "fully", "100", "worldwide", "anywhere", "in", "the", "world",
  "global", "globally", "international", "only", "based", "first", "friendly", "work",
  "from", "home", "distributed", "flexible", "location", "locations", "any", "everywhere",
  "time", "zone", "zones", "timezone", "timezones", "or", "and", "multiple", "various",
];

/** Country codes from ATS fields (Lever "country") that confirm. Only Brazil:
 *  a Mexico-only job is Latin American and still closed to someone in Brazil.
 *  Other codes do not discard either, since Lever's code is the posting's
 *  primary country, not a restriction; the location field decides. */
export const BRAZIL_COUNTRY_CODES = ["br"];

/** Negative phrases in the description or location. Always win; the LLM can
 *  never lift a job these discarded. */
export const LATAM_NEGATIVE_PHRASES = [
  "us only", "usa only", "u s only", "united states only", "us based only",
  "must be based in the us", "must be based in the united states",
  "must be located in the us", "must be located in the united states",
  "must reside in the us", "must reside in the united states",
  "must live in the us", "must live in the united states",
  "authorized to work in the us", "authorized to work in the united states",
  "authorization to work in the us", "authorization to work in the united states",
  "eligible to work in the us", "eligible to work in the united states",
  "legally authorized to work in the united states",
  "us citizen", "us citizens", "u s citizen", "u s citizens", "us citizenship",
  "green card", "us persons", "u s persons",
  "w 2", "w2 employee", "w2 only",
  "eu only", "europe only", "must be based in the eu", "must be based in europe",
  "eligible to work in the eu", "right to work in the eu", "uk only",
  "right to work in the uk", "must be based in the uk", "eligible to work in the uk",
  "canada only", "must be based in canada", "eligible to work in canada",
  "security clearance", "active clearance", "secret clearance", "ts sci",
];

/** "must reside in <X>", "must be based in <X>" (on folded text): captures up to
 *  four words after "in". X outside RESIDENCE_OK discards, unless it is not a
 *  place at all ("in a compatible timezone", "in one of these countries"). */
export const RESIDENCE_PATTERN =
  /\b(?:must|required to|need to|needs to|should) (?:reside|live|be based|be located|be living|be residing) (?:in|within) (?:the )?((?:[a-z]+ ?){1,4})/g;

/** First words of a residence capture that mean it does not name a place. */
export const RESIDENCE_NOT_A_PLACE = ["a", "an", "one", "any", "your", "our", "time", "timezone", "these", "this", "following", "approved", "supported", "eligible", "country", "countries", "region", "regions", "location", "locations"];

/** Places that make a residence requirement compatible with living in Brazil.
 *  "Must reside in Mexico" is not: only Brazil or a region containing it. */
export const RESIDENCE_OK = ["brazil", "brasil", "latam", "latin america", "south america", "americas", "lat am"];

/** Positive phrases in the description. Make the job ambiguous-leaning-yes: the
 *  LLM confirms with a literal quote. */
export const LATAM_POSITIVE_PHRASES = [
  "latam", "latin america", "south america", "brazil", "brasil", "worldwide", "anywhere in the world",
  "work from anywhere", "americas", "utc 3", "utc 4", "utc 5", "gmt 3", "est overlap",
  "edt overlap", "eastern time overlap", "overlap with est", "overlap with eastern",
];

// ── Experience Barrier ───────────────────────────────────────────────────

/** Title words that mean a senior level. Every senior level is out. */
export const SENIOR_TITLE_WORDS = [
  "senior", "sr", "senior level", "staff", "principal", "lead", "tech lead", "head", "director",
  "vp", "vice president", "chief", "manager", "architect", "distinguished", "fellow",
  "especialista", "iii", "iv", "arquiteto", "arquiteta", "gerente", "coordenador",
  "coordenadora", "coordinator", "lider", "master",
];

/** Himalayas seniority values that block when they are the only ones listed. */
export const SENIOR_SENIORITY_HINTS = ["senior", "director", "executive", "manager"];

/** Number words up to ten, for "five years of experience". */
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10,
};

// ── Local Market ─────────────────────────────────────────────────────────

/** Signals of a Brazilian company paying in BRL. "R$" is matched apart, on the
 *  raw text, since folding drops the "$". A Portuguese description counts too. */
export const LOCAL_MARKET_PHRASES = [
  "clt", "regime clt", "brl", "vale refeicao", "vale alimentacao", "plano de saude",
  "beneficios", "pessoa desenvolvedora", "cnpj", "pj",
];

// ── Agency ───────────────────────────────────────────────────────────────

/** Staff augmentation and nearshore phrases. */
export const AGENCY_PHRASES = [
  "staff augmentation", "nearshore", "near shore", "one of our clients", "our client",
  "our clients", "for a client", "client project", "placed with", "talent network",
  "talent marketplace", "we connect", "top us companies", "u s based clients", "us based clients",
  "outsourcing", "dedicated teams",
];

/** Known agencies by normalized company name. */
export const AGENCY_COMPANIES = [
  "coderoad", "jetbridge", "bairesdev", "turing", "toptal", "andela", "revelo", "x team",
  "crossover", "lemon io", "arc", "near", "terminal", "howdy", "scalable path", "azumo",
  "bluelight", "wizeline", "globant", "ciklum", "epam", "endava", "encora", "nearsure",
  "distillery", "xperteez technology",
];
