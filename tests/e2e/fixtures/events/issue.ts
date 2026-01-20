/**
 * NIP-34 Issue Event Fixtures
 * Kind 1621: Issue
 */

import {
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
  getRepoAddress,
  type UnsignedEvent,
} from './repo';

// Test event IDs for issues
export const TEST_ISSUE_IDS = {
  issue1: 'i1'.padEnd(64, '0'),
  issue2: 'i2'.padEnd(64, '0'),
  issue3: 'i3'.padEnd(64, '0'),
  bugReport: 'i4'.padEnd(64, '0'),
  featureRequest: 'i5'.padEnd(64, '0'),
} as const;

/**
 * Options for creating an Issue event (kind 1621)
 */
export interface IssueOptions {
  /** Issue body/description in markdown - required */
  content: string;
  /** Repository address (a tag) - required */
  repoAddress: string;
  /** Issue subject/title */
  subject?: string;
  /** Recipient pubkeys (maintainers, assignees) */
  recipients?: string[];
  /** Labels/hashtags for categorization */
  labels?: string[];
  /** Reference to related event IDs */
  references?: string[];
  /** Event pubkey (author) */
  pubkey?: string;
  /** Event timestamp (seconds) */
  created_at?: number;
}

/**
 * Creates an Issue event (kind 1621)
 *
 * NIP-34 specifies this event represents a git issue.
 * Required tags: a (repo reference)
 * Optional tags: subject, p (recipients), t (labels), e (references)
 */
export function createIssue(opts: IssueOptions): UnsignedEvent {
  const tags: string[][] = [
    ['a', opts.repoAddress],
  ];

  if (opts.subject) {
    tags.push(['subject', opts.subject]);
  }

  if (opts.recipients) {
    for (const p of opts.recipients) {
      tags.push(['p', p]);
    }
  }

  if (opts.labels) {
    for (const label of opts.labels) {
      tags.push(['t', label]);
    }
  }

  if (opts.references) {
    for (const ref of opts.references) {
      tags.push(['e', ref]);
    }
  }

  return {
    kind: 1621,
    created_at: opts.created_at ?? BASE_TIMESTAMP,
    tags,
    content: opts.content,
    pubkey: opts.pubkey ?? TEST_PUBKEYS.charlie,
  };
}

// ============================================================================
// Pre-built Fixtures
// ============================================================================

const DEFAULT_REPO_ADDRESS = getRepoAddress(TEST_PUBKEYS.alice, 'test-repo');
const FLOTILLA_REPO_ADDRESS = getRepoAddress(TEST_PUBKEYS.alice, 'flotilla-budabit');

/**
 * Minimal issue with only required fields
 */
export const MINIMAL_ISSUE = createIssue({
  content: 'There is a problem with the application.',
  repoAddress: DEFAULT_REPO_ADDRESS,
});

/**
 * Bug report issue
 */
export const BUG_REPORT_ISSUE = createIssue({
  content: `## Description
The application crashes when clicking the submit button on the form.

## Steps to Reproduce
1. Go to the settings page
2. Fill in the form fields
3. Click "Submit"
4. Application crashes with error

## Expected Behavior
Form should submit successfully and show a confirmation message.

## Actual Behavior
Application shows a blank screen and console shows:
\`\`\`
TypeError: Cannot read property 'value' of null
\`\`\`

## Environment
- Browser: Chrome 120
- OS: macOS 14.2
- Version: 1.2.3`,
  repoAddress: FLOTILLA_REPO_ADDRESS,
  subject: 'App crashes on form submission',
  recipients: [TEST_PUBKEYS.alice, TEST_PUBKEYS.maintainer],
  labels: ['bug', 'critical', 'ui'],
  pubkey: TEST_PUBKEYS.charlie,
  created_at: BASE_TIMESTAMP,
});

/**
 * Feature request issue
 */
