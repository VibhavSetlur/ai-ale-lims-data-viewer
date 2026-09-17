export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
export const MAX_SESSION_ARTIFACT_BYTES = 50 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = ['csv', 'tsv', 'json', 'txt', 'md'] as const;
export type ArtifactFormat = 'json' | 'markdown' | 'csv';

export type LocalArtifactInput = {
  name: string;
  type: string;
  size: number;
  text: string;
};

export type ArtifactMessage = {
  role: string;
  content: string;
  createdAt: string;
};

export type ResearchArtifact = {
  lifecycle: string;
  provenance: {
    generatedAt: string;
    source: string;
    inputs: Array<Pick<LocalArtifactInput, 'name' | 'type' | 'size'>>;
  };
  messages: ArtifactMessage[];
  localInputs: LocalArtifactInput[];
};

export function validateLocalArtifactInput(input: Pick<LocalArtifactInput, 'name' | 'type' | 'size'>, currentTotalBytes: number): string | null {
  const extension = input.name.toLowerCase().split('.').pop();
  if (!extension || !SUPPORTED_EXTENSIONS.includes(extension as typeof SUPPORTED_EXTENSIONS[number])) {
    return 'Upload a CSV, TSV, JSON, TXT, or Markdown file.';
  }
  if (!Number.isFinite(input.size) || input.size < 0 || input.size > MAX_ARTIFACT_BYTES) {
    return `Each file must be ${MAX_ARTIFACT_BYTES / 1024 / 1024} MiB or smaller.`;
  }
  if (currentTotalBytes + input.size > MAX_SESSION_ARTIFACT_BYTES) {
    return `Session uploads must total ${MAX_SESSION_ARTIFACT_BYTES / 1024 / 1024} MiB or smaller.`;
  }
  return null;
}

export function escapeCsvCell(value: string): string {
  const protectedValue = /^[\s\u0000-\u001F]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function createResearchArtifact(messages: ArtifactMessage[], localInputs: LocalArtifactInput[], generatedAt = new Date().toISOString()): ResearchArtifact {
  return {
    lifecycle: 'Session-scoped download. This artifact and its uploaded inputs remain only in this browser tab until it is closed or reloaded; nothing is uploaded, retained, or retrievable from the server.',
    provenance: {
      generatedAt,
      source: 'Assistant conversation messages, including responses based on allowlisted read-only LIMS tools when used.',
      inputs: localInputs.map(({ name, type, size }) => ({ name, type, size })),
    },
    messages,
    localInputs,
  };
}

export function serializeResearchArtifact(artifact: ResearchArtifact, format: ArtifactFormat): { filename: string; type: string; text: string } {
  if (format === 'json') {
    return { filename: 'lims-research-artifact.json', type: 'application/json;charset=utf-8', text: JSON.stringify(artifact, null, 2) };
  }
  if (format === 'markdown') {
    const inputs = artifact.provenance.inputs.length
      ? artifact.provenance.inputs.map((input) => `- ${input.name} (${input.type || 'unknown type'}, ${input.size} bytes)`).join('\n')
      : '- None';
    const messages = artifact.messages.map((message) => `### ${message.role} (${message.createdAt})\n\n${message.content}`).join('\n\n');
    return {
      filename: 'lims-research-artifact.md',
      type: 'text/markdown;charset=utf-8',
      text: `# LIMS research artifact\n\n## Lifecycle\n\n${artifact.lifecycle}\n\n## Provenance\n\nGenerated: ${artifact.provenance.generatedAt}\n\nSource: ${artifact.provenance.source}\n\nInputs:\n${inputs}\n\n## Conversation\n\n${messages}\n`,
    };
  }
  const rows = [
    ['role', 'created_at', 'content'],
    ...artifact.messages.map((message) => [message.role, message.createdAt, message.content]),
  ];
  return {
    filename: 'lims-research-artifact.csv',
    type: 'text/csv;charset=utf-8',
    text: `${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`,
  };
}
