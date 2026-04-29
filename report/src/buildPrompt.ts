import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BusinessContext, Ga4Data } from './loadInputs.js';

const projectRoot = resolve(import.meta.dirname, '..');

export const PROMPT_VERSION = 'v0.1.0';

export type PromptBundle = {
  system: string;
  user: string;
  promptVersion: string;
};

export function buildPrompt(args: {
  ga4Data: Ga4Data;
  businessContext: BusinessContext;
}): PromptBundle {
  const { ga4Data, businessContext } = args;

  const systemPath = resolve(projectRoot, 'prompts', 'system.md');
  const systemBase = readFileSync(systemPath, 'utf8');

  const regulatoryFile = pickRegulatoryFile(businessContext.industry);
  const regulatoryPath = resolve(
    projectRoot,
    'prompts',
    'regulatory',
    regulatoryFile,
  );
  const regulatory = existsSync(regulatoryPath)
    ? readFileSync(regulatoryPath, 'utf8')
    : '';

  const system = regulatory
    ? `${systemBase.trim()}\n\n---\n\n${regulatory.trim()}\n`
    : systemBase;

  const user = JSON.stringify({ ga4Data, businessContext }, null, 2);

  return { system, user, promptVersion: PROMPT_VERSION };
}

function pickRegulatoryFile(industry: BusinessContext['industry']): string {
  switch (industry) {
    case 'medical':
      return 'medical.md';
    case 'cosmetics':
      return 'cosmetics.md';
    default:
      return 'ec-general.md';
  }
}
