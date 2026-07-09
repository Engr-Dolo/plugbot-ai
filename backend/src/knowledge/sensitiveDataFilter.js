import { normalizeText } from "./normalizer.js";

const rejectionPatterns = [
  {
    category: "PRIVATE_KEY_BLOCK",
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/gi
  },
  {
    category: "DATABASE_CREDENTIAL_URL",
    regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^:\s/@]+:[^@\s]+@[^\s]+/gi
  },
  {
    category: "ENV_SECRET_ASSIGNMENT",
    regex: /(?:^|\n)\s*(?:[A-Z0-9_]*?(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|CLIENT_SECRET)[A-Z0-9_]*?)\s*=\s*[^\n]+/gi
  }
];

const redactionPatterns = [
  {
    category: "SSN_PATTERN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g
  },
  {
    category: "PAYMENT_CARD_PATTERN",
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    validate: luhnLooksValid
  },
  {
    category: "JWT_PATTERN",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
  },
  {
    category: "BEARER_TOKEN",
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi
  },
  {
    category: "AUTHORIZATION_HEADER",
    regex: /\bAuthorization\s*:\s*[^\n\r]+/gi
  },
  {
    category: "API_KEY_PATTERN",
    regex: /\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16})\b/g
  },
  {
    category: "OAUTH_CLIENT_SECRET",
    regex: /\b(?:client_secret|oauth_secret)\s*[:=]\s*[A-Za-z0-9._~+/=-]{16,}\b/gi
  },
  {
    category: "PASSWORD_ASSIGNMENT",
    regex: /\b(?:password|passwd|pwd)\s*[:=]\s*[^\s"'`]{6,}/gi
  },
  {
    category: "SECRET_ASSIGNMENT",
    regex: /\b(?:secret|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?id)\s*[:=]\s*[A-Za-z0-9._~+/=-]{12,}/gi
  },
  {
    category: "HIGH_ENTROPY_TOKEN",
    regex: /\b[A-Za-z0-9+/=_-]{32,}\b/g,
    validate: looksHighEntropy
  }
];

export function filterSensitiveContent(text, options = {}) {
  let filtered = normalizeText(text);
  const findings = [];

  for (const pattern of rejectionPatterns) {
    const matches = collectMatches(filtered, pattern);
    if (matches.length > 0) {
      findings.push({ category: pattern.category, count: matches.length, action: "rejected" });
      return {
        status: "rejected",
        text: "",
        findings
      };
    }
  }

  for (const pattern of redactionPatterns) {
    let count = 0;
    filtered = filtered.replace(pattern.regex, (match) => {
      if (pattern.validate && !pattern.validate(match, options)) {
        return match;
      }

      count += 1;
      return `[REDACTED:${pattern.category}]`;
    });

    if (count > 0) {
      findings.push({ category: pattern.category, count, action: "redacted" });
    }
  }

  return {
    status: findings.length > 0 ? "redacted" : "clean",
    text: filtered,
    findings
  };
}

export function summarizeFindings(findings) {
  const summary = new Map();

  for (const finding of findings || []) {
    const key = `${finding.category}:${finding.action}`;
    const current = summary.get(key) || {
      category: finding.category,
      action: finding.action,
      count: 0
    };
    current.count += finding.count;
    summary.set(key, current);
  }

  return Array.from(summary.values());
}

function collectMatches(text, pattern) {
  const matches = [];
  pattern.regex.lastIndex = 0;
  let match;
  while ((match = pattern.regex.exec(text))) {
    if (!pattern.validate || pattern.validate(match[0])) {
      matches.push(match[0]);
    }
  }
  return matches;
}

function luhnLooksValid(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^0+$/.test(digits)) {
    return false;
  }

  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }

  return sum % 10 === 0;
}

function looksHighEntropy(value) {
  if (/\b[A-Fa-f0-9]{32,}\b/.test(value)) {
    return true;
  }

  const uniqueChars = new Set(value).size;
  const hasMixedClasses =
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[+/=_-]/.test(value);

  return value.length >= 40 && uniqueChars >= 16 && hasMixedClasses;
}