export const FEATURE_REQUEST_ISSUE = createIssue({
  content: `## Feature Request
It would be great to have dark mode support in the application.

## Use Case
Many users prefer dark mode, especially when using the app at night. This would reduce eye strain and improve the user experience.

## Proposed Solution
- Add a toggle in settings for dark/light mode
- Detect system preference by default
- Save user preference in local storage

## Additional Context
Similar to how Discord handles theming - simple toggle with system preference detection.`,
  repoAddress: FLOTILLA_REPO_ADDRESS,
  subject: 'Add dark mode support',
  recipients: [TEST_PUBKEYS.alice],
  labels: ['enhancement', 'ui', 'good-first-issue'],
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP + 3600,
});

/**
 * Documentation issue
 */
export const DOCS_ISSUE = createIssue({
  content: `## Documentation Issue
The README is missing instructions for setting up the development environment.

## What's Missing
- Node.js version requirements
- How to install dependencies
- How to run the development server
- How to run tests

## Suggested Sections
1. Prerequisites
2. Installation
3. Development
4. Testing
5. Contributing`,
  repoAddress: FLOTILLA_REPO_ADDRESS,
  subject: 'Improve README with setup instructions',
  labels: ['documentation', 'good-first-issue'],
  pubkey: TEST_PUBKEYS.charlie,
  created_at: BASE_TIMESTAMP + 7200,
});

/**
 * Issue with references to commits/events
 */
export const ISSUE_WITH_REFERENCES = createIssue({
  content: `## Regression in v2.0.0
After the changes in commit ${TEST_COMMITS.third}, the authentication flow is broken.

See also: related discussion in the PR.`,
  repoAddress: FLOTILLA_REPO_ADDRESS,
  subject: 'Authentication broken after recent changes',
  recipients: [TEST_PUBKEYS.alice, TEST_PUBKEYS.bob],
  labels: ['bug', 'regression', 'auth'],
  references: [TEST_COMMITS.third],
  pubkey: TEST_PUBKEYS.charlie,
  created_at: BASE_TIMESTAMP + 10800,
});

/**
 * Security issue (typically would be private but shown here for testing)
 */
export const SECURITY_ISSUE = createIssue({
  content: `## Security Vulnerability
Found a potential XSS vulnerability in the comment rendering.

## Details
User input in comments is not properly sanitized before rendering.

## Impact
Malicious users could inject scripts that steal session tokens.

## Recommended Fix
Use DOMPurify or similar library to sanitize HTML content.`,
  repoAddress: FLOTILLA_REPO_ADDRESS,
  subject: 'XSS vulnerability in comment rendering',
  recipients: [TEST_PUBKEYS.alice, TEST_PUBKEYS.maintainer],
  labels: ['security', 'critical', 'bug'],
  pubkey: TEST_PUBKEYS.bob,
  created_at: BASE_TIMESTAMP + 14400,
});

/**
 * Question/discussion issue
 */
export const QUESTION_ISSUE = createIssue({
  content: `## Question
Is there a way to customize the relay list at runtime?

I'd like to let users add their own relays in the settings. Is this currently supported? If not, would it be possible to add this feature?

Thanks!`,
  repoAddress: FLOTILLA_REPO_ADDRESS,
  subject: 'How to customize relay list?',
  labels: ['question', 'help-wanted'],
  pubkey: TEST_PUBKEYS.charlie,
  created_at: BASE_TIMESTAMP + 18000,
});

/**
 * Issue assigned to specific maintainer
 */
export const ASSIGNED_ISSUE = createIssue({
  content: `## Task
Implement rate limiting for API endpoints.

## Requirements
- Max 100 requests per minute per user
- Return 429 status when limit exceeded
- Include retry-after header

## Acceptance Criteria
- [ ] Rate limiter middleware implemented
- [ ] Tests cover edge cases
- [ ] Documentation updated`,
  repoAddress: FLOTILLA_REPO_ADDRESS,
  subject: 'Implement API rate limiting',
  recipients: [TEST_PUBKEYS.bob], // Assigned to Bob
  labels: ['enhancement', 'backend', 'in-progress'],
  pubkey: TEST_PUBKEYS.alice,
  created_at: BASE_TIMESTAMP + 21600,
});

// Re-export for convenience
export { TEST_PUBKEYS, TEST_COMMITS, BASE_TIMESTAMP, getRepoAddress };
