import { writable } from "svelte/store";

export type ContextMessage = {
  id: string;
  type: "loading" | "info" | "success" | "error" | "warning";
  message: string;
  details?: any;
  timestamp: number;
  duration?: number;
};

function createContextStore() {
  const { subscribe, update, set } = writable<Record<string, ContextMessage>>({});

  function add(message: Omit<ContextMessage, "id" | "timestamp">) {
    const id = Math.random().toString(36).substring(2, 11);
    const timestamp = Date.now();

    update((messages) => ({
      ...messages,
      [id]: { ...message, id, timestamp },
    }));

    // Auto-remove after duration if specified
    if (message.duration && message.duration > 0) {
      setTimeout(() => {
        remove(id);
      }, message.duration);
    }

    return id;
  }

  function updateMessage(id: string, updates: Partial<Omit<ContextMessage, "id" | "timestamp">>) {
    update((messages) => {
      if (messages[id]) {
        return {
          ...messages,
          [id]: { ...messages[id], ...updates },
        };
      }
      return messages;
    });
  }

  function remove(id: string) {
    update((messages) => {
      const newMessages = { ...messages };
      delete newMessages[id];
      return newMessages;
    });
  }

  function clear() {
    set({});
  }

  // Helper methods for common message types
  function loading(message: string, details?: any, id?: string) {
    const messageId = id || `loading-${Date.now()}`;
    add({
      type: "loading",
      message,
      details,
      duration: 0, // No auto-remove for loading messages
    });
    return messageId;
  }

  function info(message: string, details?: any, duration = 5000) {
    return add({
      type: "info",
      message,
      details,
      duration,
    });
  }

  function success(message: string, details?: any, duration = 5000) {
    return add({
      type: "success",
      message,
      details,
      duration,
    });
  }

  function error(message: string, details?: any, duration = 10000) {
    return add({
      type: "error",
      message,
      details,
      duration,
    });
  }

  function warning(message: string, details?: any, duration = 8000) {
    return add({
      type: "warning",
      message,
      details,
      duration,
    });
  }

  return {
    subscribe,
    add,
    update: updateMessage,
    remove,
    clear,
    loading,
    info,
    success,
    error,
    warning,
  };
}

export const context = createContextStore();
