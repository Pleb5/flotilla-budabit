export type RichContentPayload = {
  content: string;
  tags?: string[][];
};

export type RichComposerMode = "comment" | "reply" | "edit" | "inline" | "description";

export type RichComposerContext = {
  url?: string;
  relays?: string[];
  repoAddress?: string;
  relayHint?: string;
  rootEvent?: {
    id: string;
    kind: number | string;
    pubkey?: string;
    tags?: string[][];
  };
  blossomContext?: unknown;
};

export type RichCommentComposerProps = {
  initialContent?: string;
  placeholder?: string;
  submitLabel?: string;
  cancelLabel?: string;
  mode?: RichComposerMode;
  compact?: boolean;
  disabled?: boolean;
  submitting?: boolean;
  context?: RichComposerContext;
  onSubmit: (payload: RichContentPayload) => void | Promise<void>;
  onCancel?: () => void;
  onEscape?: () => void;
};

export type RichDescriptionEditorHandle = {
  getContent: () => Promise<RichContentPayload>;
  focus?: () => void;
};

export type RichDescriptionEditorProps = {
  initialContent?: string;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
  context?: RichComposerContext;
  onReady?: (handle: RichDescriptionEditorHandle) => void;
  onChange?: (payload: RichContentPayload) => void;
};
