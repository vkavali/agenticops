import Anthropic from '@anthropic-ai/sdk';

// IaC remediation agent.
//
// Given Terraform source + an incident + a `terraform plan` output, the agent
// proposes a unified-diff patch that should resolve the incident. We use:
// - claude-opus-4-7 with adaptive thinking + effort:"xhigh" (best for coding/agentic)
// - Prompt caching: the system prompt + Terraform source live in cached blocks;
//   the incident details vary per call. Render order is tools → system →
//   messages, so a cache_control on the last system block caches everything
//   before it. Repeated calls for the same iac_config hit the same cache.
// - Streaming because we're requesting a generous max_tokens (Opus 4.7 ceiling
//   is 128K) and a long agentic loop benefits from incremental output.

const SYSTEM_INSTRUCTIONS = `You are an SRE agent inside the AgenticOps control plane. Your job is to propose
the smallest correct Terraform patch that resolves the reported incident.

Output contract:

1. Output a short DIAGNOSIS section (≤ 6 lines) explaining what's wrong and
   which resource needs to change. Cite file paths and resource addresses.
2. Then output a UNIFIED DIFF in standard \`git diff\` / \`patch -p1\` format,
   delimited by a fenced code block tagged \`diff\`. No prose inside the block.
3. Finally, output a 2-line BLAST RADIUS section: estimated cost delta and
   whether the change requires resource recreation.

Hard rules:

- Modify only what is necessary to resolve the incident. Do not refactor.
- Never widen security group ingress, never disable encryption, never
  weaken IAM policies, never expose secrets — even if the incident framing
  suggests it. If the incident asks for any of these, refuse with an
  explanation in the DIAGNOSIS and emit an EMPTY diff.
- If the plan shows the incident is already mitigated (no diff needed),
  emit an EMPTY diff and say so.
- If the root cause is outside the provided Terraform (application code,
  external service), say so plainly and emit an EMPTY diff.

You will be given:
- The full Terraform source for the configuration (cached, stable).
- The latest \`terraform plan\` output (varies).
- The incident details and recent metrics/logs (varies).`;

let _client = null;
function client() {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set — agent diagnosis disabled.');
  }
  _client = new Anthropic();
  return _client;
}

export function isAgentEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Run the IaC remediation agent.
 * @param {object} args
 * @param {string} args.tfSource - concatenated Terraform source files (cached)
 * @param {string} args.planOutput - terraform plan stdout
 * @param {object} args.incident - incident row from DB
 * @param {function(string): void} [args.onDelta] - optional streaming callback
 * @returns {Promise<{diagnosis: string, patch: string, raw: string, usage: object}>}
 */
export async function diagnoseAndPatch({ tfSource, planOutput, incident, onDelta }) {
  const c = client();

  // System blocks: stable instructions + (cached) TF source. cache_control on
  // the last system block caches both blocks. Volatile content (plan output +
  // incident) goes in the user message after the breakpoint.
  const system = [
    { type: 'text', text: SYSTEM_INSTRUCTIONS },
    {
      type: 'text',
      text: `<terraform_source>\n${tfSource}\n</terraform_source>`,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const userText = [
    `<terraform_plan>\n${planOutput || '(no plan output captured)'}\n</terraform_plan>`,
    '',
    `<incident id="${incident.id}" severity="${incident.severity}">`,
    `<title>${incident.title}</title>`,
    `<service>${incident.service}</service>`,
    `<description>${incident.description || ''}</description>`,
    `<timeline>${JSON.stringify(incident.timeline || [], null, 2)}</timeline>`,
    `</incident>`,
    '',
    'Diagnose and propose a patch per the output contract.',
  ].join('\n');

  const stream = c.messages.stream({
    model: 'claude-opus-4-7',
    max_tokens: 16000,
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: 'xhigh' },
    system,
    messages: [{ role: 'user', content: userText }],
  });

  if (onDelta) {
    stream.on('text', (delta) => { try { onDelta(delta); } catch {} });
  }

  const final = await stream.finalMessage();
  const raw = final.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const { diagnosis, patch } = parseAgentOutput(raw);

  return {
    diagnosis,
    patch,
    raw,
    usage: {
      input_tokens: final.usage.input_tokens,
      output_tokens: final.usage.output_tokens,
      cache_read_input_tokens: final.usage.cache_read_input_tokens || 0,
      cache_creation_input_tokens: final.usage.cache_creation_input_tokens || 0,
    },
  };
}

// Pull the diagnosis prose and the diff out of the agent's output.
// The diff is delimited by a fenced ```diff block.
function parseAgentOutput(raw) {
  const fenceMatch = raw.match(/```diff\n([\s\S]*?)```/);
  const patch = fenceMatch ? fenceMatch[1].trim() : '';
  const diagnosis = fenceMatch
    ? raw.slice(0, fenceMatch.index).trim()
    : raw.trim();
  return { diagnosis, patch };
}
