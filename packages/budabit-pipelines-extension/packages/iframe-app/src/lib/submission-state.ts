import { buildRerunDraft } from './workflows';
import { buildRunnerScriptTemplate } from './runner-script';
import { createNewRunDraft } from './submission';
import type { RepoContextNormalized, RerunDraft, WorkflowRunDetail } from './types';

export interface SubmissionResetState {
  rerunDraft: RerunDraft | null;
  submissionMode: 'new' | 'rerun' | null;
  rerunArgsText: string;
  rerunPaymentToken: string;
  rerunSecrets: Array<{ key: string; value: string }>;
  rerunCommandMode: 'reuse' | 'regenerate';
  runnerScriptTemplate: string;
  runnerScriptAutoManaged: boolean;
  autoTokenPromptOpen: boolean;
  autoTokenPromptKey: string;
  autoTokenDismissedKey: string;
}

export interface PreparedSubmissionState extends SubmissionResetState {
  rerunDraft: RerunDraft;
  submissionMode: 'new' | 'rerun';
}

export function createEmptySecrets() {
  return [{ key: '', value: '' }];
}

export function createSubmissionResetState(): SubmissionResetState {
  return {
    rerunDraft: null,
    submissionMode: null,
    rerunArgsText: '',
    rerunPaymentToken: '',
    rerunSecrets: createEmptySecrets(),
    rerunCommandMode: 'reuse',
    runnerScriptTemplate: '',
    runnerScriptAutoManaged: true,
    autoTokenPromptOpen: false,
    autoTokenPromptKey: '',
    autoTokenDismissedKey: '',
  };
}

export function prepareNewRunSubmissionState(
  repo: RepoContextNormalized
): PreparedSubmissionState | null {
  const rerunDraft = createNewRunDraft(repo);
  if (!rerunDraft) return null;

  return {
    ...createSubmissionResetState(),
    rerunDraft,
    submissionMode: 'new',
    rerunArgsText: rerunDraft.args.join('\n'),
    runnerScriptTemplate: buildRunnerScriptTemplate('', null, 'main'),
  };
}

export function prepareRerunSubmissionState(args: {
  repo: RepoContextNormalized;
  runDetail: WorkflowRunDetail;
}): PreparedSubmissionState | null {
  const nextDraft = buildRerunDraft(args.repo, args.runDetail);
  if (!nextDraft) return null;

  const rerunDraft = {
    ...nextDraft,
    envVars: nextDraft.envVars.map((entry) => ({ ...entry })),
    args: [...nextDraft.args],
    publishRelays: [...nextDraft.publishRelays],
  };

  return {
    ...createSubmissionResetState(),
    rerunDraft,
    submissionMode: 'rerun',
    rerunArgsText: rerunDraft.args.join('\n'),
    runnerScriptTemplate: buildRunnerScriptTemplate(
      rerunDraft.workflowPath,
      null,
      rerunDraft.branch
    ),
  };
}
