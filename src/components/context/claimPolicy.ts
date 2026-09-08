import type {
  ContextCategory,
  ParticipationLens,
  SourceClass,
  SourcePolicy,
} from "@/lib/ipc";

export interface ParticipationLensOption {
  value: ParticipationLens;
  label: string;
  description: string;
}

const LENSES: Record<ContextCategory, ParticipationLensOption[]> = {
  interview: [
    { value: "interviewee", label: "Candidate", description: "Connect claims to your prepared experience and likely follow-ups." },
    { value: "interviewer", label: "Interviewer / hiring team", description: "Track candidate claims and useful clarification questions." },
    { value: "interview_observer_coach", label: "Observer / coach", description: "Watch claim quality, follow-ups, and coaching opportunities." },
  ],
  company_meeting: [
    { value: "meeting_participant", label: "Participant", description: "Track figures, risks, decisions, and commitments that affect you." },
    { value: "meeting_lead", label: "Facilitator / meeting owner", description: "Keep proposals, conflicts, decisions, and owners clear." },
    { value: "meeting_presenter", label: "Presenter", description: "Prioritize claims you may need to explain or support." },
    { value: "meeting_decision_owner", label: "Decision owner / executive", description: "Surface consequential assumptions, conflicts, and unresolved inputs." },
    { value: "meeting_observer", label: "Observer / note owner", description: "Capture attributable facts, decisions, and open questions." },
  ],
  sales_call: [
    { value: "seller", label: "Seller / account team", description: "Retrieve approved proof and avoid unsupported promises." },
    { value: "buyer", label: "Buyer / evaluator", description: "Track conditions, exclusions, evidence, and commitments." },
    { value: "sales_customer_success", label: "Customer success / account manager", description: "Prioritize implementation constraints and mutual commitments." },
    { value: "sales_coach", label: "Sales manager / coach", description: "Watch claim quality, objections, and safe response guidance." },
  ],
  live_stream: [
    { value: "live_host", label: "Host / creator", description: "Put high-consequence and fast-moving claims first for safe on-air use." },
    { value: "live_guest", label: "Guest", description: "Track claims attributed to you and questions that need context." },
    { value: "live_producer", label: "Producer / researcher", description: "Manage the verification queue, conflicts, and source admission." },
    { value: "live_moderator", label: "Moderator", description: "Prioritize clarification, disclosures, and repeated audience questions." },
  ],
  other: [
    { value: "other_speaker", label: "Participant", description: "Prioritize claims and questions relevant to your purpose." },
    { value: "other_facilitator", label: "Facilitator", description: "Track shared facts, decisions, and unresolved points." },
    { value: "other_advisor", label: "Advisor / advocate", description: "Surface consequential claims and evidence that affect the person you support." },
    { value: "other_presenter", label: "Presenter", description: "Prioritize claims you may need to explain or support." },
    { value: "other_listener", label: "Observer / note owner", description: "Capture attributable facts, decisions, and follow-ups." },
  ],
};

export const SOURCE_CLASS_OPTIONS: Array<{
  value: Exclude<SourceClass, "model_knowledge">;
  label: string;
  note: string;
}> = [
  { value: "context_document", label: "Documents attached to this Context", note: "local" },
  { value: "approved_internal_repository", label: "Approved internal repositories", note: "internal" },
  { value: "primary_official", label: "Primary official records and statements", note: "authoritative" },
  { value: "recognized_reporting", label: "Recognized reporting", note: "corroboration" },
  { value: "specialist_reference", label: "Specialist references", note: "domain evidence" },
  { value: "general_web_discovery", label: "General web discovery", note: "discovery only" },
  { value: "community_material", label: "Community material and anonymous posts", note: "lowest priority" },
];

export function sourceClassUsesOpenWeb(sourceClass: SourceClass): boolean {
  return [
    "primary_official",
    "recognized_reporting",
    "specialist_reference",
    "community_material",
    "general_web_discovery",
  ].includes(sourceClass);
}

export function participationLenses(category: ContextCategory): ParticipationLensOption[] {
  return LENSES[category];
}

export function defaultParticipationLens(category: ContextCategory): ParticipationLens {
  return LENSES[category][0]!.value;
}

export function effectiveParticipationLens(
  category: ContextCategory,
  lens?: ParticipationLens | null,
): ParticipationLens {
  return LENSES[category].some((option) => option.value === lens)
    ? lens!
    : defaultParticipationLens(category);
}

