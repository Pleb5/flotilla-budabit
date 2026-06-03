import type { CommentEvent, IssueEvent } from "@nostr-git/core/events";

export const FUNCTION_REGISTRY = Symbol("ui-function-registry");

export type ThunkFunction<T> = (event: T) => { controller: AbortController; complete?: Promise<any> };

export type FunctionRegistry = {
  // Functions for profiles
  getProfile: (pubkey: string) => any;
  saveProfile: (profile: any) => Promise<void>;

  // Functions for comments/discussions
  postComment: ThunkFunction<CommentEvent>;
  deleteComment: ThunkFunction<CommentEvent>;

  // Functions for issues
  postIssue: ThunkFunction<IssueEvent>;
  deleteIssue: ThunkFunction<IssueEvent>;

  // Repository functions
  fetchRepo: (id: string) => Promise<any>;
  cloneRepo: (url: string) => Promise<string>;

  // User functions
  getCurrentUser: () => any;
};

const noopAsync = async () => {
  console.warn("Function not implemented");
};
const noopSync = () => {
  console.warn("Function not implemented");
  return { controller: new AbortController() };
};

export const defaultFunctions: FunctionRegistry = {
  getProfile: (pubkey: string) => {
    console.warn("getProfile not implemented", { pubkey });
    return { pubkey, name: "Unknown User", picture: null };
  },
  saveProfile: noopAsync,

  postComment: noopSync,
  deleteComment: noopSync,

  postIssue: noopSync,
  deleteIssue: noopSync,

  fetchRepo: async () => {
    console.warn("fetchRepo not implemented");
    return null;
  },
  cloneRepo: async () => {
    console.warn("cloneRepo not implemented");
    return "";
  },

  getCurrentUser: () => {
    console.warn("getCurrentUser not implemented");
    return { pubkey: "unknown", name: "Unknown User" };
  },
};