export function participationLensLabel(
  category: ContextCategory,
  lens?: ParticipationLens | null,
): string {
  const effective = effectiveParticipationLens(category, lens);
  return LENSES[category].find((option) => option.value === effective)!.label;
}

export function createContextSourcePolicyId(contextId?: string): string {
  if (contextId) return `context-policy-${contextId}`;
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `context-policy-${id}`;
}

export function defaultSourcePolicy(
  category: ContextCategory,
  id = `default-${category.replaceAll("_", "-")}`,
): SourcePolicy {
  const internal: SourceClass[] = ["context_document", "approved_internal_repository"];
  const publicSources: SourceClass[] = [
    "primary_official",
    "recognized_reporting",
    "specialist_reference",
  ];

  switch (category) {
    case "interview":
    case "sales_call":
      return policy(id, [...internal, ...publicSources], true, true, true, true, 24 * 30);
    case "company_meeting":
      return policy(id, internal, false, false, true, true, null);
    case "live_stream":
      return policy(id, [...publicSources, "general_web_discovery"], true, true, false, true, 24);
    case "other":
      return policy(id, internal, false, false, true, false, null);
  }
}

function policy(
  id: string,
  allowedClasses: SourceClass[],
  allowOpenWeb: boolean,
  allowNormalizedClaimEgress: boolean,
  allowCachedEvidence: boolean,
  allowAutomaticChecks: boolean,
  freshnessWindowHours: number | null,
): SourcePolicy {
  return {
    id,
    version: 1,
    allowed_classes: allowedClasses,
    allowed_domains: [],
    blocked_domains: [],
    allow_open_web: allowOpenWeb,
    allow_normalized_claim_egress: allowNormalizedClaimEgress,
    allow_private_claim_egress: false,
    allow_cached_evidence: allowCachedEvidence,
    allow_automatic_checks: allowAutomaticChecks,
    freshness_window_hours: freshnessWindowHours,
    minimum_independent_sources: 1,
    high_consequence_requirement: "primary_official_or_independent_reports",
  };
}

export function normalizeDomains(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((domain) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]!.replace(/\.$/, ""))
        .filter(Boolean),
    ),
  ).slice(0, 32);
}

export function normalizeSourcePolicy(
  category: ContextCategory,
  stored: SourcePolicy | null | undefined,
  fallbackId?: string,
): SourcePolicy {
  const fallback = defaultSourcePolicy(category, fallbackId);
  if (!stored) return fallback;
  const allowOpenWeb = Boolean(stored.allow_open_web);
  const allowed = SOURCE_CLASS_OPTIONS.map((option) => option.value).filter(
    (sourceClass) =>
      stored.allowed_classes.includes(sourceClass) &&
      (allowOpenWeb || !sourceClassUsesOpenWeb(sourceClass)),
  );
  const allowNormalizedEgress = allowOpenWeb && Boolean(stored.allow_normalized_claim_egress);
  return {
    ...fallback,
    ...stored,
    id: stored.id || fallback.id,
    version: Math.max(1, Math.trunc(stored.version || 1)),
    allowed_classes: allowed,
    allowed_domains: normalizeDomains(stored.allowed_domains.join("\n")),
    blocked_domains: normalizeDomains(stored.blocked_domains.join("\n")),
    allow_open_web: allowOpenWeb,
    allow_normalized_claim_egress: allowNormalizedEgress,
    allow_private_claim_egress:
      allowNormalizedEgress && Boolean(stored.allow_private_claim_egress),
    minimum_independent_sources: Math.min(
      5,
      Math.max(1, Math.trunc(stored.minimum_independent_sources || 1)),
    ),
  };
}

export function sourcePolicyDisclosure(policy: SourcePolicy): string {
  if (!policy.allow_open_web || !policy.allow_normalized_claim_egress) {
    return "Claim text stays on this device. Checks use attached Context documents and permitted internal evidence only.";
  }
  if (policy.allow_private_claim_egress) {
    return "Approved research may send the normalized claim and necessary qualifiers, including private transcript details. The full transcript is never sent by this policy.";
  }
  return "Web research sends only the normalized claim and necessary event qualifiers—not the full transcript. Private personal assertions stay local.";
}
